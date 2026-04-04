"""Interactive Brokers broker adapter via ib_insync.

Requires TWS Gateway running on ibkr_host:ibkr_port.
Uses nest_asyncio to allow ib_insync's event loop inside asyncio.
"""

import logging

import nest_asyncio
from ib_insync import IB, Option, Order, Stock, Trade

from src.broker.base import (
    AccountBalance,
    BrokerAdapter,
    BrokerPosition,
    OptionOrder,
    OrderResult,
)
from src.config import settings

# ib_insync needs its own event loop patching
nest_asyncio.apply()

logger = logging.getLogger(__name__)


class IBKRBroker(BrokerAdapter):
    def __init__(self) -> None:
        self._ib = IB()

    async def connect(self) -> None:
        self._ib.connect(
            settings.ibkr_host,
            settings.ibkr_port,
            clientId=settings.ibkr_client_id,
        )
        logger.info(
            "Connected to IBKR TWS Gateway at %s:%d",
            settings.ibkr_host, settings.ibkr_port,
        )

    async def disconnect(self) -> None:
        self._ib.disconnect()
        logger.info("Disconnected from IBKR")

    def _make_option_contract(self, order: OptionOrder) -> Option:
        right = "C" if order.call_put == "call" else "P"
        return Option(
            symbol=order.ticker,
            lastTradeDateOrContractMonth=order.expiry.replace("-", ""),
            strike=order.strike,
            right=right,
            exchange="SMART",
            currency="USD",
        )

    async def place_option_order(self, order: OptionOrder) -> OrderResult:
        # Route to equity or option based on instrument_type
        if order.instrument_type == "equity":
            return await self._place_equity_order(order)
        contract = self._make_option_contract(order)

        qualified = self._ib.qualifyContracts(contract)
        if not qualified:
            return OrderResult(
                order_id="",
                status="error",
                message=f"Could not qualify contract: {order.ticker} {order.strike} {order.call_put} {order.expiry}",
            )

        action = "BUY" if "buy" in order.action else "SELL"
        if order.order_type == "limit" and order.limit_price:
            ib_order = Order(
                action=action,
                totalQuantity=order.quantity,
                orderType="LMT",
                lmtPrice=order.limit_price,
            )
        else:
            ib_order = Order(
                action=action,
                totalQuantity=order.quantity,
                orderType="MKT",
            )

        trade: Trade = self._ib.placeOrder(contract, ib_order)
        logger.info(
            "Placed IBKR order: %s %dx %s %s%s @ %s",
            action, order.quantity, order.ticker,
            order.strike, order.call_put[0].upper(),
            order.limit_price or "MKT",
        )

        # Wait for fill
        self._ib.sleep(3)

        fill_price = None
        commission = None
        if trade.fills:
            fill_price = trade.fills[0].execution.price
            commission = sum(
                f.commissionReport.commission
                for f in trade.fills
                if f.commissionReport
            )

        return OrderResult(
            order_id=str(trade.order.orderId),
            status=trade.orderStatus.status.lower(),
            fill_price=fill_price,
            filled_quantity=int(trade.orderStatus.filled),
            commission=commission,
            raw_response={"status": trade.orderStatus.status},
        )

    async def _place_equity_order(self, order: OptionOrder) -> OrderResult:
        """Place a stock/equity order on IBKR."""
        contract = Stock(order.ticker, "SMART", "USD")
        qualified = self._ib.qualifyContracts(contract)
        if not qualified:
            return OrderResult(
                order_id="", status="error",
                message=f"Could not qualify stock: {order.ticker}",
            )

        action = "BUY" if "buy" in order.action else "SELL"
        if order.order_type == "limit" and order.limit_price:
            ib_order = Order(
                action=action,
                totalQuantity=order.quantity,
                orderType="LMT",
                lmtPrice=order.limit_price,
            )
        else:
            ib_order = Order(
                action=action,
                totalQuantity=order.quantity,
                orderType="MKT",
            )

        trade: Trade = self._ib.placeOrder(contract, ib_order)
        logger.info(
            "Placed IBKR equity order: %s %dx %s @ %s",
            action, order.quantity, order.ticker,
            order.limit_price or "MKT",
        )

        self._ib.sleep(3)

        fill_price = None
        commission = None
        if trade.fills:
            fill_price = trade.fills[0].execution.price
            commission = sum(
                f.commissionReport.commission
                for f in trade.fills
                if f.commissionReport
            )

        return OrderResult(
            order_id=str(trade.order.orderId),
            status=trade.orderStatus.status.lower(),
            fill_price=fill_price,
            filled_quantity=int(trade.orderStatus.filled),
            commission=commission,
            raw_response={"status": trade.orderStatus.status},
        )

    async def get_positions(self) -> list[BrokerPosition]:
        self._ib.sleep(0)  # process pending events
        positions = self._ib.positions()
        result: list[BrokerPosition] = []

        for pos in positions:
            contract = pos.contract
            is_option = contract.secType == "OPT"

            bp = BrokerPosition(
                ticker=contract.symbol,
                option_symbol=contract.localSymbol if is_option else None,
                call_put="call" if getattr(contract, "right", "") == "C" else "put" if getattr(contract, "right", "") == "P" else None,
                strike=getattr(contract, "strike", None),
                expiry=getattr(contract, "lastTradeDateOrContractMonth", None),
                quantity=int(pos.position),
                avg_cost=pos.avgCost / 100 if is_option else pos.avgCost,
                current_price=None,
                market_value=None,
                unrealized_pnl=None,
            )
            result.append(bp)

        return result

    async def get_account_balance(self) -> AccountBalance:
        self._ib.sleep(0)
        account_values = self._ib.accountSummary()
        vals: dict[str, float] = {}
        for av in account_values:
            if av.currency == "USD":
                try:
                    vals[av.tag] = float(av.value)
                except (ValueError, TypeError):
                    pass

        return AccountBalance(
            total_value=vals.get("NetLiquidation", 0),
            cash_balance=vals.get("TotalCashValue", 0),
            positions_value=vals.get("GrossPositionValue", 0),
            buying_power=vals.get("BuyingPower", 0),
        )

    async def cancel_order(self, order_id: str) -> bool:
        for trade in self._ib.openTrades():
            if str(trade.order.orderId) == order_id:
                self._ib.cancelOrder(trade.order)
                return True
        return False

    async def get_order_status(self, order_id: str) -> dict:
        for trade in self._ib.trades():
            if str(trade.order.orderId) == order_id:
                return {
                    "status": trade.orderStatus.status,
                    "filled": trade.orderStatus.filled,
                    "remaining": trade.orderStatus.remaining,
                }
        return {"status": "unknown"}
