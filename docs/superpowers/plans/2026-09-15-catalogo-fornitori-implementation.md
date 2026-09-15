# Catalogo + Fornitori Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare il primo modulo operativo reale di Magazzini F&B: catalogo articoli centrale con UX store-first, categorie, fornitori, minimo/obiettivo, prezzi per confezione, storico prezzi automatico, notifiche variazioni prezzo e isolamento RLS tra store.

**Architecture:** Il database Supabase resta la fonte autorevole per integrità, autorizzazione e storico. Le entità centrali (`articles`, `categories`, `suppliers`) vengono associate agli store tramite tabelle esplicite. Le scritture strutturali sono Admin-only; le operazioni multi-tabella usano RPC transazionali `SECURITY INVOKER`, mentre lo storico prezzi e le notifiche sono garantiti da trigger privati per non poter essere saltati da futuri flussi. Il frontend React resta senza router aggiuntivo: `AppShell` mantiene lo store attivo e monta feature isolate sotto `src/catalog/` tramite un gateway testabile.

**Tech Stack:** React 19.3, TypeScript 6.0, Vite 8.3, Vitest 5, Testing Library, Supabase JS 2.116, PostgreSQL/Supabase RLS, Cloudflare Workers Static Assets.

**Spec:** `docs/superpowers/specs/2026-09-15-catalogo-fornitori-design.md`

## Global Constraints

- Mantenere costo infrastrutturale ricorrente target a €0/mese; non aggiungere servizi o dipendenze a pagamento.
- Non introdurre mai il brand `RATIO`: l'app resta neutra come **Magazzini F&B**.
- UX store-first: l'utente lavora sempre dentro Eccellenze della Costiera o Nonna Titti; il catalogo centrale non è una schermata operativa quotidiana.
- Unità ammesse esattamente: `CF`, `PZ`, `KG`, `L`.
- Quantità business con precisione massima di 3 decimali; prezzi confezione IVA inclusa con tipo numerico esatto PostgreSQL.
- Non mostrare né calcolare giacenza, sotto-minimo o valore magazzino in questa fase: il ledger movimenti non esiste ancora.
- Nessuna cancellazione fisica di record business; non concedere `DELETE` ai client.
- EAN opzionale, ma globalmente unico quando valorizzato; non riutilizzare l'EAN di un articolo disattivato.
- I duplicati per nome sono un avviso assistito, non un vincolo di unicità.
- `target_stock >= min_stock`, entrambi non negativi.
- Un solo fornitore preferito per articolo/store.
- Ogni modifica reale del prezzo corrente deve produrre storico automatico e notifica a tutti gli Admin attivi; oltre ±5% la notifica è `SIGNIFICANT`.
- Se il prezzo precedente è 0, la percentuale è `NULL` e la notifica resta `NORMAL`: non inventare una percentuale infinita.
- Nessuna autorizzazione deve dipendere da `user_metadata`; usare profili/membership database e gli helper privati esistenti.
- Nessuna secret/service-role key nel browser.
- Tabelle esposte al Data API: RLS sempre abilitata e grant minimi espliciti.
- Funzioni RPC pubbliche: `SECURITY INVOKER`, `EXECUTE` revocato a `PUBLIC`/`anon`, con grant solo a `authenticated`.
- Trigger privilegiati: funzione in schema `private`, `SECURITY DEFINER`, `search_path=''`, nessun `EXECUTE` pubblico.
- Implementazione TDD: per ogni comportamento prima test rosso, poi codice minimo, poi test verde, poi commit.
- Nessuna nuova libreria npm salvo necessità dimostrata; questo piano non ne richiede.

---

## Task 1: Creare lo schema catalogo in stato locked-down

**Files:**
- Create via CLI: `magazzino-fnb-v1/supabase/migrations/*_catalog_suppliers_schema.sql`
- Create: `magazzino-fnb-v1/supabase/tests/catalog_suppliers_contract.sql`
- Reference: `magazzino-fnb-v1/supabase/migrations/20260913_1733_foundation_access_model.sql`

**Interfaces:**
- PostgreSQL enum `public.catalog_base_unit`: `CF | PZ | KG | L`.
- PostgreSQL enum `public.purchase_price_source`: `MANUAL | RECEIPT`.
- PostgreSQL enum `public.notification_type`: `PRICE_CHANGE`.
- PostgreSQL enum `public.notification_severity`: `NORMAL | SIGNIFICANT`.
- Nuove tabelle: `categories`, `articles`, `store_articles`, `suppliers`, `store_suppliers`, `store_article_suppliers`, `purchase_price_history`, `notifications`.
- Helper deterministico `private.normalize_catalog_name(text)`.

- [ ] **1.1 — Scrivere prima il contract SQL che descrive lo schema atteso.**

Creare `supabase/tests/catalog_suppliers_contract.sql` con query non distruttive che controllino esistenza e RLS:

```sql
-- Catalog + suppliers schema contract.
select to_regclass('public.categories') is not null as categories_exists;
select to_regclass('public.articles') is not null as articles_exists;
select to_regclass('public.store_articles') is not null as store_articles_exists;
select to_regclass('public.suppliers') is not null as suppliers_exists;
select to_regclass('public.store_suppliers') is not null as store_suppliers_exists;
select to_regclass('public.store_article_suppliers') is not null as store_article_suppliers_exists;
select to_regclass('public.purchase_price_history') is not null as purchase_price_history_exists;
select to_regclass('public.notifications') is not null as notifications_exists;

select relname, relrowsecurity
from pg_class
where oid in (
  'public.categories'::regclass,
  'public.articles'::regclass,
  'public.store_articles'::regclass,
  'public.suppliers'::regclass,
  'public.store_suppliers'::regclass,
  'public.store_article_suppliers'::regclass,
  'public.purchase_price_history'::regclass,
  'public.notifications'::regclass
)
order by relname;

select enumtypid::regtype::text as enum_name, enumlabel
from pg_enum
where enumtypid in (
  'public.catalog_base_unit'::regtype,
  'public.purchase_price_source'::regtype,
  'public.notification_type'::regtype,
  'public.notification_severity'::regtype
)
order by enum_name, enumsortorder;
```

Expected before migration: the first eight checks are `false`; do not attempt the enum query until the migration dry-run exists because missing enum types would error.

- [ ] **1.2 — Generate the migration file with Supabase CLI; do not invent a timestamp.**

Run from `magazzino-fnb-v1/`:

```bash
npx supabase migration new catalog_suppliers_schema
MIGRATION=$(ls -1t supabase/migrations/*_catalog_suppliers_schema.sql | head -1)
printf '%s\n' "$MIGRATION"
```

