begin;

alter table tenants add column if not exists emergency_stop boolean not null default false;

alter table commands add column if not exists updated_at timestamptz not null default now();

update commands set status='succeeded',updated_at=coalesce(updated_at,now()) where status='completed';
update commands set status='executing',updated_at=coalesce(updated_at,now()) where status='running';

alter table commands drop constraint if exists commands_status_check;
alter table commands add constraint commands_status_check check (
  status in ('created','validated','authorized','queued','dispatched','executing','succeeded','failed','cancelled')
);

create table if not exists command_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete restrict,
  command_id uuid not null references commands(id) on delete cascade,
  status text not null check (status in ('created','validated','authorized','queued','dispatched','executing','succeeded','failed','cancelled')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_command_events_lookup on command_events(tenant_id,command_id,created_at);
alter table command_events enable row level security;
drop policy if exists vertice_tenant_isolation on command_events;
create policy vertice_tenant_isolation on command_events for all to public
using (tenant_id=app_current_tenant() and app_is_tenant_member(tenant_id))
with check (tenant_id=app_current_tenant() and app_is_tenant_member(tenant_id));

create index if not exists idx_commands_device_status on commands(tenant_id,device_id,status,created_at);

commit;
