-- Skidaway Trading — Row Level Security Policies

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.contributions enable row level security;
alter table public.signals enable row level security;
alter table public.trades enable row level security;
alter table public.positions enable row level security;
alter table public.pool_snapshots enable row level security;
alter table public.bot_config enable row level security;
alter table public.bot_heartbeats enable row level security;

-- All authenticated users can read everything (shared pool)
create policy "Authenticated can read profiles" on public.profiles
  for select using (auth.role() = 'authenticated');

create policy "Authenticated can read contributions" on public.contributions
  for select using (auth.role() = 'authenticated');

create policy "Authenticated can read signals" on public.signals
  for select using (auth.role() = 'authenticated');

create policy "Authenticated can read trades" on public.trades
  for select using (auth.role() = 'authenticated');

create policy "Authenticated can read positions" on public.positions
  for select using (auth.role() = 'authenticated');

create policy "Authenticated can read snapshots" on public.pool_snapshots
  for select using (auth.role() = 'authenticated');

create policy "Authenticated can read bot_config" on public.bot_config
  for select using (auth.role() = 'authenticated');

create policy "Authenticated can read heartbeats" on public.bot_heartbeats
  for select using (auth.role() = 'authenticated');

-- Admin-only write policies
create policy "Admin can update bot_config" on public.bot_config
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin can upsert bot_config" on public.bot_config
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin can update signals" on public.signals
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin can insert contributions" on public.contributions
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Note: The Python bot uses service_role key which bypasses RLS entirely.
-- All bot writes (signals, trades, positions, snapshots, heartbeats) go through service_role.