Expected: exactly one newly generated path ending in `_catalog_suppliers_schema.sql`.

- [ ] **1.3 — Add exact enum and normalization primitives.**

Migration beginning:

```sql
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
    '\s+',
    ' ',
    'g'
  );
$$;

revoke all on function private.normalize_catalog_name(text) from public, anon;
grant execute on function private.normalize_catalog_name(text) to authenticated;
```

The same normalization rule will later be mirrored in TypeScript for UX; database remains authoritative.

- [ ] **1.4 — Add the central and store-scoped tables with exact constraints.**

Use these shapes in the same migration:

```sql
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
    references public.store_articles(id, store_id)
    on delete restrict,
  constraint store_article_suppliers_supplier_store_fk
    foreign key (store_supplier_id, store_id)
    references public.store_suppliers(id, store_id)
    on delete restrict
);

create unique index store_article_suppliers_one_preferred
  on public.store_article_suppliers (store_article_id)
  where active = true and is_preferred = true;

create index store_article_suppliers_store_idx
  on public.store_article_suppliers (store_id, active);
```

The redundant `store_id` on `store_article_suppliers` is intentional: the composite foreign keys make it impossible to connect an article from one store to a supplier association from another store and simplify RLS.

- [ ] **1.5 — Add immutable history and notifications tables.**

```sql
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
```

- [ ] **1.6 — Lock every new table before any Data API grant exists.**

At the end of the schema migration:

```sql
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
```

No table is exposed between Task 1 and Task 2.

- [ ] **1.7 — Dry-run the migration transactionally against Supabase before persisting.**

Use the Supabase SQL execution tool with this shape: `BEGIN; <exact migration body>; ROLLBACK;`. Expected: no SQL error, no persistent new tables afterwards.

Then run:

```bash
npm run test:bootstrap
```

Expected: existing bootstrap tests remain green; the new SQL contract is documentation/remote verification and is not executed by Node.

- [ ] **1.8 — Commit schema + contract.**

```bash
git add supabase/migrations/*_catalog_suppliers_schema.sql supabase/tests/catalog_suppliers_contract.sql
git commit -m "feat: add catalog suppliers database schema"
```

---

## Task 2: Aggiungere RLS, operazioni atomiche e storico prezzo garantito dal database

**Files:**
- Create via CLI: `magazzino-fnb-v1/supabase/migrations/*_catalog_suppliers_operations.sql`
- Modify: `magazzino-fnb-v1/supabase/tests/catalog_suppliers_contract.sql`

**Interfaces:**
- Private read helpers: `private.current_user_can_read_article(uuid)`, `private.current_user_can_read_supplier(uuid)`.
- Public authenticated RPCs:
  - `admin_create_store_article(...) -> uuid`
  - `admin_associate_article_to_store(...) -> uuid`
  - `admin_associate_supplier_to_store(...) -> uuid`
  - `admin_link_article_supplier(...) -> uuid`
  - `admin_set_preferred_supplier(uuid) -> void`
  - `admin_set_supplier_price(uuid, numeric) -> void`
- Private trigger: `private.record_store_article_supplier_price()`.

- [ ] **2.1 — Extend the SQL contract before implementing policies/functions.**

Append checks for grants, functions and no DELETE privilege:

```sql
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
```

Expected after implementation: `authenticated_can_delete = false` for every row.

- [ ] **2.2 — Generate the operations migration.**

```bash
npx supabase migration new catalog_suppliers_operations
MIGRATION=$(ls -1t supabase/migrations/*_catalog_suppliers_operations.sql | head -1)
printf '%s\n' "$MIGRATION"
```

- [ ] **2.3 — Add private read helpers that reuse the existing store-access rule.**

```sql
create or replace function private.current_user_can_read_article(target_article_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_user_is_admin()
    or exists (
      select 1
      from public.store_articles sa
      where sa.article_id = target_article_id
        and private.current_user_has_store_access(sa.store_id)
    );
$$;

create or replace function private.current_user_can_read_supplier(target_supplier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_user_is_admin()
    or exists (
      select 1
      from public.store_suppliers ss
      where ss.supplier_id = target_supplier_id
        and private.current_user_has_store_access(ss.store_id)
    );
$$;

revoke all on function private.current_user_can_read_article(uuid) from public, anon;
revoke all on function private.current_user_can_read_supplier(uuid) from public, anon;
grant execute on function private.current_user_can_read_article(uuid) to authenticated;
grant execute on function private.current_user_can_read_supplier(uuid) to authenticated;
```

- [ ] **2.4 — Add explicit grants and RLS policies.**

Grant matrix:

```sql
grant select, insert, update on table public.categories to authenticated;
grant select, insert, update on table public.articles to authenticated;
grant select, insert, update on table public.store_articles to authenticated;
grant select, insert, update on table public.suppliers to authenticated;
grant select, insert, update on table public.store_suppliers to authenticated;
grant select, insert, update on table public.store_article_suppliers to authenticated;
grant select on table public.purchase_price_history to authenticated;
grant select, update on table public.notifications to authenticated;
```

Policies must be exact in intent:

```sql
create policy categories_select_authenticated
on public.categories for select to authenticated
using (true);

create policy categories_write_admin
on public.categories for insert to authenticated
with check (private.current_user_is_admin());

create policy categories_update_admin
on public.categories for update to authenticated
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

create policy articles_select_accessible
on public.articles for select to authenticated
using (private.current_user_can_read_article(id));

create policy articles_insert_admin
on public.articles for insert to authenticated
with check (private.current_user_is_admin());

create policy articles_update_admin
on public.articles for update to authenticated
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

create policy store_articles_select_accessible
on public.store_articles for select to authenticated
using (private.current_user_has_store_access(store_id));

create policy store_articles_insert_admin
on public.store_articles for insert to authenticated
with check (private.current_user_is_admin());

create policy store_articles_update_admin
on public.store_articles for update to authenticated
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

create policy suppliers_select_accessible
on public.suppliers for select to authenticated
using (private.current_user_can_read_supplier(id));

create policy suppliers_insert_admin
on public.suppliers for insert to authenticated
with check (private.current_user_is_admin());

create policy suppliers_update_admin
on public.suppliers for update to authenticated
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

create policy store_suppliers_select_accessible
on public.store_suppliers for select to authenticated
using (private.current_user_has_store_access(store_id));

create policy store_suppliers_insert_admin
on public.store_suppliers for insert to authenticated
with check (private.current_user_is_admin());

create policy store_suppliers_update_admin
on public.store_suppliers for update to authenticated
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

create policy store_article_suppliers_select_accessible
on public.store_article_suppliers for select to authenticated
using (private.current_user_has_store_access(store_id));

create policy store_article_suppliers_insert_admin
on public.store_article_suppliers for insert to authenticated
with check (private.current_user_is_admin());

create policy store_article_suppliers_update_admin
on public.store_article_suppliers for update to authenticated
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

create policy purchase_price_history_select_accessible
on public.purchase_price_history for select to authenticated
using (private.current_user_has_store_access(store_id));

create policy notifications_select_own
on public.notifications for select to authenticated
using (recipient_user_id = (select auth.uid()));

create policy notifications_update_own
on public.notifications for update to authenticated
using (recipient_user_id = (select auth.uid()))
with check (recipient_user_id = (select auth.uid()));
```

