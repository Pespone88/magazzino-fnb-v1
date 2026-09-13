-- Read-only contract checks for the first-admin bootstrap.
select to_regclass('private.admin_bootstrap_emails') is not null as bootstrap_table_exists;
select p.prosecdef as handler_is_security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private' and p.proname = 'handle_new_auth_user';
