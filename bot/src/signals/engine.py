"""Signal evaluation orchestrator.

Coordinates all signal sources, manages the signal pipeline,
and handles signal lifecycle (pending -> approved -> executed).
"""

import logging

from src.db.supabase_client import get_supabase
from src.market_data.unusual_whales import UnusualWhalesClient
from src.signals.congressional import scan_congressional_trades
from src.signals.flow import scan_flow_alerts

logger = logging.getLogger(__name__)


class SignalEngine:
    def __init__(self, uw: UnusualWhalesClient) -> None:
        self.uw = uw

    async def run_congressional_scan(self) -> None:
        """Scan for new congressional trades."""
        logger.info("Running congressional trade scan...")
        count = await scan_congressional_trades(self.uw)
        logger.info("Congressional scan complete: %d new signals", count)

    async def run_flow_scan(self) -> None:
        """Scan for unusual options flow."""
        logger.info("Running options flow scan...")
        count = await scan_flow_alerts(self.uw)
        logger.info("Flow scan complete: %d new signals", count)

    async def expire_old_signals(self) -> None:
        """Expire signals that have passed their expiration time."""
        db = get_supabase()
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).isoformat()
        result = (
            db.table("signals")
            .update({"status": "expired"})
            .eq("status", "pending")
            .lt("expires_at", now)
            .not_.is_("expires_at", "null")
            .execute()
        )
        if result.data:
            logger.info("Expired %d old signals", len(result.data))

    async def get_approved_signals(self) -> list[dict]:
        """Get signals that have been approved and are ready for execution."""
        db = get_supabase()
        result = (
            db.table("signals")
            .select("*")
            .eq("status", "approved")
            .order("confidence_score", desc=True)
            .execute()
        )
        return result.data or []

    async def mark_signal_executed(self, signal_id: str) -> None:
        """Mark a signal as executed after a trade is placed."""
        db = get_supabase()
        db.table("signals").update({"status": "executed"}).eq("id", signal_id).execute()
