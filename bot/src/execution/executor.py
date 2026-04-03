"""Trade execution with retry logic and position syncing."""

import logging
from datetime import datetime, timezone

from src.broker.base import BrokerAdapter, OptionOrder
from src.db.supabase_client import get_supabase
from src.risk.manager import RiskManager

logger = logging.getLogger(__name__)

MAX_RETRIES = 2


class TradeExecutor:
    def __init__(self, broker: BrokerAdapter, risk_manager: RiskManager) -> None:
        self.broker = broker
        self.risk = risk_manager

    async def execute_signal(self, signal: dict, order: OptionOrder) -> bool:
        """Execute a trade for an approved signal.

        Returns True if the trade was successfully placed.
        """
        db = get_supabase()

        # Final risk check
        confidence = signal.get("confidence_score", 0)
        risk_result = await self.risk.check_trade(order, confidence)
        if not risk_result.allowed:
            logger.warning(
                "Risk check BLOCKED trade for %s: %s",
                signal["ticker"], risk_result.reason,
            )
            return False

        # Execute with retry
        for attempt in range(MAX_RETRIES + 1):
            try:
                result = await self.broker.place_option_order(order)

                # Record trade in DB
                trade_data = {
                    "signal_id": signal["id"],
                    "ticker": order.ticker,
                    "option_symbol": None,
                    "action": order.action.upper().replace("_", " "),
                    "quantity": order.quantity,
                    "strike": order.strike,
                    "expiry": order.expiry,
                    "call_put": order.call_put,
                    "order_id": result.order_id,
                    "status": "filled" if result.fill_price else "pending",
                    "fill_price": result.fill_price,
                    "commission": result.commission,
                    "filled_at": datetime.now(timezone.utc).isoformat() if result.fill_price else None,
                    "broker_response": result.raw_response,
                }
                db.table("trades").insert(trade_data).execute()

                logger.info(
                    "Trade executed: %s %dx %s @ %s (order_id=%s)",
                    order.action, order.quantity, order.ticker,
                    result.fill_price or "pending", result.order_id,
                )
                return True

            except Exception:
                if attempt < MAX_RETRIES:
                    logger.warning(
                        "Trade attempt %d failed for %s, retrying...",
                        attempt + 1, order.ticker,
                    )
                else:
                    logger.exception(
                        "Trade FAILED after %d attempts for %s",
                        MAX_RETRIES + 1, order.ticker,
                    )
                    # Record failed trade
                    db.table("trades").insert({
                        "signal_id": signal["id"],
                        "ticker": order.ticker,
                        "action": order.action.upper().replace("_", " "),
                        "quantity": order.quantity,
                        "strike": order.strike,
                        "expiry": order.expiry,
                        "call_put": order.call_put,
                        "status": "failed",
                    }).execute()

        return False

    async def sync_positions(self) -> None:
        """Sync positions from broker to Supabase."""
        db = get_supabase()

        positions = await self.broker.get_positions()
        balance = await self.broker.get_account_balance()

        # Mark all existing positions as closed, then re-open the active ones
        db.table("positions").update({"is_open": False}).eq("is_open", True).execute()

        for pos in positions:
            if pos.quantity == 0:
                continue

            pnl_pct = None
            if pos.avg_cost and pos.current_price:
                pnl_pct = ((pos.current_price - pos.avg_cost) / pos.avg_cost) * 100

            db.table("positions").upsert(
                {
                    "ticker": pos.ticker,
                    "option_symbol": pos.option_symbol,
                    "call_put": pos.call_put,
                    "strike": pos.strike,
                    "expiry": pos.expiry,
                    "quantity": pos.quantity,
                    "avg_cost": pos.avg_cost,
                    "current_price": pos.current_price,
                    "market_value": pos.market_value,
                    "unrealized_pnl": pos.unrealized_pnl,
                    "pnl_pct": pnl_pct,
                    "is_open": True,
                    "last_synced_at": datetime.now(timezone.utc).isoformat(),
                },
                on_conflict="option_symbol",
            ).execute()

        # Snapshot pool value
        db.table("pool_snapshots").insert({
            "total_value": balance.total_value,
            "cash_balance": balance.cash_balance,
            "positions_value": balance.positions_value,
        }).execute()

        logger.info(
            "Position sync: %d positions, pool=$%.2f",
            len(positions), balance.total_value,
        )
