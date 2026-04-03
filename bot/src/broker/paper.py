"""Paper trading broker adapter for testing."""

import logging
import uuid
from datetime import datetime, timezone

from src.broker.base import (
    AccountBalance,
    BrokerAdapter,
    BrokerPosition,
    OptionOrder,
    OrderResult,
)

logger = logging.getLogger(__name__)


class PaperBroker(BrokerAdapter):
    """Simulated broker that logs trades without executing them."""

    def __init__(self, initial_balance: float = 100_000.0) -> None:
        self._balance = initial_balance
        self._positions: list[BrokerPosition] = []
        self._orders: dict[str, dict] = {}

    async def connect(self) -> None:
        logger.info("Paper broker connected (balance: $%.2f)", self._balance)

    async def disconnect(self) -> None:
        logger.info("Paper broker disconnected")

    async def place_option_order(self, order: OptionOrder) -> OrderResult:
        order_id = str(uuid.uuid4())[:8]
        fill_price = order.limit_price or 2.50  # default simulated fill

        cost = fill_price * order.quantity * 100  # options are per 100 shares
        commission = 0.65 * order.quantity  # simulated commission

        if "buy" in order.action:
            self._balance -= cost + commission
            self._positions.append(
                BrokerPosition(
                    ticker=order.ticker,
                    option_symbol=f"{order.ticker}{order.expiry.replace('-', '')}{order.call_put[0].upper()}{int(order.strike * 1000):08d}",
                    call_put=order.call_put,
                    strike=order.strike,
                    expiry=order.expiry,
                    quantity=order.quantity,
                    avg_cost=fill_price,
                    current_price=fill_price,
                    market_value=fill_price * order.quantity * 100,
                    unrealized_pnl=0.0,
                )
            )
        else:
            self._balance += cost - commission

        result = OrderResult(
            order_id=order_id,
            status="filled",
            fill_price=fill_price,
            filled_quantity=order.quantity,
            commission=commission,
            message=f"Paper trade: {order.action} {order.quantity}x {order.ticker} {order.strike}{order.call_put[0].upper()} @ ${fill_price:.2f}",
        )

        self._orders[order_id] = {
            "order": order,
            "result": result,
            "filled_at": datetime.now(timezone.utc).isoformat(),
        }

        logger.info("PAPER TRADE: %s", result.message)
        return result

    async def get_positions(self) -> list[BrokerPosition]:
        return self._positions

    async def get_account_balance(self) -> AccountBalance:
        positions_value = sum(p.market_value or 0 for p in self._positions)
        return AccountBalance(
            total_value=self._balance + positions_value,
            cash_balance=self._balance,
            positions_value=positions_value,
            buying_power=self._balance,
        )

    async def cancel_order(self, order_id: str) -> bool:
        if order_id in self._orders:
            logger.info("Paper: cancelled order %s", order_id)
            return True
        return False

    async def get_order_status(self, order_id: str) -> dict:
        return self._orders.get(order_id, {"status": "unknown"})
