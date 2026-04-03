from datetime import date, datetime
from pydantic import BaseModel


class SignalCreate(BaseModel):
    source: str  # congressional, flow, polymarket, manual
    ticker: str
    direction: str  # bullish, bearish
    confidence_score: float
    source_data: dict
    scoring_factors: dict
    suggested_action: str | None = None
    suggested_strike: float | None = None
    suggested_expiry: date | None = None
    suggested_quantity: int | None = None
    expires_at: datetime | None = None


class TradeCreate(BaseModel):
    signal_id: str | None = None
    ticker: str
    option_symbol: str | None = None
    action: str  # BTO, STC, etc.
    quantity: int
    strike: float | None = None
    expiry: date | None = None
    call_put: str | None = None  # call, put
    order_id: str | None = None
    status: str = "pending"
    fill_price: float | None = None
    commission: float | None = None
    filled_at: datetime | None = None
    broker_response: dict | None = None


class PositionSync(BaseModel):
    ticker: str
    option_symbol: str | None = None
    call_put: str | None = None
    strike: float | None = None
    expiry: date | None = None
    quantity: int
    avg_cost: float
    current_price: float | None = None
    market_value: float | None = None
    unrealized_pnl: float | None = None
    pnl_pct: float | None = None
    delta: float | None = None
    gamma: float | None = None
    theta: float | None = None
    vega: float | None = None
    iv: float | None = None