There must be no client INSERT/UPDATE policy for `purchase_price_history` and no client INSERT policy for `notifications`.

- [ ] **2.5 — Add the private trigger that freezes price snapshots and creates Admin notifications.**

Use one trigger for INSERT and price-changing UPDATE. The function must fetch the current article packaging once and use it for the snapshot.

```sql
create or replace function private.record_store_article_supplier_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package_quantity numeric(14,3);
  v_base_unit public.catalog_base_unit;
  v_article_name text;
  v_supplier_name text;
  v_absolute_change numeric(14,4);
  v_percent_change numeric(12,4);
  v_severity public.notification_severity := 'NORMAL';
begin
  select a.package_quantity, a.base_unit, a.name, s.name
    into v_package_quantity, v_base_unit, v_article_name, v_supplier_name
  from public.store_articles sa
  join public.articles a on a.id = sa.article_id
  join public.store_suppliers ss on ss.store_id = sa.store_id
  join public.suppliers s on s.id = ss.supplier_id
  where sa.id = new.store_article_id
    and ss.id = new.store_supplier_id;

  if tg_op = 'INSERT' then
    insert into public.purchase_price_history (
      store_id, store_article_supplier_id, package_price,
      package_quantity_snapshot, base_unit_snapshot, unit_price_snapshot,
      previous_package_price, absolute_change, percent_change,
      source, recorded_by
    ) values (
      new.store_id, new.id, new.current_package_price,
      v_package_quantity, v_base_unit,
      round(new.current_package_price / v_package_quantity, 6),
      null, null, null,
      'MANUAL'::public.purchase_price_source, (select auth.uid())
    );
    return new;
  end if;

  if new.current_package_price is not distinct from old.current_package_price then
    return new;
  end if;

  v_absolute_change := new.current_package_price - old.current_package_price;
  v_percent_change := case
    when old.current_package_price = 0 then null
    else round((v_absolute_change / old.current_package_price) * 100, 4)
  end;

  if v_percent_change is not null and abs(v_percent_change) > 5 then
    v_severity := 'SIGNIFICANT';
  end if;

  insert into public.purchase_price_history (
    store_id, store_article_supplier_id, package_price,
    package_quantity_snapshot, base_unit_snapshot, unit_price_snapshot,
    previous_package_price, absolute_change, percent_change,
    source, recorded_by
  ) values (
    new.store_id, new.id, new.current_package_price,
    v_package_quantity, v_base_unit,
    round(new.current_package_price / v_package_quantity, 6),
    old.current_package_price, v_absolute_change, v_percent_change,
    'MANUAL'::public.purchase_price_source, (select auth.uid())
  );

  insert into public.notifications (
    recipient_user_id, store_id, type, severity,
    title, body, entity_type, entity_id
  )
  select
    p.id,
    new.store_id,
    'PRICE_CHANGE'::public.notification_type,
    v_severity,
    'Variazione prezzo',
    v_article_name || ' · ' || v_supplier_name || ': ' ||
      old.current_package_price::text || ' € → ' || new.current_package_price::text || ' €',
    'STORE_ARTICLE_SUPPLIER',
    new.id
  from public.profiles p
  where p.active = true
    and p.global_role = 'ADMIN'::public.global_role;

  return new;
end;
$$;

revoke all on function private.record_store_article_supplier_price() from public, anon, authenticated;

create trigger store_article_supplier_price_audit
  after insert or update of current_package_price
  on public.store_article_suppliers
  for each row execute function private.record_store_article_supplier_price();
```

Expected invariants: initial link creates one history row and zero variation notifications; later price change creates one new history row plus one notification for each active Admin.

- [ ] **2.6 — Add atomic Admin RPCs with `SECURITY INVOKER`.**

Each RPC begins with:

```sql
if not private.current_user_is_admin() then
  raise exception 'Catalog administration requires ADMIN';
end if;
```

Implement these signatures:

```sql
public.admin_create_store_article(
  p_store_id uuid,
  p_name text,
  p_category_id uuid,
  p_base_unit public.catalog_base_unit,
  p_ean text,
  p_package_quantity numeric,
  p_min_stock numeric,
  p_target_stock numeric
) returns uuid

public.admin_associate_article_to_store(
  p_store_id uuid,
  p_article_id uuid,
  p_min_stock numeric,
  p_target_stock numeric
) returns uuid

public.admin_associate_supplier_to_store(
  p_store_id uuid,
  p_supplier_id uuid,
  p_customer_code text,
  p_minimum_order_amount numeric,
  p_delivery_notes text
) returns uuid

public.admin_link_article_supplier(
  p_store_article_id uuid,
  p_store_id uuid,
  p_supplier_id uuid,
  p_supplier_article_code text,
  p_current_package_price numeric,
  p_is_preferred boolean
) returns uuid

public.admin_set_preferred_supplier(
  p_store_article_supplier_id uuid
) returns void

public.admin_set_supplier_price(
  p_store_article_supplier_id uuid,
  p_new_package_price numeric
) returns void
```

Core implementation rules:

```sql
-- create article + store association atomically
insert into public.articles (...)
values (..., nullif(btrim(p_ean), ''), ...)
returning id into v_article_id;

insert into public.store_articles (...)
values (...)
returning id into v_store_article_id;

-- linking a supplier reuses/reactivates store_suppliers
insert into public.store_suppliers (store_id, supplier_id, active)
values (p_store_id, p_supplier_id, true)
on conflict (store_id, supplier_id)
do update set active = true, updated_at = now()
returning id into v_store_supplier_id;

-- before setting a new preferred supplier, unset the old one in the same transaction
if p_is_preferred then
  update public.store_article_suppliers
  set is_preferred = false, updated_at = now()
  where store_article_id = p_store_article_id
    and active = true;
end if;
```

