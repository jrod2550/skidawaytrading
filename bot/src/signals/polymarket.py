"""Polymarket / prediction market signal source.

Cross-references prediction market data (available via Unusual Whales API)
with existing signals to boost or reduce confidence.
"""

import logging

from src.market_data.unusual_whales import UnusualWhalesClient
from src.signals.scoring import score_polymarket

logger = logging.getLogger(__name__)


async def get_prediction_alignment(
    ticker: str,
    direction: str,
    uw: UnusualWhalesClient,
) -> dict:
    """Check if prediction market data aligns with a trade direction.

    Returns prediction data dict suitable for scoring.
    """
    # The UW API includes prediction/smart-money data
    # This is a placeholder that will be refined once we have
    # the exact endpoint structure from the UW API docs
    try:
        # Use the predictions endpoint if available
        # For now return neutral data
        return {
            "probability": 0.5,
            "whale_activity": "neutral",
            "liquidity": 0,
            "trend": "flat",
        }
    except Exception:
        logger.warning("Failed to get prediction data for %s", ticker)
        return {
            "probability": 0.5,
            "whale_activity": "neutral",
            "liquidity": 0,
            "trend": "flat",
        }
