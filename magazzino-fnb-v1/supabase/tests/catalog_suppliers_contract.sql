-- Catalog + suppliers schema contract.
select expected.table_name,
       to_regclass('public.' || expected.table_name) is not null as exists
from (values
  ('categories'),
  ('articles'),
  ('store_articles'),
  ('suppliers'),
  ('store_suppliers'),
  ('store_article_suppliers'),
  ('purchase_price_history'),
  ('notifications')
) as expected(table_name)
order by expected.table_name;

select c.relname, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'categories', 'articles', 'store_articles', 'suppliers',
    'store_suppliers', 'store_article_suppliers',
    'purchase_price_history', 'notifications'
  )
order by c.relname;

select t.typname as enum_name, e.enumlabel
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
join pg_enum e on e.enumtypid = t.oid
where n.nspname = 'public'
  and t.typname in (
    'catalog_base_unit',
    'purchase_price_source',
    'notification_type',
    'notification_severity'
  )
order by t.typname, e.enumsortorder;

select routine_schema, routine_name, security_type
from information_schema.routines
where routine_schema in ('public', 'private')
  and routine_name in (
    'current_user_can_read_article',
    'current_user_can_read_supplier',
    'admin_create_store_article',
    'admin_associate_article_to_store',
    'admin_associate_supplier_to_store',
    'admin_link_article_supplier',
    'admin_set_preferred_supplier',
    'admin_set_supplier_price',
    'record_store_article_supplier_price'
  )
order by routine_schema, routine_name;

select table_name,
       has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') as authenticated_can_delete
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'categories', 'articles', 'store_articles', 'suppliers',
    'store_suppliers', 'store_article_suppliers',
    'purchase_price_history', 'notifications'
  )
order by table_name;

select
  has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE') as can_mark_read,
  has_column_privilege('authenticated', 'public.notifications', 'severity', 'UPDATE') as can_change_severity,
  has_column_privilege('authenticated', 'public.notifications', 'body', 'UPDATE') as can_change_body;