`admin_set_supplier_price` must only update `current_package_price`; the database trigger is solely responsible for history and notifications.

Every public RPC must end with ACL hardening, matching its exact signature:

```sql
revoke all on function public.admin_create_store_article(uuid, text, uuid, public.catalog_base_unit, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.admin_create_store_article(uuid, text, uuid, public.catalog_base_unit, text, numeric, numeric, numeric) to authenticated;
```

Repeat for all six RPCs; do not leave default `PUBLIC EXECUTE`.

- [ ] **2.7 — Dry-run full operations migration and verify trigger behavior inside a rollback transaction.**

Use Supabase SQL execution with `BEGIN`, apply Task 1 + Task 2 SQL in a scratch transaction if Task 1 is still unapplied, insert a category/article/store supplier/link, update the price once, then assert:

```sql
select count(*) = 2 as two_history_rows
from public.purchase_price_history
where store_article_supplier_id = '<transaction-created-link-id>';

select count(*) >= 1 as admin_was_notified
from public.notifications
where entity_id = '<transaction-created-link-id>'
  and type = 'PRICE_CHANGE';
```

Use transaction-local IDs captured by SQL variables/temporary tables during execution; do not hardcode generated UUIDs in the committed migration. Roll back the transaction.

- [ ] **2.8 — Commit operations migration.**

```bash
git add supabase/migrations/*_catalog_suppliers_operations.sql supabase/tests/catalog_suppliers_contract.sql
git commit -m "feat: secure catalog operations and price history"
```

---

## Task 3: Applicare e verificare il database live senza dati di prova permanenti

**Files:**
- Create: `magazzino-fnb-v1/supabase/tests/catalog_suppliers_rls_checks.sql`
- Reference: both new migrations from Tasks 1-2.

**Interfaces:**
- RLS must allow Admin to both stores.
- A temporarily simulated normal user with one membership must see only that store's rows.
- SQL test must end in `ROLLBACK` and leave the real Admin unchanged.

- [ ] **3.1 — Write the cross-store RLS verification script before applying production schema.**

Create `supabase/tests/catalog_suppliers_rls_checks.sql` as a transaction-only diagnostic. It should:

1. Find one active Admin profile and save its id into a temporary table.
2. Create two transaction-only articles, one associated to each real store.
3. Temporarily change that same profile to `USER` inside the uncommitted transaction.
4. Add one active membership only to Eccellenze.
5. Set transaction-local JWT claims for that user and `SET LOCAL ROLE authenticated`.
6. Query `store_articles` and assert only Eccellenze test rows are visible.
7. Query central `articles` and assert the Nonna Titti-only test article is hidden.
8. `RESET ROLE; ROLLBACK;`.

Use this shape for the identity switch:

```sql
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.catalog_test_actor limit 1),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;
```

The script must contain explicit boolean result columns such as `sees_only_assigned_store = true` so a reviewer can inspect outputs without inference.

- [ ] **3.2 — Apply the two reviewed migrations to Supabase project `tfeuxskvrjnltfgzzxar`.**

Apply the exact committed SQL in order, using the Supabase migration-capable tool only after the transaction dry-runs are green. Do not edit SQL directly in production after applying; corrections require a new migration.

Expected: all eight tables and six RPCs exist; the live app's current auth flow remains unaffected because existing tables/functions are only referenced, not replaced.

- [ ] **3.3 — Execute both SQL contract files against live DB.**

Run:
- `supabase/tests/catalog_suppliers_contract.sql`
- `supabase/tests/catalog_suppliers_rls_checks.sql`

Expected:
- every table existence check true;
- RLS true on all eight tables;
- no authenticated DELETE privilege;
- cross-store user sees only the assigned store;
- rollback leaves the original Admin role and production rows unchanged.

- [ ] **3.4 — Run Supabase Security Advisor and fix every new security finding before proceeding.**

Expected: no new security errors/warnings caused by this module. In particular, there must be no publicly executable `SECURITY DEFINER` function. Existing intentional private helpers remain in `private` with ACLs revoked.

If an advisor flags one of the new public RPCs as `SECURITY DEFINER`, stop: the RPC was implemented incorrectly and must be changed to `SECURITY INVOKER` before frontend work.

- [ ] **3.5 — Commit the RLS verification script.**

```bash
git add supabase/tests/catalog_suppliers_rls_checks.sql
git commit -m "test: verify catalog cross-store isolation"
```

---

## Task 4: Implementare dominio catalogo, validazione decimali e permessi UI

**Files:**
- Create: `magazzino-fnb-v1/src/catalog/types.ts`
- Create: `magazzino-fnb-v1/src/catalog/validation.ts`
- Create: `magazzino-fnb-v1/src/catalog/validation.node.test.ts`
- Create: `magazzino-fnb-v1/src/catalog/permissions.ts`
- Create: `magazzino-fnb-v1/src/catalog/permissions.node.test.ts`
- Reference: `magazzino-fnb-v1/src/domain/roles.ts`

**Interfaces:**

```ts
export type BaseUnit = 'CF' | 'PZ' | 'KG' | 'L'

export interface Category { id: string; name: string; active: boolean }

export interface StoreArticleSummary {
  id: string
  articleId: string
  storeId: string
  name: string
  categoryId: string
  categoryName: string
  baseUnit: BaseUnit
  ean: string | null
  packageQuantity: number
  minStock: number
  targetStock: number
  active: boolean
  preferredSupplierName: string | null
  currentPackagePrice: number | null
}

export interface ArticleSupplierSummary {
  id: string
  supplierId: string
  supplierName: string
  supplierArticleCode: string | null
  currentPackagePrice: number
  isPreferred: boolean
  active: boolean
}

export interface ArticleDetail extends StoreArticleSummary {
  suppliers: ArticleSupplierSummary[]
}

export interface PurchasePriceHistoryEntry {
  id: string
  packagePrice: number
  packageQuantitySnapshot: number
  baseUnitSnapshot: BaseUnit
  unitPriceSnapshot: number
  previousPackagePrice: number | null
  absoluteChange: number | null
  percentChange: number | null
  source: 'MANUAL' | 'RECEIPT'
  recordedAt: string
}
```

- [ ] **4.1 — Write pure-function tests first.**

`validation.node.test.ts` must cover:

