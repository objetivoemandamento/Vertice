begin;

alter function public.app_current_user() set search_path=pg_catalog,public;
alter function public.app_current_tenant() set search_path=pg_catalog,public;
alter function public.deny_audit_mutation() set search_path=pg_catalog,public;

commit;
