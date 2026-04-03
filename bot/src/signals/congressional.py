"""Congressional trade signal source.

Polls Unusual Whales for congressional trades from watched representatives
and generates trading signals.
"""

import logging
from datetime import datetime, timezone

from src.db.supabase_client import get_supabase
from src.market_data.unusual_whales import UnusualWhalesClient
from src.signals.scoring import compute_composite_score

logger = logging.getLogger(__name__)


async def scan_congressional_trades(uw: UnusualWhalesClient) -> int:
    """Scan for new congressional trades and create signals.

    Returns the number of new signals created.
    """
    db = get_supabase()

    # Get watched representatives from config
    config_row = db.table("bot_config").select("value").eq("key", "watched_representatives").execute()
    watched_reps: list[str] = []
    if config_row.data:
        watched_reps = config_row.data[0].get("value", [])

    # Fetch recent trades
    trades = await uw.get_congressional_trades()
    if not trades:
        logger.info("No congressional trades returned")
        return 0

    new_signals = 0
    for trade in trades:
        rep = trade.get("representative", trade.get("politician", ""))

        # Filter for watched reps (if list is empty, watch all)
        if watched_reps and rep not in watched_reps:
            continue

        ticker = trade.get("ticker", trade.get("asset_description", ""))
        if not ticker:
            continue

        tx_type = trade.get("transaction_type", trade.get("type", "")).lower()
        direction = "bullish" if "purchase" in tx_type or "buy" in tx_type else "bearish"

        # Check if we already have a signal for this trade
        existing = (
            db.table("signals")
            .select("id")
            .eq("ticker", ticker)
            .eq("source", "congressional")
            .gte("created_at", datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z"))
            .execute()
        )
        if existing.data:
            continue

        # Cross-reference with flow data
        flow_data = None
        try:
            flow_alerts = await uw.get_flow_alerts(ticker)
            if flow_alerts:
                # Take the most significant alert
                flow_data = max(flow_alerts, key=lambda x: x.get("premium", 0))
        except Exception:
            logger.warning("Failed to fetch flow data for %s", ticker)

        # Compute composite score
        score, factors = compute_composite_score(
            congressional_data=trade,
            flow_data=flow_data,
        )

        if score < 50:  # minimum threshold to even create a signal
            logger.debug("Score too low for %s: %.1f", ticker, score)
            continue

        # Create signal
        signal_data = {
            "source": "congressional",
            "status": "pending",
            "ticker": ticker,
            "direction": direction,
            "confidence_score": score,
            "source_data": {
                "representative": rep,
                "transaction_type": tx_type,
                "amount_range": trade.get("amount", ""),
                "disclosure_date": trade.get("disclosure_date", ""),
                "raw": trade,
            },
            "scoring_factors": factors,
            "suggested_action": f"BUY {'CALL' if direction == 'bullish' else 'PUT'}",
        }

        db.table("signals").insert(signal_data).execute()
        new_signals += 1
        logger.info(
            "Created congressional signal: %s %s (score=%.1f, rep=%s)",
            ticker, direction, score, rep,
        )

    return new_signals
