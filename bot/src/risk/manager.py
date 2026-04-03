"""Risk manager — gates every trade execution.

Checks all risk limits before allowing a trade to proceed.
"""

import logging
from dataclasses import dataclass

from src.broker.base import BrokerAdapter, OptionOrder
from src.db.supabase_client import get_supabase

logger = logging.getLogger(__name__)

DEFAULT_LIMITS = {
    "max_position_pct": 5.0,
    "max_open_positions": 10,
    "daily_loss_pct": 3.0,
    "weekly_loss_pct": 7.0,
    "max_portfolio_delta": 500.0,
    "min_portfolio_theta": -200.0,
    "min_confidence_score": 70.0,
    "position_stop_loss_pct": 30.0,
    "position_take_profit_pct": 100.0,
}


@dataclass
class RiskCheckResult:
    allowed: bool
    reason: str | None = None


class RiskManager:
    def __init__(self, broker: BrokerAdapter) -> None:
        self.broker = broker
        self._limits = DEFAULT_LIMITS.copy()

    async def load_limits(self) -> None:
        """Load risk limits from bot_config table (set via Strategy page)."""
        db = get_supabase()
        result = db.table("bot_config").select("key, value").execute()

        if result.data:
            config_map = {row["key"]: row["value"] for row in result.data}

            # Map Strategy page keys to risk limits
            if "max_position_pct" in config_map:
                self._limits["max_position_pct"] = float(config_map["max_position_pct"])
            if "max_portfolio_risk" in config_map:
                self._limits["weekly_loss_pct"] = float(config_map["max_portfolio_risk"])
            if "max_single_loss_pct" in config_map:
                self._limits["position_stop_loss_pct"] = float(config_map["max_single_loss_pct"])
            if "min_confidence" in config_map:
                self._limits["min_confidence_score"] = float(config_map["min_confidence"])
            if "max_daily_trades" in config_map:
                self._limits["max_daily_trades"] = int(config_map["max_daily_trades"])
            if "excluded_tickers" in config_map:
                tickers = config_map["excluded_tickers"]
                self._limits["excluded_tickers"] = set(tickers) if isinstance(tickers, list) else set()
            if "risk_limits" in config_map:
                self._limits.update(config_map["risk_limits"])

    async def check_trade(self, order: OptionOrder, confidence_score: float) -> RiskCheckResult:
        """Run all risk checks before placing a trade.

        Returns RiskCheckResult with allowed=True if all checks pass.
        """
        await self.load_limits()

        # Check 0: Excluded tickers
        excluded = self._limits.get("excluded_tickers", set())
        if order.ticker.upper() in excluded:
            return RiskCheckResult(
                allowed=False,
                reason=f"{order.ticker} is in the excluded tickers list",
            )

        # Check 1: Minimum confidence score
        min_score = self._limits["min_confidence_score"]
        if confidence_score < min_score:
            return RiskCheckResult(
                allowed=False,
                reason=f"Confidence score {confidence_score:.1f} below minimum {min_score}",
            )

        # Check 2: Max open positions
        positions = await self.broker.get_positions()
        open_count = len([p for p in positions if p.quantity != 0])
        max_positions = int(self._limits["max_open_positions"])
        if open_count >= max_positions:
            return RiskCheckResult(
                allowed=False,
                reason=f"Already at max positions ({open_count}/{max_positions})",
            )

        # Check 3: Max position size as % of pool
        balance = await self.broker.get_account_balance()
        estimated_cost = (order.limit_price or 3.0) * order.quantity * 100
        max_pct = self._limits["max_position_pct"]
        position_pct = (estimated_cost / balance.total_value) * 100 if balance.total_value > 0 else 100
        if position_pct > max_pct:
            return RiskCheckResult(
                allowed=False,
                reason=f"Position size {position_pct:.1f}% exceeds max {max_pct}% of pool",
            )

        # Check 4: Daily loss limit
        db = get_supabase()
        daily_check = await self._check_daily_loss(db, balance.total_value)
        if not daily_check.allowed:
            return daily_check

        # Check 5: Portfolio delta limit
        delta_check = await self._check_portfolio_delta(db)
        if not delta_check.allowed:
            return delta_check

        # Check 6: Bot not paused
        paused_result = db.table("bot_config").select("value").eq("key", "bot_paused").execute()
        if paused_result.data and paused_result.data[0]["value"]:
            return RiskCheckResult(allowed=False, reason="Bot is paused")

        logger.info(
            "Risk check PASSED for %s %dx %s %.0f%s (confidence=%.1f, size=%.1f%%)",
            order.action, order.quantity, order.ticker, order.strike,
            order.call_put[0].upper(), confidence_score, position_pct,
        )
        return RiskCheckResult(allowed=True)

    async def _check_daily_loss(self, db, total_value: float) -> RiskCheckResult:
        """Check if daily loss limit has been hit."""
        from datetime import datetime, timezone

        today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
        snapshots = (
            db.table("pool_snapshots")
            .select("total_value")
            .gte("snapshot_at", today)
            .order("snapshot_at", desc=False)
            .limit(1)
            .execute()
        )

        if snapshots.data:
            start_value = snapshots.data[0]["total_value"]
            daily_loss_pct = ((start_value - total_value) / start_value) * 100
            max_loss = self._limits["daily_loss_pct"]
            if daily_loss_pct > max_loss:
                return RiskCheckResult(
                    allowed=False,
                    reason=f"Daily loss {daily_loss_pct:.1f}% exceeds limit {max_loss}%",
                )

        return RiskCheckResult(allowed=True)

    async def _check_portfolio_delta(self, db) -> RiskCheckResult:
        """Check if portfolio delta is within bounds."""
        positions = (
            db.table("positions")
            .select("delta, quantity")
            .eq("is_open", True)
            .execute()
        )

        if positions.data:
            total_delta = sum(
                (p.get("delta") or 0) * p["quantity"]
                for p in positions.data
            )
            max_delta = self._limits["max_portfolio_delta"]
            if abs(total_delta) > max_delta:
                return RiskCheckResult(
                    allowed=False,
                    reason=f"Portfolio delta {total_delta:.0f} exceeds limit +/-{max_delta}",
                )

        return RiskCheckResult(allowed=True)
