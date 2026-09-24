begin;

alter table webhook_events enable row level security;
drop policy if exists vertice_tenant_webhook_events on webhook_events;
create policy vertice_tenant_webhook_events on webhook_events for all to public
using (exists(select 1 from tenant_users tu where tu.tenant_id=app_current_tenant() and tu.user_id=app_current_user()))
with check (exists(select 1 from tenant_users tu where tu.tenant_id=app_current_tenant() and tu.user_id=app_current_user()));

alter function public.app_current_user() set search_path=public;
alter function public.app_current_tenant() set search_path=public;
alter function public.deny_audit_mutation() set search_path=public;

revoke execute on function public.app_create_tenant_for_user(uuid,text) from public;
revoke execute on function public.app_is_tenant_member(uuid) from public;
revoke execute on function public.app_tenant_for_payment(text,text) from public;
revoke execute on function public.app_tenant_for_user(uuid) from public;
revoke execute on function public.app_user_for_payment(text,text) from public;
revoke execute on function public.enforce_owner_tenant() from public;
revoke execute on function public.enforce_user_tenant() from public;

commit;
