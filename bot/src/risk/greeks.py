"""Portfolio-level Greeks aggregation."""

import logging

from src.db.supabase_client import get_supabase

logger = logging.getLogger(__name__)


async def get_portfolio_greeks() -> dict[str, float]:
    """Aggregate Greeks across all open positions."""
    db = get_supabase()
    result = (
        db.table("positions")
        .select("delta, gamma, theta, vega, quantity")
        .eq("is_open", True)
        .execute()
    )

    totals = {"delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
    for pos in result.data or []:
        qty = pos["quantity"]
        for greek in totals:
            totals[greek] += (pos.get(greek) or 0) * qty

    return totals
