"""Builds orders from approved signals — supports both options and equities."""

import logging
from datetime import date, timedelta

from src.broker.base import OptionOrder

logger = logging.getLogger(__name__)


def build_order_from_signal(signal: dict, pool_value: float) -> OptionOrder:
    """Convert an approved signal into a concrete order.

    Supports both options and equity trades based on the AI's recommendation.
    """
    ticker = signal["ticker"]
    direction = signal["direction"]
    source_data = signal.get("source_data", {})
    ai_analysis = source_data.get("ai_analysis", {})
    recommended = ai_analysis.get("recommended_trade", {})

    # Determine instrument type from AI recommendation
    instrument = recommended.get("instrument", "option")
    action_str = recommended.get("action", "")

    # Equity trade
    if instrument == "equity" or action_str in ("BUY STOCK", "SELL SHORT"):
        quantity = signal.get("suggested_quantity")
        if not quantity:
            # Size based on 2% of pool at estimated share price
            allocation = pool_value * 0.02
            # Rough estimate — $100/share default
            estimated_price = float(source_data.get("flow_alert", {}).get("underlying_price", 100))
            quantity = max(1, int(allocation / estimated_price))

        action = "buy" if direction == "bullish" else "sell_short"

        order = OptionOrder(
            ticker=ticker,
            expiry="",
            strike=0.0,
            call_put="equity",
            action=action,
            quantity=quantity,
            order_type="market",
            instrument_type="equity",
        )

        logger.info(
            "Built equity order: %s %dx %s",
            order.action, order.quantity, order.ticker,
        )
        return order

    # Option trade (default)
    call_put = "call" if direction == "bullish" else "put"
    strike = signal.get("suggested_strike")
    expiry = signal.get("suggested_expiry")
    quantity = signal.get("suggested_quantity")

    if not expiry:
        target_dte = recommended.get("target_expiry_dte", 35)
        target_date = date.today() + timedelta(days=target_dte)
        days_until_friday = (4 - target_date.weekday()) % 7
        expiry = (target_date + timedelta(days=days_until_friday)).isoformat()

    if not quantity:
        allocation = pool_value * 0.02
        estimated_premium = 3.0
        quantity = max(1, int(allocation / (estimated_premium * 100)))

    # Override call_put from signal source_data if available
    source_call_put = source_data.get("call_put")
    if source_call_put:
        call_put = source_call_put

    # Determine action from AI recommendation
    if "SELL PUT" in action_str:
        action = "sell_to_open"
        call_put = "put"
    elif "BUY PUT" in action_str:
        action = "buy_to_open"
        call_put = "put"
    elif "BUY CALL" in action_str:
        action = "buy_to_open"
        call_put = "call"
    else:
        action = "buy_to_open"

    order = OptionOrder(
        ticker=ticker,
        expiry=str(expiry),
        strike=float(strike) if strike else 0.0,
        call_put=call_put,
        action=action,
        quantity=quantity,
        order_type="limit",
        instrument_type="option",
    )

    logger.info(
        "Built option order: %s %dx %s %.0f%s exp %s",
        order.action, order.quantity, order.ticker,
        order.strike, order.call_put[0].upper(), order.expiry,
    )
    return order
