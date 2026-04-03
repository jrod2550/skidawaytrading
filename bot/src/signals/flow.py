"""Unusual options flow signal source.

Processes real-time and polled flow alerts, cross-references with other data,
and generates trading signals.
"""

import logging
from datetime import datetime, timezone

from src.db.supabase_client import get_supabase
from src.market_data.unusual_whales import UnusualWhalesClient
from src.signals.scoring import compute_composite_score

logger = logging.getLogger(__name__)

# Minimum premium to consider a flow alert
MIN_PREMIUM = 50_000


async def process_flow_alert(alert: dict, uw: UnusualWhalesClient | None = None) -> bool:
    """Process a single flow alert and optionally create a signal.

    Returns True if a new signal was created.
    """
    db = get_supabase()

    premium = alert.get("premium", 0)
    if premium < MIN_PREMIUM:
        return False

    ticker = alert.get("ticker", alert.get("underlying_symbol", ""))
    if not ticker:
        return False

    call_put = alert.get("put_call", alert.get("option_type", "")).lower()
    direction = "bullish" if call_put == "call" else "bearish"

    # Deduplicate — skip if we already have a flow signal for this ticker today
    existing = (
        db.table("signals")
        .select("id")
        .eq("ticker", ticker)
        .eq("source", "flow")
        .gte("created_at", datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z"))
        .execute()
    )
    if existing.data:
        return False

    # Score the flow
    score, factors = compute_composite_score(flow_data=alert)

    if score < 50:
        return False

    signal_data = {
        "source": "flow",
        "status": "pending",
        "ticker": ticker,
        "direction": direction,
        "confidence_score": score,
        "source_data": {
            "flow_type": alert.get("type", "unknown"),
            "premium": premium,
            "oi_change": alert.get("oi_change", 0),
            "strike": alert.get("strike", None),
            "expiry": alert.get("expiry", None),
            "call_put": call_put,
            "volume": alert.get("volume", 0),
        },
        "scoring_factors": factors,
        "suggested_action": f"BUY {call_put.upper()}",
        "suggested_strike": alert.get("strike"),
        "suggested_expiry": alert.get("expiry"),
    }

    db.table("signals").insert(signal_data).execute()
    logger.info(
        "Created flow signal: %s %s (score=%.1f, premium=$%s)",
        ticker, direction, score, f"{premium:,.0f}",
    )
    return True


async def scan_flow_alerts(uw: UnusualWhalesClient) -> int:
    """Poll for unusual flow alerts and create signals.

    Returns number of new signals created.
    """
    alerts = await uw.get_flow_alerts()
    new_count = 0
    for alert in alerts:
        if await process_flow_alert(alert, uw):
            new_count += 1
    return new_count
