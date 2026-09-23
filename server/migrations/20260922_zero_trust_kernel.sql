begin;

create extension if not exists pgcrypto;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active','suspended','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tenant_users (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('OWNER','ADMIN','OPERATOR','VIEWER')),
  created_at timestamptz not null default now(),
  primary key (tenant_id,user_id)
);

create index if not exists idx_tenant_users_user on tenant_users(user_id);

insert into tenants(id,name)
select gen_random_uuid(), 'VÉRTICE - ' || u.email
from users u
where not exists (select 1 from tenant_users tu where tu.user_id=u.id);

insert into tenant_users(tenant_id,user_id,role)
select t.id,u.id,'OWNER'
from users u
join tenants t on t.name='VÉRTICE - ' || u.email
where not exists(select 1 from tenant_users tu where tu.user_id=u.id);

alter table companies add column if not exists tenant_id uuid;
alter table subscriptions add column if not exists tenant_id uuid;
alter table payments add column if not exists tenant_id uuid;
alter table devices add column if not exists tenant_id uuid;
alter table commands add column if not exists tenant_id uuid;
alter table analyses add column if not exists tenant_id uuid;
alter table history add column if not exists tenant_id uuid;
alter table monthly_sales add column if not exists tenant_id uuid;
alter table ai_conversations add column if not exists tenant_id uuid;
alter table refresh_tokens add column if not exists tenant_id uuid;

update companies c set tenant_id=tu.tenant_id from tenant_users tu where tu.user_id=c.owner_user_id and c.tenant_id is null;
update subscriptions s set tenant_id=tu.tenant_id from tenant_users tu where tu.user_id=s.user_id and s.tenant_id is null;
update payments p set tenant_id=tu.tenant_id from tenant_users tu where tu.user_id=p.user_id and p.tenant_id is null;
update devices d set tenant_id=tu.tenant_id from tenant_users tu where tu.user_id=d.user_id and d.tenant_id is null;
update commands c set tenant_id=tu.tenant_id from tenant_users tu where tu.user_id=c.user_id and c.tenant_id is null;
update analyses a set tenant_id=tu.tenant_id from tenant_users tu where tu.user_id=a.user_id and a.tenant_id is null;
update history h set tenant_id=tu.tenant_id from tenant_users tu where tu.user_id=h.user_id and h.tenant_id is null;
update monthly_sales m set tenant_id=tu.tenant_id from tenant_users tu where tu.user_id=m.user_id and m.tenant_id is null;
update ai_conversations a set tenant_id=tu.tenant_id from tenant_users tu where tu.user_id=a.user_id and a.tenant_id is null;
update refresh_tokens r set tenant_id=tu.tenant_id from tenant_users tu where tu.user_id=r.user_id and r.tenant_id is null;

alter table companies alter column tenant_id set not null;
alter table subscriptions alter column tenant_id set not null;
alter table payments alter column tenant_id set not null;
alter table devices alter column tenant_id set not null;
alter table commands alter column tenant_id set not null;
alter table analyses alter column tenant_id set not null;
alter table history alter column tenant_id set not null;
alter table monthly_sales alter column tenant_id set not null;
alter table ai_conversations alter column tenant_id set not null;
alter table refresh_tokens alter column tenant_id set not null;

do $$ begin
  alter table companies add constraint fk_companies_tenant foreign key(tenant_id) references tenants(id) on delete cascade;
exception when duplicate_object then null; end $vertice$;
do $$ begin
  alter table subscriptions add constraint fk_subscriptions_tenant foreign key(tenant_id) references tenants(id) on delete cascade;
exception when duplicate_object then null; end $vertice$;
do $$ begin
  alter table payments add constraint fk_payments_tenant foreign key(tenant_id) references tenants(id) on delete cascade;
exception when duplicate_object then null; end $vertice$;
do $$ begin
  alter table devices add constraint fk_devices_tenant foreign key(tenant_id) references tenants(id) on delete cascade;
exception when duplicate_object then null; end $vertice$;
do $$ begin
  alter table commands add constraint fk_commands_tenant foreign key(tenant_id) references tenants(id) on delete cascade;
exception when duplicate_object then null; end $vertice$;
do $$ begin
  alter table analyses add constraint fk_analyses_tenant foreign key(tenant_id) references tenants(id) on delete cascade;
