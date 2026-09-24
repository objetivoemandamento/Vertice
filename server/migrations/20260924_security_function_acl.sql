begin;

revoke execute on function public.app_create_tenant_for_user(uuid,text) from anon,authenticated;
revoke execute on function public.app_is_tenant_member(uuid) from anon,authenticated;
revoke execute on function public.app_tenant_for_payment(text,text) from anon,authenticated;
revoke execute on function public.app_tenant_for_user(uuid) from anon,authenticated;
revoke execute on function public.app_user_for_payment(text,text) from anon,authenticated;
revoke execute on function public.enforce_owner_tenant() from anon,authenticated;
revoke execute on function public.enforce_user_tenant() from anon,authenticated;

commit;
