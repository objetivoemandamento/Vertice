-- Cross-tenant RLS proof executed as vertice_app.
\set ON_ERROR_STOP on
begin;
select set_config('app.user_id',:'TENANT_A_USER',true);
select set_config('app.tenant_id',:'TENANT_A_ID',true);

select count(*) as leaked_companies from companies where tenant_id=:'TENANT_B_ID' \gset
\if :leaked_companies
  \echo 'RLS_BREACH_COMPANIES'
  \quit 1
\endif

select count(*) as leaked_payments from payments where tenant_id=:'TENANT_B_ID' \gset
\if :leaked_payments
  \echo 'RLS_BREACH_PAYMENTS'
  \quit 1
\endif
rollback;
\echo 'PASS RLS: tenant A cannot see tenant B rows';