```ts
assert.equal(normalizeArticleName('  Coca-Cola   33cl '), 'coca cola 33cl')
assert.equal(parseQuantity('0,375'), 0.375)
assert.equal(formatQuantityForDb(0.375), '0.375')
assert.deepEqual(validateThresholds(20, 40), [])
assert.deepEqual(validateThresholds(40, 20), ['L’obiettivo non può essere inferiore al minimo'])
assert.equal(calculateUnitPrice(18.5, 2.5), 7.4)
assert.equal(calculatePriceChangePercent(100, 106), 6)
assert.equal(isSignificantPriceChange(100, 105), false)
assert.equal(isSignificantPriceChange(100, 105.01), true)
assert.equal(calculatePriceChangePercent(0, 10), null)
```

`permissions.node.test.ts` must prove Admin manages catalog while all store roles remain read-only in V1.

Run:

```bash
npm run test:bootstrap -- src/catalog/validation.node.test.ts src/catalog/permissions.node.test.ts
```

Expected: fail because modules/functions do not exist.

- [ ] **4.2 — Implement domain types and exact validation helpers.**

`validation.ts` core:

```ts
export const BASE_UNITS = ['CF', 'PZ', 'KG', 'L'] as const

export function normalizeArticleName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
}

export function parseQuantity(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function formatQuantityForDb(value: number): string {
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

export function validateThresholds(minStock: number, targetStock: number): string[] {
  if (minStock < 0 || targetStock < 0) return ['Le quantità non possono essere negative']
  if (targetStock < minStock) return ['L’obiettivo non può essere inferiore al minimo']
  return []
}

export function calculateUnitPrice(packagePrice: number, packageQuantity: number): number {
  if (packageQuantity <= 0) throw new Error('La quantità per confezione deve essere maggiore di zero')
  return packagePrice / packageQuantity
}

export function calculatePriceChangePercent(previous: number, next: number): number | null {
  if (previous === 0) return null
  return ((next - previous) / previous) * 100
}

export function isSignificantPriceChange(previous: number, next: number): boolean {
  const percent = calculatePriceChangePercent(previous, next)
  return percent !== null && Math.abs(percent) > 5
}
```

Do not use these helpers as the security boundary; PostgreSQL constraints remain authoritative.

- [ ] **4.3 — Implement V1 catalog permissions.**

```ts
import type { ActorAccess } from '../domain/roles'

export function canManageCatalog(actor: ActorAccess): boolean {
  return actor.globalRole === 'ADMIN'
}
```

Keep non-Admin users read-only even if they are RESPONSABILE or VICE; broader operational write permissions belong to later modules.

- [ ] **4.4 — Run focused and full bootstrap tests.**

```bash
npm run test:bootstrap
```

Expected: all existing tests plus new catalog node tests pass.

- [ ] **4.5 — Commit domain layer.**

```bash
git add src/catalog/types.ts src/catalog/validation.ts src/catalog/validation.node.test.ts src/catalog/permissions.ts src/catalog/permissions.node.test.ts
git commit -m "feat: add catalog domain rules"
```

---

## Task 5: Implementare il gateway Supabase del catalogo

**Files:**
- Create: `magazzino-fnb-v1/src/catalog/catalogGateway.ts`
- Create: `magazzino-fnb-v1/src/catalog/supabaseCatalogGateway.ts`
- Create: `magazzino-fnb-v1/src/catalog/supabaseCatalogGateway.node.test.ts`
- Reference: `magazzino-fnb-v1/src/auth/supabaseGateway.ts`
- Reference: `magazzino-fnb-v1/src/lib/supabaseClient.ts`

**Interfaces:**

```ts
export interface CatalogGateway {
  listCategories(): Promise<Category[]>
  createCategory(name: string): Promise<Category>
  listStoreArticles(storeId: string): Promise<StoreArticleSummary[]>
  getStoreArticle(storeArticleId: string): Promise<ArticleDetail | null>
  findDuplicateArticles(input: DuplicateArticleQuery): Promise<ArticleCandidate[]>
  createStoreArticle(input: CreateStoreArticleInput): Promise<string>
  associateArticleToStore(input: AssociateArticleInput): Promise<string>
  updateArticleCore(articleId: string, input: UpdateArticleInput): Promise<void>
  updateStoreArticleConfig(storeArticleId: string, input: StoreArticleConfigInput): Promise<void>
  listSuppliers(): Promise<SupplierSummary[]>
  listStoreSuppliers(storeId: string): Promise<StoreSupplierSummary[]>
  createSupplier(input: CreateSupplierInput): Promise<SupplierSummary>
  associateSupplierToStore(input: AssociateSupplierInput): Promise<string>
  linkArticleSupplier(input: LinkArticleSupplierInput): Promise<string>
  setPreferredSupplier(linkId: string): Promise<void>
  setSupplierPrice(linkId: string, packagePrice: number): Promise<void>
  listPriceHistory(linkId: string): Promise<PurchasePriceHistoryEntry[]>
  listMyNotifications(): Promise<PriceNotification[]>
  markNotificationRead(notificationId: string): Promise<void>
}
```

- [ ] **5.1 — Write adapter mapping tests first.**

`supabaseCatalogGateway.node.test.ts` must verify at least:
- PostgreSQL numeric strings map to JS numbers (`'0.375' -> 0.375`).
- Nested article/category row maps to `StoreArticleSummary` without a `currentStock` field.
- preferred supplier maps to name/current package price when present.
- RPC payload sends decimals as strings produced by `formatQuantityForDb`/price formatter.
- a Postgres `23505` EAN conflict maps to `EAN già associato a un altro articolo.`.
- `23514` threshold constraint maps to the user-facing threshold error.

Run:

```bash
npm run test:bootstrap -- src/catalog/supabaseCatalogGateway.node.test.ts
```

Expected: fail because gateway is not implemented.

- [ ] **5.2 — Implement the gateway interface and row mappers.**

Follow the existing auth adapter pattern: a small `SupabaseLike` interface with `from(table)` and `rpc(name, params)`, pure mapper functions exported for tests, and one `throwIfError`/`mapCatalogError` boundary.

For `listStoreArticles`, request only the selected store and nested read-safe relations. The logical result must contain:
- article identity/name/category/unit/EAN/package quantity;
- min/target;
- active state;
- preferred supplier name/current package price if a preferred link exists;
- no stock field.

For `findDuplicateArticles`, normalize the user name in TypeScript, query EAN exactly when supplied, and query normalized name candidates using the normalized first meaningful token/phrase. De-duplicate candidates by article id in the adapter before returning them.

- [ ] **5.3 — Implement write methods using the reviewed RPC boundaries.**

Example:

