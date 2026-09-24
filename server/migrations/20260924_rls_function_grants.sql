begin;

grant execute on function public.app_is_tenant_member(uuid) to authenticated;

commit;
