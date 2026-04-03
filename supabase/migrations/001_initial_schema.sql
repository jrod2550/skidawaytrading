-- Skidaway Trading — Initial Database Schema
-- Run this in Supabase SQL Editor

-- ============================================================
-- USERS & CONTRIBUTIONS
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now()
);

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  amount numeric(12,2) not null,
  contributed_at date not null,
  note text,
  created_at timestamptz not null default now()
);

create or replace view public.member_summary as
select
  p.id,
  p.display_name,
  p.role,
  coalesce(sum(c.amount), 0)::numeric(12,2) as total_contributed,
  coalesce(
    sum(c.amount) / nullif((select sum(amount) from public.contributions), 0) * 100,
    0
  )::numeric(8,2) as ownership_pct
from public.profiles p
left join public.contributions c on c.user_id = p.id
group by p.id, p.display_name, p.role;

-- ============================================================
-- POOL CAPITAL TRACKING
-- ============================================================

create table public.pool_snapshots (
  id uuid primary key default gen_random_uuid(),
  total_value numeric(14,2) not null,
  cash_balance numeric(14,2) not null,
  positions_value numeric(14,2) not null,
  daily_pnl numeric(12,2),
  snapshot_at timestamptz not null default now()
);

-- ============================================================
-- SIGNALS
-- ============================================================

create type signal_status as enum ('pending', 'approved', 'rejected', 'expired', 'executed');
create type signal_source as enum ('congressional', 'flow', 'polymarket', 'manual');

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  source signal_source not null,
  status signal_status not null default 'pending',
  ticker text not null,
  direction text not null check (direction in ('bullish', 'bearish')),
  confidence_score numeric(5,2),
  source_data jsonb not null default '{}',
  scoring_factors jsonb not null default '{}',
  suggested_action text,
  suggested_strike numeric(10,2),
  suggested_expiry date,
  suggested_quantity int,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

-- ============================================================
-- TRADES
-- ============================================================

create type trade_status as enum ('pending', 'filled', 'partial', 'cancelled', 'failed');

create table public.trades (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references public.signals(id),
  ticker text not null,
  option_symbol text,
  action text not null,
  quantity int not null,
  strike numeric(10,2),
  expiry date,
  call_put text check (call_put in ('call', 'put')),
  order_id text,
  status trade_status not null default 'pending',
  fill_price numeric(10,4),
  commission numeric(8,4),
  filled_at timestamptz,
  broker_response jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- POSITIONS
-- ============================================================

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  option_symbol text unique,
  call_put text check (call_put in ('call', 'put')),
  strike numeric(10,2),
  expiry date,
  quantity int not null,
  avg_cost numeric(10,4) not null,
  current_price numeric(10,4),
  market_value numeric(12,2),
  unrealized_pnl numeric(12,2),
  pnl_pct numeric(8,2),
  delta numeric(8,4),
  gamma numeric(8,4),
  theta numeric(8,4),
  vega numeric(8,4),
  iv numeric(8,4),
  last_synced_at timestamptz not null default now(),
  is_open boolean not null default true
);

-- ============================================================
-- BOT STATE & CONFIG
-- ============================================================

create table public.bot_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.bot_heartbeats (
  id uuid primary key default gen_random_uuid(),
  status text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index idx_signals_status on public.signals(status);
create index idx_signals_ticker on public.signals(ticker);
create index idx_signals_created on public.signals(created_at desc);
create index idx_trades_created on public.trades(created_at desc);
create index idx_trades_signal on public.trades(signal_id);
create index idx_positions_open on public.positions(is_open) where is_open = true;
create index idx_pool_snapshots_at on public.pool_snapshots(snapshot_at desc);
create index idx_heartbeats_created on public.bot_heartbeats(created_at desc);
create index idx_contributions_user on public.contributions(user_id);

-- ============================================================
-- ENABLE REALTIME
-- ============================================================

alter publication supabase_realtime add table public.signals;
alter publication supabase_realtime add table public.positions;
alter publication supabase_realtime add table public.trades;
alter publication supabase_realtime add table public.pool_snapshots;
alter publication supabase_realtime add table public.bot_heartbeats;