```ts
async createStoreArticle(input) {
  const { data, error } = await client.rpc('admin_create_store_article', {
    p_store_id: input.storeId,
    p_name: input.name.trim(),
    p_category_id: input.categoryId,
    p_base_unit: input.baseUnit,
    p_ean: input.ean?.trim() || null,
    p_package_quantity: formatQuantityForDb(input.packageQuantity),
    p_min_stock: formatQuantityForDb(input.minStock),
    p_target_stock: formatQuantityForDb(input.targetStock),
  })
  throwCatalogError(error)
  return data as string
}
```

`setSupplierPrice` calls only `admin_set_supplier_price`; it must not insert history or notifications in JavaScript.

- [ ] **5.4 — Implement direct Admin-safe single-table methods.**

Direct operations are acceptable for single-table writes because RLS is authoritative:
- category insert/update;
- supplier insert/update;
- article core update, including `package_quantity`;
- store article min/target/active update;
- notification `read_at` update for current recipient.

Do not add any DELETE method to `CatalogGateway`.

- [ ] **5.5 — Run tests.**

```bash
npm run test:bootstrap
npm run test:run
```

Expected: gateway node tests and existing Vitest suite green.

- [ ] **5.6 — Commit gateway.**

```bash
git add src/catalog/catalogGateway.ts src/catalog/supabaseCatalogGateway.ts src/catalog/supabaseCatalogGateway.node.test.ts
git commit -m "feat: add Supabase catalog gateway"
```

---

## Task 6: Rifattorizzare shell e navigazione sulla UI approvata

**Files:**
- Modify: `magazzino-fnb-v1/src/app/navigation.ts`
- Modify: `magazzino-fnb-v1/src/app/navigation.test.ts`
- Modify: `magazzino-fnb-v1/src/app/navigation.node.test.ts`
- Modify: `magazzino-fnb-v1/src/app/AppShell.tsx`
- Modify: `magazzino-fnb-v1/src/App.tsx`
- Create: `magazzino-fnb-v1/src/app/MoreScreen.tsx`
- Create: `magazzino-fnb-v1/src/app/AppShell.test.tsx`
- Modify: `magazzino-fnb-v1/src/styles.css`

**Interfaces:**
- Top-level real sections: `home | articles | orders | more`.
- Mobile layout: `Home | Articoli | + | Ordini | Altro`.
- Center `+` opens New Article in the current store for Admin; disabled for non-Admin in this phase.
- `Movimenti` and `Inventari` move under Altro as explicitly unavailable future modules, not active fake screens.

- [ ] **6.1 — Update navigation tests first.**

Change both navigation tests to expect:

```ts
['Home', 'Articoli', 'Ordini', 'Altro']
```

Add AppShell component tests with a fake Admin context that prove:
- store selector remains visible;
- mobile nav shows Home, Articoli, `+`, Ordini, Altro;
- clicking `+` switches into article creation mode;
- no `RATIO` string exists;
- Home does not render fabricated stock/value KPIs.

Run:

```bash
npm run test:run -- src/app/navigation.test.ts src/app/AppShell.test.tsx
npm run test:bootstrap -- src/app/navigation.node.test.ts
```

Expected: fail until implementation changes.

- [ ] **6.2 — Refactor navigation model.**

`navigation.ts` should expose four actual sections and keep center action separate:

```ts
export type NavigationKey = 'home' | 'articles' | 'orders' | 'more'

export const primaryNavigation = [
  { key: 'home', label: 'Home', shortLabel: 'Home' },
  { key: 'articles', label: 'Articoli', shortLabel: 'Articoli' },
  { key: 'orders', label: 'Ordini', shortLabel: 'Ordini' },
  { key: 'more', label: 'Altro', shortLabel: 'Altro' },
] as const
```

Do not model `+` as a route/section.

- [ ] **6.3 — Instantiate the catalog gateway once and inject it into AppShell.**

In `App.tsx`:

```ts
import { createSupabaseCatalogGateway } from './catalog/supabaseCatalogGateway'
import { supabase } from './lib/supabaseClient'

const catalogGateway = createSupabaseCatalogGateway(supabase)
```

Pass it to `AppShell`. This keeps feature components testable with fake gateways and avoids importing the singleton Supabase client throughout the UI.

- [ ] **6.4 — Refactor AppShell content switching without React Router.**

Keep `activeStoreId` at shell level. Introduce a controlled catalog view state such as:

```ts
export type CatalogScreenState =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'detail'; storeArticleId: string }
```

The `+` action sets `activeSection='articles'` and `{ kind: 'create' }` only for Admin. Store changes reset article screen to `{ kind: 'list' }` to prevent viewing a detail from the wrong store.

- [ ] **6.5 — Implement More as a real index, future modules as disabled entries.**

`MoreScreen` active links in this phase:
- Fornitori
- Notifiche

Display future rows such as Ricezioni, Movimenti, Inventari only as `Prossimamente`/disabled. They must not navigate to operational fake screens.

- [ ] **6.6 — Update responsive shell styles.**

Change mobile bottom grid from six equal columns to five slots with a visually distinct center action. Keep the existing neutral charcoal/white look and introduce restrained gold accents. Do not add logos or Ratio branding.

- [ ] **6.7 — Run shell tests and full build.**

```bash
npm run test:bootstrap
npm run test:run
npm run lint
npm run build
```

Expected: all green; Vite PWA build still emits `dist/sw.js` and Worker static assets remain unchanged.

- [ ] **6.8 — Commit shell refactor.**

```bash
git add src/app src/App.tsx src/styles.css
git commit -m "feat: align app shell with store-first navigation"
```

---

## Task 7: Implementare lista, creazione, dettaglio e associazione articoli

**Files:**
- Create: `magazzino-fnb-v1/src/catalog/CatalogWorkspace.tsx`
- Create: `magazzino-fnb-v1/src/catalog/ArticlesScreen.tsx`
- Create: `magazzino-fnb-v1/src/catalog/ArticleForm.tsx`
- Create: `magazzino-fnb-v1/src/catalog/ArticleDetail.tsx`
- Create: `magazzino-fnb-v1/src/catalog/ArticleStoreAssociationForm.tsx`
- Create: `magazzino-fnb-v1/src/catalog/ArticlesScreen.test.tsx`
- Create: `magazzino-fnb-v1/src/catalog/ArticleForm.test.tsx`
- Create: `magazzino-fnb-v1/src/catalog/ArticleDetail.test.tsx`
- Create: `magazzino-fnb-v1/src/catalog/catalog.css`
- Modify: `magazzino-fnb-v1/src/main.tsx`

