begin;

create table if not exists ai_proposals (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  mode text not null check (mode in ('comando','operacao','monitoramento')),
  command text not null,
  reason text not null default '',
  intent text not null default 'execute',
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_proposals_owner on ai_proposals(tenant_id,user_id,created_at desc);

alter table ai_proposals enable row level security;
drop policy if exists vertice_tenant_isolation on ai_proposals;
create policy vertice_tenant_isolation on ai_proposals for all to public
using (tenant_id=app_current_tenant() and app_is_tenant_member(tenant_id))
with check (tenant_id=app_current_tenant() and app_is_tenant_member(tenant_id));

commit;
