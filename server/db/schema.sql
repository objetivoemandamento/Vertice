-- VÉRTICE PostgreSQL/Supabase schema v1
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  full_name text,
  country_code char(2) not null default 'BR',
  locale text not null default 'pt-BR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references users(id) on delete cascade,
  country_code char(2) not null default 'BR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists user_permissions (
  user_id uuid not null references users(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, permission_id)
);

create table if not exists markets (
  country_code char(2) primary key,
  country_name text not null,
  locale text not null,
  language_name text not null,
  currency_code char(3) not null,
  currency_symbol text not null,
  marketing_enabled boolean not null default true
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  plan text not null,
  status text not null check (status in ('pending','active','paused','cancelled','expired','delinquent')),
  provider text,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  provider text not null,
  provider_order_id text,
  provider_payment_id text,
  external_reference text unique,
  amount numeric(14,2) not null,
  currency_code char(3) not null,
  status text not null default 'pending',
  checkout_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists devices (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  device_name text,
  mode text not null check (mode in ('comando','operacao','monitoramento')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  device_id text references devices(id) on delete cascade,
  mode text not null check (mode in ('comando','operacao','monitoramento')),
  command text not null,
  status text not null default 'queued',
  result_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  mode text,
  input_data jsonb not null default '{}'::jsonb,
  result_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists monthly_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  period_month date not null,
  gross_revenue numeric(14,2) not null default 0,
  net_revenue numeric(14,2) not null default 0,
  sales_count integer not null default 0,
  active_subscriptions integer not null default 0,
  cancellations integer not null default 0,
  delinquent integer not null default 0,
  created_at timestamptz not null default now(),
  unique(user_id, period_month)
);

create index if not exists idx_users_country on users(country_code);
create index if not exists idx_companies_owner on companies(owner_user_id);
create index if not exists idx_subscriptions_user on subscriptions(user_id, updated_at desc);
create index if not exists idx_payments_user on payments(user_id, created_at desc);
create index if not exists idx_payments_provider_order on payments(provider, provider_order_id);
create index if not exists idx_devices_user on devices(user_id);
create index if not exists idx_commands_user_created on commands(user_id, created_at desc);
create index if not exists idx_analyses_user_created on analyses(user_id, created_at desc);
create index if not exists idx_history_user_created on history(user_id, created_at desc);

insert into markets(country_code,country_name,locale,language_name,currency_code,currency_symbol)
values
('BR','Brasil','pt-BR','Português (Brasil)','BRL','R$'),
('US','Estados Unidos','en-US','English (US)','USD','$'),
('PT','Portugal','pt-PT','Português (Portugal)','EUR','€'),
('ES','Espanha','es-ES','Español (España)','EUR','€'),
('MX','México','es-MX','Español (México)','MXN','MX$')
on conflict (country_code) do update set
country_name=excluded.country_name, locale=excluded.locale,
language_name=excluded.language_name, currency_code=excluded.currency_code,
currency_symbol=excluded.currency_symbol;

insert into permissions(code,description) values
('app.use','Usar o aplicativo'),
('analysis.create','Criar análises'),
('analysis.read','Consultar análises'),
('company.manage','Gerenciar empresa'),
('billing.read','Consultar faturamento'),
('billing.manage','Gerenciar cobrança'),
('admin.access','Acessar administração')
on conflict (code) do nothing;

alter table users enable row level security;
alter table companies enable row level security;
alter table user_permissions enable row level security;
alter table subscriptions enable row level security;
alter table payments enable row level security;
alter table devices enable row level security;
alter table commands enable row level security;
alter table analyses enable row level security;
alter table history enable row level security;
alter table monthly_sales enable row level security;

create policy "users own row" on users for select to authenticated using ((select auth.uid()) = id);
create policy "users update own row" on users for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "companies owner" on companies for all to authenticated using ((select auth.uid()) = owner_user_id) with check ((select auth.uid()) = owner_user_id);
create policy "subscriptions own" on subscriptions for select to authenticated using ((select auth.uid()) = user_id);
create policy "payments own" on payments for select to authenticated using ((select auth.uid()) = user_id);
create policy "devices own" on devices for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "commands own" on commands for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "analyses own" on analyses for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "history own" on history for select to authenticated using ((select auth.uid()) = user_id);
create policy "monthly sales own" on monthly_sales for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
