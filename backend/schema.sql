-- GigATax Supabase Schema
-- Run this in the Supabase SQL Editor: https://app.supabase.com → SQL Editor

-- Users (extends auth.users)
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  gigs text[] not null default '{}',
  state text not null default 'TX',
  estimated_marginal_tax_rate numeric not null default 0.24,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now()
);

-- Transactions (bank imports, email receipts)
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  date text not null,
  merchant text not null,
  amount numeric not null,
  type text not null check (type in ('income', 'expense')),
  category text not null default 'Uncategorized',
  confidence_score numeric not null default 1.0,
  source text not null check (source in ('bank', 'email', 'receipt')),
  notes text,
  created_at timestamptz not null default now()
);

-- Deductions
create table if not exists public.deductions (
  id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  category text not null,
  status text not null default 'available' check (status in ('available', 'in_progress', 'claimed')),
  potential_savings numeric not null default 0,
  detail text not null default '',
  created_at timestamptz not null default now()
);

-- Receipts (uploaded/scanned)
create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  merchant text not null,
  amount numeric not null default 0,
  date text not null default '',
  category text not null default 'Uncategorized',
  created_at timestamptz not null default now()
);

-- Integrations (Plaid, email, accounting)
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  integration_id text not null,
  name text not null,
  connected boolean not null default false,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, integration_id)
);

-- Plaid items (encrypted access tokens, one row per linked bank connection)
create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  item_id text not null unique,
  access_token_encrypted text not null,
  institution_id text,
  institution_name text,
  sync_cursor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Optimization signals (e.g. vehicle mileage prompts)
create table if not exists public.optimization_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null default 'vehicle_mileage',
  gas_spend numeric not null default 0,
  detected_period_label text not null default '',
  created_at timestamptz not null default now()
);

-- Filing profiles
create table if not exists public.filing_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  legal_name text not null default '',
  ssn_last4 text not null default '',
  filing_status text not null default 'single',
  dependents integer not null default 0,
  address1 text not null default '',
  city text not null default '',
  state text not null default '',
  zip_code text not null default '',
  updated_at timestamptz not null default now()
);

-- Filing runs
create table if not exists public.filing_runs (
  run_id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null,
  status text not null default 'awaiting_user',
  current_step_index integer not null default 0,
  steps jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.transactions enable row level security;
alter table public.deductions enable row level security;
alter table public.receipts enable row level security;
alter table public.integrations enable row level security;
alter table public.plaid_items enable row level security;
alter table public.optimization_signals enable row level security;
alter table public.filing_profiles enable row level security;
alter table public.filing_runs enable row level security;

-- Users can only read/write their own rows
create policy "users_self" on public.users for all using (auth.uid() = id);
create policy "transactions_self" on public.transactions for all using (auth.uid() = user_id);
create policy "deductions_self" on public.deductions for all using (auth.uid() = user_id);
create policy "receipts_self" on public.receipts for all using (auth.uid() = user_id);
create policy "integrations_self" on public.integrations for all using (auth.uid() = user_id);
create policy "plaid_items_self" on public.plaid_items for all using (auth.uid() = user_id);
create policy "signals_self" on public.optimization_signals for all using (auth.uid() = user_id);
create policy "filing_profiles_self" on public.filing_profiles for all using (auth.uid() = user_id);
create policy "filing_runs_self" on public.filing_runs for all using (auth.uid() = user_id);

-- Service role bypasses RLS automatically (used by FastAPI backend)

-- -----------------------------------------------------------------------
-- Auto-create public.users row when a new auth user signs up
-- -----------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
