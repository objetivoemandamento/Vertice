#!/bin/sh
set -eu

PSQL="psql -v ON_ERROR_STOP=1 --username \"$POSTGRES_USER\" --dbname \"$POSTGRES_DB\""
if $PSQL -tAc "select 1 from pg_roles where rolname='vertice_app'" | grep -q '^1$'; then
  $PSQL -v app_db_password="$APP_DB_PASSWORD" -c "alter role vertice_app password :'app_db_password';"
else
  $PSQL -v app_db_password="$APP_DB_PASSWORD" -c "create role vertice_app login nosuperuser nobypassrls nocreaterole nocreatedb noreplication password :'app_db_password';"
fi

$PSQL -c "grant connect on database \"$POSTGRES_DB\" to vertice_app;
grant usage on schema public to vertice_app;
grant select,insert,update,delete on all tables in schema public to vertice_app;
grant usage,select on all sequences in schema public to vertice_app;
alter default privileges in schema public grant select,insert,update,delete on tables to vertice_app;
alter default privileges in schema public grant usage,select on sequences to vertice_app;"
