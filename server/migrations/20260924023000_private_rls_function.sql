begin;

create schema if not exists private;

create or replace function private.app_is_tenant_member(target uuid)
returns boolean
language sql stable security definer
set search_path=public
as $$
  select exists(
    select 1 from tenant_users tu
    where tu.tenant_id=target
      and tu.user_id=app_current_user()
  )
$$;

grant usage on schema private to authenticated;
grant execute on function private.app_is_tenant_member(uuid) to authenticated;
do $grant$
begin
  if exists (select 1 from pg_roles where rolname='vertice_app') then
    grant usage on schema private to vertice_app;
    grant execute on function private.app_is_tenant_member(uuid) to vertice_app;
  end if;
end $grant$;
revoke execute on function private.app_is_tenant_member(uuid) from anon,public;

do $vertice$
declare t text;
begin
  alter policy vertice_tenant_isolation on tenants
    using (id=app_current_tenant() and private.app_is_tenant_member(id))
    with check (id=app_current_tenant() and private.app_is_tenant_member(id));
  alter policy vertice_tenant_user_isolation on tenant_users
    using (tenant_id=app_current_tenant() and private.app_is_tenant_member(tenant_id))
    with check (tenant_id=app_current_tenant() and private.app_is_tenant_member(tenant_id));

  foreach t in array array[
    'companies','subscriptions','payments','devices','commands','analyses',
    'history','monthly_sales','ai_conversations','refresh_tokens','tasks',
    'audit_logs','outbox_events','connector_executions','mfa_credentials',
    'connector_credentials','payment_capabilities','command_events','ai_proposals'
  ] loop
    execute format(
      'alter policy vertice_tenant_isolation on %I using (tenant_id=app_current_tenant() and private.app_is_tenant_member(tenant_id)) with check (tenant_id=app_current_tenant() and private.app_is_tenant_member(tenant_id))',
      t
    );
  end loop;
end $vertice$;

drop function if exists public.app_is_tenant_member(uuid);

commit;
