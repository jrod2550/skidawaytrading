export type UserRole = "admin" | "viewer";

export interface Profile {
  id: string;
  display_name: string;
  role: UserRole;
  created_at: string;
}

export type SignalStatus = "pending" | "approved" | "rejected" | "expired" | "executed";
export type SignalSource = "congressional" | "flow" | "polymarket" | "manual";

export interface Signal {
  id: string;
  source: SignalSource;
  status: SignalStatus;
  ticker: string;
  direction: "bullish" | "bearish";
  confidence_score: number;
  source_data: Record<string, unknown>;
  scoring_factors: Record<string, number>;
  suggested_action: string | null;
  suggested_strike: number | null;
  suggested_expiry: string | null;
  suggested_quantity: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  expires_at: string | null;
}

export type TradeStatus = "pending" | "filled" | "partial" | "cancelled" | "failed";

export interface Trade {
  id: string;
  signal_id: string | null;
  ticker: string;
  option_symbol: string | null;
  action: string;
  quantity: number;
  strike: number | null;
  expiry: string | null;
  call_put: "call" | "put" | null;
  order_id: string | null;
  status: TradeStatus;
  fill_price: number | null;
  commission: number | null;
  filled_at: string | null;
  created_at: string;
}

export interface Position {
  id: string;
  ticker: string;
  option_symbol: string | null;
  call_put: "call" | "put" | null;
  strike: number | null;
  expiry: string | null;
  quantity: number;
  avg_cost: number;
  current_price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  pnl_pct: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  iv: number | null;
  last_synced_at: string;
  is_open: boolean;
}

export interface PoolSnapshot {
  id: string;
  total_value: number;
  cash_balance: number;
  positions_value: number;
  daily_pnl: number | null;
  snapshot_at: string;
}

export interface Contribution {
  id: string;
  user_id: string;
  amount: number;
  contributed_at: string;
  note: string | null;
  created_at: string;
}

export interface MemberSummary {
  id: string;
  display_name: string;
  role: UserRole;
  total_contributed: number;
  ownership_pct: number;
}

export interface BotHeartbeat {
  id: string;
  status: "healthy" | "degraded" | "error";
  details: Record<string, unknown> | null;
  created_at: string;
}