exception when duplicate_object then null; end $vertice$;
do $$ begin
  alter table history add constraint fk_history_tenant foreign key(tenant_id) references tenants(id) on delete cascade;
exception when duplicate_object then null; end $vertice$;
do $$ begin
  alter table monthly_sales add constraint fk_monthly_sales_tenant foreign key(tenant_id) references tenants(id) on delete cascade;
exception when duplicate_object then null; end $vertice$;
do $$ begin
  alter table ai_conversations add constraint fk_ai_conversations_tenant foreign key(tenant_id) references tenants(id) on delete cascade;
exception when duplicate_object then null; end $vertice$;
do $$ begin
  alter table refresh_tokens add constraint fk_refresh_tokens_tenant foreign key(tenant_id) references tenants(id) on delete cascade;
exception when duplicate_object then null; end $vertice$;

create table if not exists tasks (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete restrict,
  idempotency_key text not null,
  status text not null default 'queued' check(status in ('queued','running','completed','failed','dead')),
  attempts integer not null default 0,
  locked_by text,
  locked_until timestamptz,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,idempotency_key)
);

create index if not exists idx_tasks_claim on tasks(tenant_id,status,locked_until,created_at);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  outcome text not null check(outcome in ('success','failure','denied')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function deny_audit_mutation() returns trigger language plpgsql as $vertice$
begin raise exception 'AUDIT_LOG_IMMUTABLE'; end $vertice$;

drop trigger if exists audit_logs_no_update on audit_logs;
create trigger audit_logs_no_update before update or delete on audit_logs for each row execute function deny_audit_mutation();

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique(provider,event_id)
);

create table if not exists outbox_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','published','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_outbox_aggregate_event on outbox_events(tenant_id,aggregate_type,aggregate_id,event_type);
create index if not exists idx_outbox_pending on outbox_events(status,available_at,created_at);

create table if not exists connector_executions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  idempotency_key text not null,
  connector text not null,
  status text not null check(status in ('running','completed','failed')),
  response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,idempotency_key)
);
create index if not exists idx_connector_exec_tenant on connector_executions(tenant_id,created_at desc);
alter table connector_executions enable row level security;

create index if not exists idx_all_tenant_companies on companies(tenant_id);
create index if not exists idx_all_tenant_subscriptions on subscriptions(tenant_id);
create index if not exists idx_all_tenant_payments on payments(tenant_id);
create index if not exists idx_all_tenant_devices on devices(tenant_id);
create index if not exists idx_all_tenant_commands on commands(tenant_id);
create index if not exists idx_all_tenant_analyses on analyses(tenant_id);
create index if not exists idx_all_tenant_history on history(tenant_id);
create index if not exists idx_all_tenant_sales on monthly_sales(tenant_id);
create index if not exists idx_all_tenant_ai on ai_conversations(tenant_id);
create index if not exists idx_all_tenant_refresh on refresh_tokens(tenant_id);

create or replace function enforce_user_tenant() returns trigger language plpgsql security definer set search_path=public as $vertice$
declare resolved uuid;
begin
  select tenant_id into resolved from tenant_users where user_id=new.user_id order by created_at asc limit 1;
  if resolved is null then raise exception 'TENANT_NOT_FOUND_FOR_USER'; end if;
  if new.tenant_id is not null and new.tenant_id <> resolved then raise exception 'TENANT_MISMATCH'; end if;
  new.tenant_id := resolved;
  return new;
end $vertice$;

create or replace function enforce_owner_tenant() returns trigger language plpgsql security definer set search_path=public as $vertice$
declare resolved uuid;
begin
  select tenant_id into resolved from tenant_users where user_id=new.owner_user_id order by created_at asc limit 1;
  if resolved is null then raise exception 'TENANT_NOT_FOUND_FOR_USER'; end if;
  if new.tenant_id is not null and new.tenant_id <> resolved then raise exception 'TENANT_MISMATCH'; end if;
  new.tenant_id := resolved;
  return new;
end $vertice$;

