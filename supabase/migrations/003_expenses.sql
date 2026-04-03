-- Expenses tracking with document uploads

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in (
    'unusual_whales', 'anthropic_api', 'ibkr_commissions',
    'infrastructure', 'hosting', 'domain', 'other'
  )),
  description text not null,
  amount numeric(10,2) not null,
  expense_date date not null,
  receipt_url text,              -- Supabase Storage URL for uploaded receipt
  receipt_filename text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Monthly expense summary view
create or replace view public.expense_summary as
select
  date_trunc('month', expense_date)::date as month,
  category,
  sum(amount)::numeric(10,2) as total,
  count(*) as item_count
from public.expenses
group by date_trunc('month', expense_date), category
order by month desc, category;

-- Indexes
create index idx_expenses_date on public.expenses(expense_date desc);
create index idx_expenses_category on public.expenses(category);

-- RLS
alter table public.expenses enable row level security;

create policy "Authenticated can read expenses" on public.expenses
  for select using (auth.role() = 'authenticated');

create policy "Admin can insert expenses" on public.expenses
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Admin can delete expenses" on public.expenses
  for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
