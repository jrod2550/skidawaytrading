"""Builds option orders from approved signals."""

import logging
from datetime import date, timedelta

from src.broker.base import OptionOrder

logger = logging.getLogger(__name__)


def build_order_from_signal(signal: dict, pool_value: float) -> OptionOrder:
    """Convert an approved signal into a concrete option order.

    Uses the signal's suggested parameters if available,
    otherwise applies defaults.
    """
    ticker = signal["ticker"]
    direction = signal["direction"]
    call_put = "call" if direction == "bullish" else "put"

    # Use suggested params or defaults
    strike = signal.get("suggested_strike")
    expiry = signal.get("suggested_expiry")
    quantity = signal.get("suggested_quantity")

    # Default expiry: 30-45 DTE
    if not expiry:
        target_date = date.today() + timedelta(days=35)
        # Round to next Friday
        days_until_friday = (4 - target_date.weekday()) % 7
        expiry = (target_date + timedelta(days=days_until_friday)).isoformat()

    # Default quantity: based on 2% of pool value
    if not quantity:
        # Assume ~$3 per contract, 100 shares per contract
        allocation = pool_value * 0.02
        estimated_premium = 3.0
        quantity = max(1, int(allocation / (estimated_premium * 100)))

    # Override call_put from signal source_data if available
    source_call_put = signal.get("source_data", {}).get("call_put")
    if source_call_put:
        call_put = source_call_put

    order = OptionOrder(
        ticker=ticker,
        expiry=str(expiry),
        strike=float(strike) if strike else 0.0,  # 0 means "use ATM"
        call_put=call_put,
        action="buy_to_open",
        quantity=quantity,
        order_type="limit",
    )

    logger.info(
        "Built order: %s %dx %s %.0f%s exp %s",
        order.action, order.quantity, order.ticker,
        order.strike, order.call_put[0].upper(), order.expiry,
    )
    return order
