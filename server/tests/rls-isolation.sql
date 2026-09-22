-- Run with two staging users. This script is intentionally explicit and fails on any cross-tenant visibility.
begin;
select set_config('app.user_id',:'TENANT_A_USER',true), set_config('app.tenant_id',:'TENANT_A_ID',true);
do $$ begin if exists(select 1 from companies where tenant_id=:'TENANT_B_ID') then raise exception 'RLS_BREACH_COMPANIES'; end if; end $$;
do $$ begin if exists(select 1 from payments where tenant_id=:'TENANT_B_ID') then raise exception 'RLS_BREACH_PAYMENTS'; end if; end $$;
rollback;
