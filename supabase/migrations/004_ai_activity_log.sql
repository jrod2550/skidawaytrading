-- AI Activity Log — tracks every action the bot takes

create table public.ai_activity (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'scan_started', 'flow_screened', 'flow_escalated', 'flow_rejected',
    'deep_analysis', 'signal_created', 'signal_auto_approved',
    'trade_executed', 'trade_failed', 'risk_blocked',
    'congressional_scan', 'position_sync', 'error'
  )),
  ticker text,
  details jsonb not null default '{}',
  ai_reasoning text,
  confidence_score numeric(5,2),
  created_at timestamptz not null default now()
);

create index idx_ai_activity_created on public.ai_activity(created_at desc);
create index idx_ai_activity_type on public.ai_activity(event_type);

alter table public.ai_activity enable row level security;

create policy "Authenticated can read ai_activity" on public.ai_activity
  for select using (auth.role() = 'authenticated');

alter publication supabase_realtime add table public.ai_activity;
