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
