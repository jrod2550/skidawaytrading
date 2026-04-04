"""Abstract broker interface.

All broker implementations (IBKR, paper, future brokers) implement this
interface so the rest of the system is broker-agnostic.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class OptionOrder:
    ticker: str
    expiry: str  # YYYY-MM-DD
    strike: float
    call_put: str  # 'call' or 'put'
    action: str  # 'buy_to_open', 'sell_to_close', etc.
    quantity: int
    order_type: str = "limit"  # 'market' or 'limit'
    limit_price: float | None = None
    instrument_type: str = "option"  # 'option' or 'equity'


@dataclass
class OrderResult:
    order_id: str
    status: str  # 'submitted', 'filled', 'cancelled', 'error'
    fill_price: float | None = None
    filled_quantity: int = 0
    commission: float | None = None
    message: str | None = None
    raw_response: dict = field(default_factory=dict)


@dataclass
class AccountBalance:
    total_value: float
    cash_balance: float
    positions_value: float
    buying_power: float


@dataclass
class BrokerPosition:
    ticker: str
    option_symbol: str | None
    call_put: str | None
    strike: float | None
    expiry: str | None
    quantity: int
    avg_cost: float
    current_price: float | None
    market_value: float | None
    unrealized_pnl: float | None


class BrokerAdapter(ABC):
    @abstractmethod
    async def connect(self) -> None: ...

    @abstractmethod
    async def disconnect(self) -> None: ...

    @abstractmethod
    async def place_option_order(self, order: OptionOrder) -> OrderResult: ...

    @abstractmethod
    async def get_positions(self) -> list[BrokerPosition]: ...

    @abstractmethod
    async def get_account_balance(self) -> AccountBalance: ...

    @abstractmethod
    async def cancel_order(self, order_id: str) -> bool: ...

    @abstractmethod
    async def get_order_status(self, order_id: str) -> dict: ...
