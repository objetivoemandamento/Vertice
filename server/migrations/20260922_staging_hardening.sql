begin;

create or replace function app_tenant_for_payment(p_provider text, p_payment_id text) returns uuid language sql stable security definer set search_path=public as $$
  select tenant_id from payments where provider=p_provider and (provider_payment_id=p_payment_id or provider_order_id=p_payment_id) order by created_at desc limit 1
$$;

create or replace function app_user_for_payment(p_provider text, p_payment_id text) returns uuid language sql stable security definer set search_path=public as $$
  select user_id from payments where provider=p_provider and (provider_payment_id=p_payment_id or provider_order_id=p_payment_id) order by created_at desc limit 1
$$;

create or replace function app_create_tenant_for_user(p_user_id uuid,p_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
  select tenant_id into t from tenant_users where user_id=p_user_id order by created_at asc limit 1;
  if t is not null then return t; end if;
  insert into tenants(name) values(left(p_name,200)) returning id into t;
  insert into tenant_users(tenant_id,user_id,role) values(t,p_user_id,'OWNER');
  return t;
end $$;

create table if not exists mfa_credentials (
  user_id uuid not null references users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  secret_ciphertext text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,tenant_id)
);

create table if not exists connector_credentials (
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null check(provider in ('github','vercel','mercado_pago')),
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(tenant_id,provider)
);

create table if not exists payment_capabilities (
  payment_id uuid primary key references payments(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  issued_at timestamptz not null default now()
);

alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check check(status in ('queued','running','awaiting_approval','awaiting_mfa','completed','failed','dead'));

alter table mfa_credentials enable row level security;
alter table connector_credentials enable row level security;
alter table payment_capabilities enable row level security;

drop policy if exists vertice_tenant_isolation on mfa_credentials;
create policy vertice_tenant_isolation on mfa_credentials for all to public
using(tenant_id=app_current_tenant() and app_is_tenant_member(tenant_id))
with check(tenant_id=app_current_tenant() and app_is_tenant_member(tenant_id));

drop policy if exists vertice_tenant_isolation on connector_credentials;
create policy vertice_tenant_isolation on connector_credentials for all to public
using(tenant_id=app_current_tenant() and app_is_tenant_member(tenant_id))
with check(tenant_id=app_current_tenant() and app_is_tenant_member(tenant_id));

drop policy if exists vertice_tenant_isolation on payment_capabilities;
create policy vertice_tenant_isolation on payment_capabilities for all to public
using(tenant_id=app_current_tenant() and app_is_tenant_member(tenant_id))
with check(tenant_id=app_current_tenant() and app_is_tenant_member(tenant_id));

create index if not exists idx_tasks_mfa on tasks(status,tenant_id,updated_at) where status='awaiting_mfa';
create index if not exists idx_tasks_approval on tasks(status,tenant_id,updated_at) where status='awaiting_approval';
create index if not exists idx_connector_credentials_tenant on connector_credentials(tenant_id);

commit;
