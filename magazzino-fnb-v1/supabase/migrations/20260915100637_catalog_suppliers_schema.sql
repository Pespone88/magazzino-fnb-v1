create type public.catalog_base_unit as enum ('CF', 'PZ', 'KG', 'L');
create type public.purchase_price_source as enum ('MANUAL', 'RECEIPT');
create type public.notification_type as enum ('PRICE_CHANGE');
create type public.notification_severity as enum ('NORMAL', 'SIGNIFICANT');

create or replace function private.normalize_catalog_name(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(lower(btrim(coalesce(value, ''))), '[[:punct:]]+', ' ', 'g'),
    '\s+', ' ', 'g'
  );
$$;

revoke all on function private.normalize_catalog_name(text) from public, anon;
grant execute on function private.normalize_catalog_name(text) to authenticated;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_not_blank check (length(btrim(name)) > 0)
);

create unique index categories_active_name_unique
  on public.categories (lower(btrim(name)))
  where active = true;

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (private.normalize_catalog_name(name)) stored,
  category_id uuid not null references public.categories(id) on delete restrict,
  base_unit public.catalog_base_unit not null,
  ean text,
  package_quantity numeric(14,3) not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint articles_name_not_blank check (length(btrim(name)) > 0),
  constraint articles_package_quantity_positive check (package_quantity > 0),
  constraint articles_ean_valid check (
    ean is null or (ean = btrim(ean) and length(ean) > 0)
  )
);

create unique index articles_ean_unique
  on public.articles (ean)
  where ean is not null;
create index articles_normalized_name_idx on public.articles (normalized_name);

create table public.store_articles (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  article_id uuid not null references public.articles(id) on delete restrict,
  min_stock numeric(14,3) not null default 0,
  target_stock numeric(14,3) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_articles_store_article_unique unique (store_id, article_id),
  constraint store_articles_id_store_unique unique (id, store_id),
  constraint store_articles_min_nonnegative check (min_stock >= 0),
  constraint store_articles_target_valid check (target_stock >= min_stock)
);

create index store_articles_store_idx on public.store_articles (store_id, active);
create index store_articles_article_idx on public.store_articles (article_id);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vat_number text,
  tax_code text,
  email text,
  phone text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_name_not_blank check (length(btrim(name)) > 0)
);

create index suppliers_name_idx on public.suppliers (lower(name));

create table public.store_suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  customer_code text,
  minimum_order_amount numeric(14,4),
  delivery_notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_suppliers_store_supplier_unique unique (store_id, supplier_id),
  constraint store_suppliers_id_store_unique unique (id, store_id),
  constraint store_suppliers_minimum_order_nonnegative check (
    minimum_order_amount is null or minimum_order_amount >= 0
  )
);

create index store_suppliers_store_idx on public.store_suppliers (store_id, active);

create table public.store_article_suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  store_article_id uuid not null,
  store_supplier_id uuid not null,
  supplier_article_code text,
  current_package_price numeric(14,4) not null,
  is_preferred boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_article_suppliers_price_nonnegative check (current_package_price >= 0),
  constraint store_article_suppliers_pair_unique unique (store_article_id, store_supplier_id),
  constraint store_article_suppliers_article_store_fk
    foreign key (store_article_id, store_id)
    references public.store_articles(id, store_id) on delete restrict,
  constraint store_article_suppliers_supplier_store_fk
    foreign key (store_supplier_id, store_id)
    references public.store_suppliers(id, store_id) on delete restrict
);

create unique index store_article_suppliers_one_preferred
  on public.store_article_suppliers (store_article_id)
  where active = true and is_preferred = true;
create index store_article_suppliers_store_idx
  on public.store_article_suppliers (store_id, active);

create table public.purchase_price_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  store_article_supplier_id uuid not null references public.store_article_suppliers(id) on delete restrict,
  package_price numeric(14,4) not null,
  package_quantity_snapshot numeric(14,3) not null,
  base_unit_snapshot public.catalog_base_unit not null,
  unit_price_snapshot numeric(18,6) not null,
  previous_package_price numeric(14,4),
  absolute_change numeric(14,4),
  percent_change numeric(12,4),
  source public.purchase_price_source not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references public.profiles(id) on delete restrict,
  constraint purchase_history_price_nonnegative check (package_price >= 0),
  constraint purchase_history_package_qty_positive check (package_quantity_snapshot > 0)
);

create index purchase_price_history_link_date_idx
  on public.purchase_price_history (store_article_supplier_id, recorded_at desc);
create index purchase_price_history_store_idx
  on public.purchase_price_history (store_id, recorded_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete restrict,
  store_id uuid references public.stores(id) on delete restrict,
  type public.notification_type not null,
  severity public.notification_severity not null default 'NORMAL',
  title text not null,
  body text not null,
  entity_type text not null,
  entity_id uuid not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_title_not_blank check (length(btrim(title)) > 0),
  constraint notifications_body_not_blank check (length(btrim(body)) > 0)
);

create index notifications_recipient_unread_idx
  on public.notifications (recipient_user_id, created_at desc)
  where read_at is null;

alter table public.categories enable row level security;
alter table public.articles enable row level security;
alter table public.store_articles enable row level security;
alter table public.suppliers enable row level security;
alter table public.store_suppliers enable row level security;
alter table public.store_article_suppliers enable row level security;
alter table public.purchase_price_history enable row level security;
alter table public.notifications enable row level security;

revoke all on table public.categories from anon, authenticated;
revoke all on table public.articles from anon, authenticated;
revoke all on table public.store_articles from anon, authenticated;
revoke all on table public.suppliers from anon, authenticated;
revoke all on table public.store_suppliers from anon, authenticated;
revoke all on table public.store_article_suppliers from anon, authenticated;
revoke all on table public.purchase_price_history from anon, authenticated;
revoke all on table public.notifications from anon, authenticated;
