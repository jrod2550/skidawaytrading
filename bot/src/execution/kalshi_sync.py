"""Sync Kalshi portfolio data to Supabase so the web app can display it.

The web app runs on Vercel which doesn't have Kalshi API keys.
This job runs on the NUC (which has the keys) and pushes data to Supabase.
"""

import logging
from datetime import datetime, timezone

from src.broker.kalshi import KalshiClient
from src.db.supabase_client import get_supabase

logger = logging.getLogger(__name__)


async def sync_kalshi_to_supabase(kalshi: KalshiClient) -> None:
    """Sync Kalshi balance, positions, fills, and settlements to Supabase."""
    db = get_supabase()

    try:
        balance = await kalshi.get_balance()
        positions = await kalshi.get_positions()
        fills = await kalshi.get_fills(limit=200)
        settlements = await kalshi.get_settlements(limit=200)

        # Build snapshot
        balance_cents = balance.get("balance", 0)
        portfolio_cents = balance.get("portfolio_value", 0)

        open_positions = []
        for p in positions:
            count = float(p.get("position", p.get("position_fp", 0)))
            if count == 0:
                continue
            open_positions.append({
                "ticker": p.get("ticker"),
                "side": "YES" if count > 0 else "NO",
                "position": abs(count),
                "exposure_dollars": abs(float(p.get("market_exposure", p.get("market_exposure_dollars", 0)))),
                "cost_dollars": abs(float(p.get("total_cost", p.get("total_cost_dollars", 0)))),
            })

        fill_list = []
        for f in fills:
            side = f.get("side", "yes")
            yes_price = float(f.get("yes_price_dollars", 0))
            no_price = float(f.get("no_price_dollars", 0))
            count = float(f.get("count_fp", f.get("count", 0)))
            fee = float(f.get("fee_cost", 0))
            price = yes_price if side == "yes" else no_price
            fill_list.append({
                "fill_id": f.get("fill_id"),
                "ticker": f.get("ticker", f.get("market_ticker")),
                "side": side,
                "action": f.get("action", "buy"),
                "count": count,
                "price_cents": round(price * 100),
                "cost_dollars": count * price,
                "fee_dollars": fee,
                "total_cost_dollars": count * price + fee,
                "created_at": f.get("created_time"),
            })

        settlement_list = []
        total_pnl = 0
        wins = 0
        losses = 0
        for s in settlements:
            revenue_cents = float(s.get("revenue", 0))
            revenue_dollars = revenue_cents / 100
            yes_cost = float(s.get("yes_total_cost_dollars", 0))
            no_cost = float(s.get("no_total_cost_dollars", 0))
            total_cost = yes_cost + no_cost
            profit = revenue_dollars - total_cost
            yes_count = float(s.get("yes_count_fp", 0))
            no_count = float(s.get("no_count_fp", 0))

            if total_cost == 0:
                continue  # no position in this market

            outcome = "WON" if profit > 0 else "LOST" if profit < 0 else "PUSH"
            if outcome == "WON":
                wins += 1
            elif outcome == "LOST":
                losses += 1
            total_pnl += profit

            settlement_list.append({
                "ticker": s.get("ticker", s.get("market_ticker")),
                "market_result": s.get("market_result"),
                "revenue_dollars": revenue_dollars,
                "cost_dollars": total_cost,
                "profit_dollars": profit,
                "yes_count": yes_count,
                "no_count": no_count,
                "outcome": outcome,
                "had_conflict": yes_count > 0 and no_count > 0,
                "settled_at": s.get("settled_time"),
            })

        # Get or set starting balance (first time we sync)
        current_balance = balance_cents / 100
        try:
            start_row = db.table("bot_config").select("value").eq("key", "kalshi_starting_balance").execute()
            if start_row.data and start_row.data[0].get("value") is not None:
                starting_balance = float(start_row.data[0]["value"])
            else:
                starting_balance = current_balance
                db.table("bot_config").upsert({
                    "key": "kalshi_starting_balance",
                    "value": current_balance,
                }).execute()
        except Exception:
            starting_balance = current_balance

        # Real P&L = current balance + portfolio value - starting balance
        real_pnl = round(current_balance + (portfolio_cents / 100) - starting_balance, 2)

        # Upsert to bot_config as JSON (simple, no new tables needed)
        snapshot = {
            "balance_dollars": current_balance,
            "portfolio_value_dollars": portfolio_cents / 100,
            "starting_balance": starting_balance,
            "positions": open_positions,
            "fills": fill_list,
            "settlements": settlement_list,
            "total_pnl": real_pnl,
            "total_spent": round(sum(f["total_cost_dollars"] for f in fill_list if f["action"] == "buy"), 2),
            "wins": wins,
            "losses": losses,
            "win_rate": round((wins / (wins + losses)) * 100) if (wins + losses) > 0 else 0,
            "synced_at": datetime.now(timezone.utc).isoformat(),
        }

        db.table("bot_config").upsert({
            "key": "kalshi_snapshot",
            "value": snapshot,
        }).execute()

        logger.info(
            "Kalshi sync: $%.2f balance, %d positions, %d fills, %d settlements (P&L $%.2f, %dW/%dL)",
            snapshot["balance_dollars"], len(open_positions), len(fill_list),
            len(settlement_list), total_pnl, wins, losses,
        )

    except Exception as e:
        logger.error("Kalshi sync failed: %s", e)