drop trigger if exists trg_companies_tenant on companies;
create trigger trg_companies_tenant before insert or update of owner_user_id,tenant_id on companies for each row execute function enforce_owner_tenant();
drop trigger if exists trg_subscriptions_tenant on subscriptions;
create trigger trg_subscriptions_tenant before insert or update of user_id,tenant_id on subscriptions for each row execute function enforce_user_tenant();
drop trigger if exists trg_payments_tenant on payments;
create trigger trg_payments_tenant before insert or update of user_id,tenant_id on payments for each row execute function enforce_user_tenant();
drop trigger if exists trg_devices_tenant on devices;
create trigger trg_devices_tenant before insert or update of user_id,tenant_id on devices for each row execute function enforce_user_tenant();
drop trigger if exists trg_commands_tenant on commands;
create trigger trg_commands_tenant before insert or update of user_id,tenant_id on commands for each row execute function enforce_user_tenant();
drop trigger if exists trg_analyses_tenant on analyses;
create trigger trg_analyses_tenant before insert or update of user_id,tenant_id on analyses for each row execute function enforce_user_tenant();
drop trigger if exists trg_history_tenant on history;
create trigger trg_history_tenant before insert or update of user_id,tenant_id on history for each row execute function enforce_user_tenant();
drop trigger if exists trg_monthly_sales_tenant on monthly_sales;
create trigger trg_monthly_sales_tenant before insert or update of user_id,tenant_id on monthly_sales for each row execute function enforce_user_tenant();
drop trigger if exists trg_ai_conversations_tenant on ai_conversations;
create trigger trg_ai_conversations_tenant before insert or update of user_id,tenant_id on ai_conversations for each row execute function enforce_user_tenant();
drop trigger if exists trg_refresh_tokens_tenant on refresh_tokens;
create trigger trg_refresh_tokens_tenant before insert or update of user_id,tenant_id on refresh_tokens for each row execute function enforce_user_tenant();

alter table tenant_users enable row level security;
alter table tenants enable row level security;
alter table companies enable row level security;
alter table subscriptions enable row level security;
alter table payments enable row level security;
alter table devices enable row level security;
alter table commands enable row level security;
alter table analyses enable row level security;
alter table history enable row level security;
alter table monthly_sales enable row level security;
alter table ai_conversations enable row level security;
alter table refresh_tokens enable row level security;
alter table tasks enable row level security;
alter table audit_logs enable row level security;
alter table outbox_events enable row level security;

create or replace function app_current_tenant() returns uuid language sql stable as $vertice$
  select nullif(current_setting('app.tenant_id', true),'')::uuid
$$;

create or replace function app_current_user() returns uuid language sql stable as $vertice$
  select nullif(current_setting('app.user_id', true),'')::uuid
$$;

create or replace function app_is_tenant_member(target uuid) returns boolean language sql stable security definer set search_path=public as $vertice$
  select exists(select 1 from tenant_users tu where tu.tenant_id=target and tu.user_id=app_current_user())
$vertice$;

create or replace function app_tenant_for_user(target uuid) returns uuid language sql stable security definer set search_path=public as $vertice$
  select tenant_id from tenant_users where user_id=target order by created_at asc limit 1
$vertice$;

drop policy if exists vertice_tenant_isolation on tenants;
create policy vertice_tenant_isolation on tenants for all to public
using (id=app_current_tenant() and app_is_tenant_member(id))
with check (id=app_current_tenant() and app_is_tenant_member(id));

drop policy if exists vertice_tenant_user_isolation on tenant_users;
create policy vertice_tenant_user_isolation on tenant_users for all to public
using (tenant_id=app_current_tenant() and app_is_tenant_member(tenant_id))
with check (tenant_id=app_current_tenant() and app_is_tenant_member(tenant_id));

do $$ declare t text; begin
  foreach t in array array['companies','subscriptions','payments','devices','commands','analyses','history','monthly_sales','ai_conversations','refresh_tokens','tasks','audit_logs','outbox_events','connector_executions'] loop
    execute format('drop policy if exists vertice_tenant_isolation on %I',t);
    execute format('create policy vertice_tenant_isolation on %I for all to public using (tenant_id = app_current_tenant() and app_is_tenant_member(tenant_id)) with check (tenant_id = app_current_tenant() and app_is_tenant_member(tenant_id))',t);
  end loop;
end $vertice$;

commit;