**Interfaces:**
- List scoped strictly by current `storeId`.
- New Article form: name, category, unit, package quantity, EAN optional, min, target.
- Duplicate preflight must offer reuse/association or explicit “Crea comunque”.
- Detail shows no stock; shows article data, min/target, suppliers, prices/history entry point, store associations.
- Admin structural actions visible; non-Admin read-only.

- [ ] **7.1 — Write UI tests first.**

`ArticlesScreen.test.tsx`:
- fake gateway returns one item;
- renders name, category, `KG`, `Min 20 / Obiettivo 40`;
- does **not** render labels `Giacenza`, `Sotto minimo`, `Valore magazzino`.

`ArticleForm.test.tsx`:
- accepts decimal comma `0,375`;
- rejects target below min before gateway call;
- EAN remains optional;
- duplicate candidate prevents immediate create and renders `Usa esistente` + `Crea comunque`;
- selecting existing candidate calls `associateArticleToStore`, not `createStoreArticle`.

`ArticleDetail.test.tsx`:
- displays package quantity and calculated unit price where a supplier is present;
- Admin sees edit/associate controls;
- non-Admin does not see structural edit controls;
- no stock fields.

Run focused tests and confirm red state.

- [ ] **7.2 — Implement CatalogWorkspace state orchestration.**

Props:

```ts
type CatalogWorkspaceProps = {
  storeId: string
  stores: readonly StoreSummary[]
  actor: ActorAccess
  gateway: CatalogGateway
  screen: CatalogScreenState
  onScreenChange(next: CatalogScreenState): void
}
```

It owns loading/error refresh state but not the active store. It resets stale detail state when `storeId` changes.

- [ ] **7.3 — Implement ArticlesScreen with real store-scoped filters.**

Include:
- text search over article name/EAN/supplier name;
- category filter;
- unit filter (`CF/PZ/KG/L`);
- active/inactive toggle for Admin;
- rows/cards showing min/target and preferred supplier/current price if present.

Do not include “sotto minimo” filter until movement ledger exists.

- [ ] **7.4 — Implement ArticleForm with duplicate preflight.**

Submission sequence:
1. validate required fields and decimals locally;
2. call `findDuplicateArticles`;
3. if candidates exist and user has not explicitly overridden, show candidate panel;
4. `Usa esistente` calls `associateArticleToStore` with the current store/min/target;
5. `Crea comunque` calls `createStoreArticle`;
6. navigate to returned store article detail.

Inline category creation is allowed only to Admin: create category, refresh list, select the newly created category.

- [ ] **7.5 — Implement ArticleDetail and edits.**

Show:
- name/category/unit/EAN;
- package quantity;
- minimum/target for selected store;
- supplier block placeholder component from Task 8 if no supplier yet;
- association status for the other accessible store.

Admin edit operations:
- core article fields/package quantity through `updateArticleCore`;
- min/target/active through `updateStoreArticleConfig`;
- association to the other store through `ArticleStoreAssociationForm`.

Package quantity edit must never rewrite price history; that invariant is database-owned.

- [ ] **7.6 — Add feature styles and import them.**

In `main.tsx` add:

```ts
import './catalog/catalog.css'
```

Use mobile-first cards and compact forms; desktop becomes a two-column detail layout at wider breakpoints. Preserve neutral brand-free design.

- [ ] **7.7 — Run focused + full tests.**

```bash
npm run test:run -- src/catalog/ArticlesScreen.test.tsx src/catalog/ArticleForm.test.tsx src/catalog/ArticleDetail.test.tsx
npm run test:bootstrap
npm run test:run
npm run lint
npm run build
```

Expected: all green, no stock UI.

- [ ] **7.8 — Commit article UX.**

```bash
git add src/catalog src/main.tsx
git commit -m "feat: add store-first article catalog UI"
```

---

## Task 8: Implementare fornitori, prezzi, storico e notifiche

**Files:**
- Create: `magazzino-fnb-v1/src/catalog/SuppliersScreen.tsx`
- Create: `magazzino-fnb-v1/src/catalog/SupplierForm.tsx`
- Create: `magazzino-fnb-v1/src/catalog/ArticleSuppliersPanel.tsx`
- Create: `magazzino-fnb-v1/src/catalog/PriceHistory.tsx`
- Create: `magazzino-fnb-v1/src/catalog/NotificationsPanel.tsx`
- Create: `magazzino-fnb-v1/src/catalog/SuppliersScreen.test.tsx`
- Create: `magazzino-fnb-v1/src/catalog/ArticleSuppliersPanel.test.tsx`
- Create: `magazzino-fnb-v1/src/catalog/PriceHistory.test.tsx`
- Create: `magazzino-fnb-v1/src/catalog/NotificationsPanel.test.tsx`
- Modify: `magazzino-fnb-v1/src/catalog/ArticleDetail.tsx`
- Modify: `magazzino-fnb-v1/src/app/MoreScreen.tsx`

**Interfaces:**
- Central supplier can be linked to one/both stores.
- Article-supplier link stores supplier code, package price, preferred state.
- Price edit invokes one gateway method; database generates history/notification.
- Price history uses saved snapshots, never current package quantity to recompute old unit costs.

- [ ] **8.1 — Write tests first.**

`SuppliersScreen.test.tsx`:
- lists only supplier associations for selected store in main view;
- Admin can add an existing central supplier or create a new one;
- non-Admin sees read-only supplier data.

`ArticleSuppliersPanel.test.tsx`:
- shows current package price and calculated current unit price;
- changing preferred supplier calls `setPreferredSupplier` exactly once;
- changing price calls `setSupplierPrice` and then refreshes data;
- no frontend call exists to append history manually.

`PriceHistory.test.tsx`:
- displays snapshot unit (`€/KG`, `€/PZ`, etc.);
- displays +6% as significant and exactly +5% as normal;
- uses `unitPriceSnapshot` supplied by DB.

`NotificationsPanel.test.tsx`:
- unread price notification rendered;
- significant notification visually marked;
- mark-read calls gateway and removes unread emphasis.

Run focused tests and confirm failure before implementation.

- [ ] **8.2 — Implement supplier management.**

`SuppliersScreen` flow:
- list `store_suppliers` for active store;
- Admin action “Aggiungi fornitore” opens existing central supplier selector + “Nuovo fornitore” form;
- `createSupplier` creates central record;
- `associateSupplierToStore` adds/re-enables store association and optional `customerCode`, `minimumOrderAmount`, `deliveryNotes`.

Supplier creation must not require an article.

- [ ] **8.3 — Implement ArticleSuppliersPanel.**

Admin can:
- choose supplier already associated to store or central supplier;
- link with optional supplier article code;
- enter package price IVA included;
- mark preferred;
- change current package price;
- switch preferred supplier.

The first link price produces initial history in DB but no variation notification. Later price changes produce notifications through the trigger.

- [ ] **8.4 — Implement PriceHistory from immutable snapshots.**

Render columns/cards:
- data;
- prezzo confezione;
- costo per unità snapshot;
- variazione percentuale/assoluta;
- source label (`Manuale`; reserve `Ricezione` for future records).

Never calculate historical unit cost as `current package price / current article package quantity`.

- [ ] **8.5 — Implement NotificationsPanel and wire MoreScreen.**

`MoreScreen` active destinations:
- Fornitori
- Notifiche

Notifications query is user-scoped by RLS. Use `markNotificationRead` to set `read_at`. No Admin selector is needed: each Admin sees their own copy created by DB.

- [ ] **8.6 — Run all tests and build.**

```bash
npm run test:bootstrap
npm run test:run
npm run lint
npm run build
```

Expected: all green.

- [ ] **8.7 — Commit supplier/price UX.**

```bash
git add src/catalog src/app/MoreScreen.tsx
git commit -m "feat: add suppliers price history and notifications"
```

---

## Task 9: Eseguire acceptance, hardening, documentazione e deploy smoke test

**Files:**
- Create: `magazzino-fnb-v1/src/catalog/catalogAcceptance.node.test.ts`
- Modify: `magazzino-fnb-v1/README.md`
- Review: all files added in Tasks 1-8.

**Interfaces:**
- No persistent fake production business data.
- Acceptance DB tests use transaction + rollback.
- Cloudflare target remains Worker Static Assets at `magazzino-fnb-v1.peppesposito88.workers.dev`.

- [ ] **9.1 — Add pure acceptance regression tests before final hardening.**

`catalogAcceptance.node.test.ts` should lock critical non-UI rules that can regress without DB access:
- normalized duplicate names (`Coca-Cola` vs `Coca Cola`);
- 0.375 precision formatting;
- target cannot be below min;
- only allowed units;
- 5% boundary is normal, 5.01% significant;
- zero previous price returns null percent;
- non-Admin cannot manage catalog.

Run:

```bash
npm run test:bootstrap -- src/catalog/catalogAcceptance.node.test.ts
```

Expected: green using domain helpers from Task 4.

- [ ] **9.2 — Execute database acceptance in a transaction and roll back.**

On live Supabase, within one transaction:
1. create a temporary category;
2. create an Eccellenze article through `admin_create_store_article` with package quantity `0.375`;
3. verify exact stored quantity;
4. attempt target < min and confirm constraint/RPC failure in an isolated savepoint;
5. attempt duplicate EAN and confirm unique violation in an isolated savepoint;
6. associate the same central article to Nonna Titti and confirm only one `articles` row exists;
7. create/associate supplier and link price;
8. confirm initial history count 1 and no price-change notification for initial price;
9. change price once; confirm history count 2 and Admin notification created;
10. change price by >5%; confirm notification severity `SIGNIFICANT`;
11. change `articles.package_quantity`; confirm older history snapshot unchanged;
12. run cross-store RLS check as simulated one-store user;
13. rollback the outer transaction.

If a statement must intentionally fail, use savepoints so the outer transaction remains usable.

- [ ] **9.3 — Verify no fake stock language in the built UI.**

Search source:

```bash
rg -n "Giacenza|Sotto minimo|Valore magazzino" src/catalog src/app
```

Expected: no operational stock metric in the catalog module. Text in comments/tests explaining absence is acceptable only when clearly non-UI.

Search forbidden branding:

```bash
rg -ni "ratio" src public index.html
```

Expected: no brand occurrence.

- [ ] **9.4 — Update README to current production architecture and module status.**

Replace stale `Cloudflare Pages Free` with `Cloudflare Workers Free + Static Assets`, add live deployment URL, and update database status to include Catalog + Fornitori once migrations are verified. Keep the zero-cost constraint explicit.

- [ ] **9.5 — Run full local verification from the nested app directory.**

```bash
npm run test:bootstrap
npm run test:run
npm run lint
npm run build
```

Expected:
- all node tests pass;
- all Vitest/Testing Library tests pass;
- lint exits 0;
- TypeScript + Vite production build succeeds;
- PWA output includes service worker assets.

- [ ] **9.6 — Run Supabase advisor one final time.**

Expected: no new security finding. Performance-only findings are acceptable only if reviewed and documented; add missing indexes if a catalog query is obviously uncovered.

- [ ] **9.7 — Commit final hardening/docs.**

```bash
git add src/catalog/catalogAcceptance.node.test.ts README.md
git commit -m "test: finalize catalog suppliers acceptance"
```

- [ ] **9.8 — Verify Cloudflare production deployment.**

Wait for/build the current `main` commit with existing settings:

```text
Root directory: magazzino-fnb-v1
Build command: npm run build
Deploy command: npx wrangler deploy
```

Open:

```text
https://magazzino-fnb-v1.peppesposito88.workers.dev
```

Smoke checks while signed in as Admin:
- switch Eccellenze ↔ Nonna Titti;
- Articoli loads cleanly even when empty;
- `+` opens New Article for active store;
- categories/suppliers screens load;
- no fabricated stock values;
- no Ratio branding;
- logout/login still works.

Do not create permanent dummy products for smoke testing; production CRUD behavior is already covered by transaction-rollback DB acceptance and fake-gateway UI tests.

---

## Completion Definition

The Catalogo + Fornitori phase is complete only when all of the following are simultaneously true:

- Schema, constraints, RLS and grants match the approved spec.
- Admin can create/associate articles and suppliers across both stores without duplicating central entities.
- Non-Admin users cannot cross store boundaries or perform structural catalog writes.
- EAN uniqueness, decimal quantities and min/target constraints are enforced by PostgreSQL.
- Price changes cannot bypass history or notifications because the audit happens in a database trigger.
- Exactly one preferred supplier can exist per article/store.
- Old price history keeps package quantity/unit snapshots after later packaging changes.
- UI is store-first, mobile-first and brand-neutral.
- No current-stock or under-minimum value is fabricated before the movement ledger exists.
- `npm run test:bootstrap`, `npm run test:run`, `npm run lint`, and `npm run build` all pass.
- Supabase security verification passes.
- Cloudflare production app loads the new module at the existing Workers URL.
