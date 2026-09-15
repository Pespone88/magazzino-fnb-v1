# Catalogo + Fornitori Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare il primo modulo operativo reale di Magazzini F&B: catalogo articoli centrale con UX store-first, categorie, fornitori, minimo/obiettivo, prezzi per confezione, storico prezzi automatico, notifiche variazioni prezzo e isolamento RLS tra store.

**Architecture:** Supabase/PostgreSQL resta la fonte autorevole per integrità, autorizzazione e storico. Le entità centrali (`articles`, `categories`, `suppliers`) vengono associate agli store tramite tabelle esplicite. Le scritture strutturali sono Admin-only; le operazioni multi-tabella usano RPC transazionali `SECURITY INVOKER`. Lo storico prezzi e le notifiche sono garantiti da un trigger privato, quindi nessun futuro punto di scrittura può saltare l'audit. Il frontend React resta senza router aggiuntivo: `AppShell` mantiene lo store attivo e monta feature isolate sotto `src/catalog/` tramite un gateway testabile.

**Tech Stack:** React 19.3, TypeScript 6.0, Vite 8.3, Vitest 5, Testing Library, Supabase JS 2.116, PostgreSQL/Supabase RLS, Cloudflare Workers Static Assets.

**Spec:** `docs/superpowers/specs/2026-09-15-catalogo-fornitori-design.md`

## Global Constraints

- Costo infrastrutturale ricorrente target: €0/mese; nessun nuovo servizio runtime a pagamento.
- Nessun brand `RATIO`: l'app resta **Magazzini F&B**.
- UX store-first: l'utente lavora sempre dentro Eccellenze della Costiera o Nonna Titti; il catalogo centrale non è una schermata operativa quotidiana.
- Unità ammesse esattamente: `CF`, `PZ`, `KG`, `L`.
- Quantità business con massimo 3 decimali; prezzi confezione IVA inclusa con `numeric` PostgreSQL.
- Non mostrare/calcolare giacenza, sotto-minimo o valore magazzino in questa fase: il ledger movimenti non esiste ancora.
- Nessuna cancellazione fisica di record business; nessun grant `DELETE` ai client.
- EAN opzionale ma globalmente unico quando valorizzato, anche se l'articolo viene disattivato.
- Duplicati per nome: avviso assistito, mai merge automatico.
- `target_stock >= min_stock`, entrambi non negativi.
- Un solo fornitore preferito per articolo/store.
- Ogni modifica reale del prezzo corrente produce storico automatico e notifica a tutti gli Admin attivi; oltre ±5% la notifica è `SIGNIFICANT`.
- Se il prezzo precedente è 0, `percent_change` è `NULL` e la notifica resta `NORMAL`: non inventare una percentuale infinita.
- Nessuna autorizzazione basata su `user_metadata`; usare profili/membership database e helper privati esistenti.
- Nessuna service-role/secret key nel browser.
- Tabelle Data API: RLS sempre attiva e grant minimi espliciti.
- RPC pubbliche: `SECURITY INVOKER`, `EXECUTE` revocato a `PUBLIC` e `anon`, con grant a `authenticated` soltanto.
- Trigger privilegiati: funzione in `private`, `SECURITY DEFINER`, `search_path=''`, senza `EXECUTE` client.
- Implementazione TDD: test rosso → codice minimo → test verde → commit.
- Nessuna nuova dipendenza npm richiesta.

---

## Task 1: Creare lo schema catalogo in stato locked-down

**Files:**
- Create via Supabase CLI: `magazzino-fnb-v1/supabase/migrations/*_catalog_suppliers_schema.sql`
- Create: `magazzino-fnb-v1/supabase/tests/catalog_suppliers_contract.sql`
- Reference: `magazzino-fnb-v1/supabase/migrations/20260913_1733_foundation_access_model.sql`

**Interfaces:**
- Enum `public.catalog_base_unit`: `CF | PZ | KG | L`.
- Enum `public.purchase_price_source`: `MANUAL | RECEIPT`.
- Enum `public.notification_type`: `PRICE_CHANGE`.
- Enum `public.notification_severity`: `NORMAL | SIGNIFICANT`.
- Tabelle: `categories`, `articles`, `store_articles`, `suppliers`, `store_suppliers`, `store_article_suppliers`, `purchase_price_history`, `notifications`.
- Helper `private.normalize_catalog_name(text)`.

- [ ] **1.1 — Scrivere prima il contract SQL, eseguibile anche prima della migration.**

Creare `supabase/tests/catalog_suppliers_contract.sql` senza cast a regclass/regtype inesistenti:

```sql
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
```

Expected before migration: eight `exists=false`, zero RLS rows and zero enum rows. Il contract non deve fallire solo perché gli oggetti non esistono ancora.

- [ ] **1.2 — Generare la migration tramite CLI, senza inventare timestamp.**

Da `magazzino-fnb-v1/`:

```bash
supabase --help
supabase migration new --help
supabase migration new catalog_suppliers_schema
MIGRATION=$(ls -1t supabase/migrations/*_catalog_suppliers_schema.sql | head -1)
printf '%s\n' "$MIGRATION"
```

Expected: un solo nuovo file `_catalog_suppliers_schema.sql`.

- [ ] **1.3 — Aggiungere enum e normalizzazione autorevole del nome.**

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
    '\s+', ' ', 'g'
  );
$$;

revoke all on function private.normalize_catalog_name(text) from public, anon;
grant execute on function private.normalize_catalog_name(text) to authenticated;
```

La stessa normalizzazione sarà replicata in TypeScript solo per UX; PostgreSQL resta la fonte autorevole.

- [ ] **1.4 — Creare categorie, articoli e associazioni store.**

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
```

- [ ] **1.5 — Creare fornitori e relazione articolo-fornitore con integrità cross-store.**

```sql
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
```

Il `store_id` ridondante è intenzionale: le FK composite impediscono di collegare un articolo Eccellenze a una relazione fornitore Nonna Titti.

- [ ] **1.6 — Creare storico prezzi e notifiche.**

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

- [ ] **1.7 — Abilitare RLS e revocare accesso prima di qualsiasi grant.**

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

- [ ] **1.8 — Dry-run transazionale e commit.**

Eseguire il body esatto con Supabase SQL come `BEGIN; ... ROLLBACK;`. Expected: nessun errore e nessun oggetto persistente dopo rollback.

Poi:

```bash
npm run test:bootstrap
git add supabase/migrations/*_catalog_suppliers_schema.sql supabase/tests/catalog_suppliers_contract.sql
git commit -m "feat: add catalog suppliers database schema"
```

---

## Task 2: Aggiungere RLS, RPC atomiche e storico prezzo garantito dal database

**Files:**
- Create via Supabase CLI: `magazzino-fnb-v1/supabase/migrations/*_catalog_suppliers_operations.sql`
- Modify: `magazzino-fnb-v1/supabase/tests/catalog_suppliers_contract.sql`

**Interfaces:**
- Private read helpers: `private.current_user_can_read_article(uuid)`, `private.current_user_can_read_supplier(uuid)`.
- Public RPC: `admin_create_store_article`, `admin_associate_article_to_store`, `admin_associate_supplier_to_store`, `admin_link_article_supplier`, `admin_set_preferred_supplier`, `admin_set_supplier_price`.
- Private trigger: `private.record_store_article_supplier_price()`.

- [ ] **2.1 — Estendere prima il contract SQL.**

Aggiungere:

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

select
  has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE') as can_mark_read,
  has_column_privilege('authenticated', 'public.notifications', 'severity', 'UPDATE') as can_change_severity,
  has_column_privilege('authenticated', 'public.notifications', 'body', 'UPDATE') as can_change_body;
```

Expected finale: nessun DELETE; `can_mark_read=true`; `can_change_severity=false`; `can_change_body=false`.

- [ ] **2.2 — Generare migration operations.**

```bash
supabase migration new catalog_suppliers_operations
MIGRATION=$(ls -1t supabase/migrations/*_catalog_suppliers_operations.sql | head -1)
printf '%s\n' "$MIGRATION"
```

- [ ] **2.3 — Aggiungere helper privati di lettura.**

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

- [ ] **2.4 — Aggiungere grant minimi e RLS.**

```sql
grant select, insert, update on table public.categories to authenticated;
grant select, insert, update on table public.articles to authenticated;
grant select, insert, update on table public.store_articles to authenticated;
grant select, insert, update on table public.suppliers to authenticated;
grant select, insert, update on table public.store_suppliers to authenticated;
grant select, insert, update on table public.store_article_suppliers to authenticated;
grant select on table public.purchase_price_history to authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;
```

Policy requirements:

```sql
create policy categories_select_authenticated
on public.categories for select to authenticated using (true);
create policy categories_insert_admin
on public.categories for insert to authenticated
with check (private.current_user_is_admin());
create policy categories_update_admin
on public.categories for update to authenticated
using (private.current_user_is_admin()) with check (private.current_user_is_admin());

create policy articles_select_accessible
on public.articles for select to authenticated
using (private.current_user_can_read_article(id));
create policy articles_insert_admin
on public.articles for insert to authenticated
with check (private.current_user_is_admin());
create policy articles_update_admin
on public.articles for update to authenticated
using (private.current_user_is_admin()) with check (private.current_user_is_admin());

create policy store_articles_select_accessible
on public.store_articles for select to authenticated
using (private.current_user_has_store_access(store_id));
create policy store_articles_insert_admin
on public.store_articles for insert to authenticated
with check (private.current_user_is_admin());
create policy store_articles_update_admin
on public.store_articles for update to authenticated
using (private.current_user_is_admin()) with check (private.current_user_is_admin());

create policy suppliers_select_accessible
on public.suppliers for select to authenticated
using (private.current_user_can_read_supplier(id));
create policy suppliers_insert_admin
on public.suppliers for insert to authenticated
with check (private.current_user_is_admin());
create policy suppliers_update_admin
on public.suppliers for update to authenticated
using (private.current_user_is_admin()) with check (private.current_user_is_admin());

create policy store_suppliers_select_accessible
on public.store_suppliers for select to authenticated
using (private.current_user_has_store_access(store_id));
create policy store_suppliers_insert_admin
on public.store_suppliers for insert to authenticated
with check (private.current_user_is_admin());
create policy store_suppliers_update_admin
on public.store_suppliers for update to authenticated
using (private.current_user_is_admin()) with check (private.current_user_is_admin());

create policy store_article_suppliers_select_accessible
on public.store_article_suppliers for select to authenticated
using (private.current_user_has_store_access(store_id));
create policy store_article_suppliers_insert_admin
on public.store_article_suppliers for insert to authenticated
with check (private.current_user_is_admin());
create policy store_article_suppliers_update_admin
on public.store_article_suppliers for update to authenticated
using (private.current_user_is_admin()) with check (private.current_user_is_admin());

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

Non creare policy client INSERT/UPDATE su `purchase_price_history`, né client INSERT su `notifications`.

- [ ] **2.5 — Aggiungere trigger privato per snapshot prezzo + notifiche.**

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
  join public.store_suppliers ss on ss.id = new.store_supplier_id
  join public.suppliers s on s.id = ss.supplier_id
  where sa.id = new.store_article_id
    and sa.store_id = new.store_id
    and ss.store_id = new.store_id;

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

Invarianti: primo prezzo → una history row, zero notifiche variazione; update prezzo → nuova history row + una notifica per ogni Admin attivo. Un update che non cambia il prezzo non produce nulla.

- [ ] **2.6 — Implementare le RPC Admin `SECURITY INVOKER`.**

Signatures:

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

public.admin_set_preferred_supplier(p_store_article_supplier_id uuid) returns void
public.admin_set_supplier_price(p_store_article_supplier_id uuid, p_new_package_price numeric) returns void
```

Ogni funzione:

```sql
language plpgsql
security invoker
set search_path = ''
```

ed esegue all'inizio:

```sql
if not private.current_user_is_admin() then
  raise exception 'Catalog administration requires ADMIN';
end if;
```

Regole atomiche:
- `admin_create_store_article`: insert `articles` + `store_articles` nella stessa transazione implicita; `ean = nullif(btrim(p_ean), '')`.
- `admin_associate_article_to_store`: crea/riattiva una sola `store_articles` e aggiorna min/target.
- `admin_associate_supplier_to_store`: crea/riattiva una sola `store_suppliers` e aggiorna le condizioni store-specifiche.
- `admin_link_article_supplier`: garantisce/riattiva `store_suppliers`; se `p_is_preferred=true`, disattiva il flag sugli altri link prima dell'insert; il trigger crea la prima history row.
- `admin_set_preferred_supplier`: unset vecchio preferred + set nuovo nella stessa chiamata.
- `admin_set_supplier_price`: aggiorna solo `current_package_price`; trigger gestisce history/notifiche.

Dopo la creazione, revocare `EXECUTE` a `PUBLIC` e `anon` per ciascuna signature e concederlo a `authenticated`. Il contract deve mostrare `security_type = INVOKER` per tutte le RPC pubbliche.

- [ ] **2.7 — Dry-run trigger/RPC e commit.**

In una transazione rollback, creare categoria/articolo/store supplier/link, aggiornare una volta il prezzo e verificare:
- history count = 2;
- initial row con `previous_package_price is null`;
- update row con previous/absolute/percent corretti;
- almeno una notifica Admin;
- `abs(percent_change) > 5` produce `SIGNIFICANT`;
- precedente prezzo 0 produce `percent_change is null` e `NORMAL`.

Poi:

```bash
git add supabase/migrations/*_catalog_suppliers_operations.sql supabase/tests/catalog_suppliers_contract.sql
git commit -m "feat: secure catalog operations and price history"
```

---

## Task 3: Applicare e verificare il database live senza dati fake permanenti

**Files:**
- Create: `magazzino-fnb-v1/supabase/tests/catalog_suppliers_rls_checks.sql`
- Reference: migrations Tasks 1-2.

- [ ] **3.1 — Scrivere lo script RLS transaction-only.**

Lo script deve:
1. individuare un Admin attivo e salvarne l'id in una temp table;
2. creare dentro la transazione due articoli di test, uno per store;
3. cambiare temporaneamente quel profilo a `USER` nella stessa transazione non committata;
4. assegnargli membership solo Eccellenze;
5. impostare JWT locale e `SET LOCAL ROLE authenticated`;
6. verificare che `store_articles` mostri solo Eccellenze;
7. verificare che l'articolo solo Nonna Titti non sia leggibile dalla tabella centrale;
8. `RESET ROLE; ROLLBACK;`.

Identity switch:

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

Le query finali devono restituire booleani espliciti (`sees_only_assigned_store=true`, `cannot_see_other_article=true`).

- [ ] **3.2 — Applicare le due migration al progetto `tfeuxskvrjnltfgzzxar`.**

Applicare l'SQL esatto già dry-runnato, in ordine. Non fare correzioni manuali post-hoc nel database: ogni correzione successiva deve avere una nuova migration.

- [ ] **3.3 — Eseguire contract + RLS checks sul live DB.**

Expected:
- 8 tabelle presenti;
- RLS true su tutte;
- enum corretti;
- nessun DELETE client;
- notifications: update consentito solo su `read_at`;
- RPC pubbliche `SECURITY INVOKER`;
- utente simulato vede un solo store;
- rollback lascia Admin e dati reali invariati.

- [ ] **3.4 — Eseguire Supabase Security Advisor.**

Zero nuovi finding di sicurezza. Se una nuova funzione `SECURITY DEFINER` è esposta in `public` con EXECUTE client, bloccare il task e correggere prima del frontend.

- [ ] **3.5 — Commit RLS test.**

```bash
git add supabase/tests/catalog_suppliers_rls_checks.sql
git commit -m "test: verify catalog cross-store isolation"
```

---

## Task 4: Implementare dominio, decimali e permessi UI

**Files:**
- Create: `magazzino-fnb-v1/src/catalog/types.ts`
- Create: `magazzino-fnb-v1/src/catalog/validation.ts`
- Create: `magazzino-fnb-v1/src/catalog/validation.node.test.ts`
- Create: `magazzino-fnb-v1/src/catalog/permissions.ts`
- Create: `magazzino-fnb-v1/src/catalog/permissions.node.test.ts`
- Reference: `magazzino-fnb-v1/src/domain/roles.ts`

**Core types:**

```ts
export type BaseUnit = 'CF' | 'PZ' | 'KG' | 'L'

export interface Category {
  id: string
  name: string
  active: boolean
}

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

Non aggiungere `currentStock` o campi equivalenti.

- [ ] **4.1 — Test puri prima del codice.**

`validation.node.test.ts` deve includere:

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

`permissions.node.test.ts`: Admin può gestire; RESPONSABILE/VICE/MAGAZZINIERE restano read-only sul catalogo strutturale V1.

Run red:

```bash
node --experimental-strip-types --test src/catalog/validation.node.test.ts src/catalog/permissions.node.test.ts
```

- [ ] **4.2 — Implementare helpers minimi.**

```ts
export const BASE_UNITS = ['CF', 'PZ', 'KG', 'L'] as const

export function normalizeArticleName(value: string): string {
  return value.trim().toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ')
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
  return previous === 0 ? null : ((next - previous) / previous) * 100
}

export function isSignificantPriceChange(previous: number, next: number): boolean {
  const percent = calculatePriceChangePercent(previous, next)
  return percent !== null && Math.abs(percent) > 5
}
```

`permissions.ts`:

```ts
export function canManageCatalog(actor: ActorAccess): boolean {
  return actor.globalRole === 'ADMIN'
}
```

- [ ] **4.3 — Run green + full bootstrap and commit.**

```bash
npm run test:bootstrap
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

**Gateway contract:**

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

- [ ] **5.1 — Scrivere mapper/adapter tests prima.**

Testare:
- `'0.375' -> 0.375`;
- nested article/category -> `StoreArticleSummary` senza stock;
- preferred supplier mapping;
- RPC payload decimali come stringhe normalizzate;
- Postgres `23505` EAN -> `EAN già associato a un altro articolo.`;
- threshold constraint -> messaggio target/min.

Run red:

```bash
node --experimental-strip-types --test src/catalog/supabaseCatalogGateway.node.test.ts
```

- [ ] **5.2 — Implementare adapter seguendo il pattern auth esistente.**

Usare una piccola interfaccia `SupabaseLike` con `from()` e `rpc()`, mapper puri esportati e un unico `throwCatalogError`.

`listStoreArticles(storeId)` deve filtrare sempre per `store_id` e restituire:
- articolo/categoria/unità/EAN/package quantity;
- min/target;
- active;
- preferred supplier e prezzo se presenti;
- nessun campo stock.

`findDuplicateArticles`:
- normalizza nome client-side;
- EAN query esatta se presente;
- query nome normalizzato per candidati;
- deduplica per `articleId`;
- nessun blocco lato client salvo EAN/constraint DB.

- [ ] **5.3 — Implementare write path tramite RPC.**

Esempio:

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

`setSupplierPrice` chiama solo `admin_set_supplier_price`: JavaScript non inserisce history/notifiche.

- [ ] **5.4 — Implementare single-table Admin writes e notification read.**

Direct writes consentiti perché protetti da RLS:
- category insert/update;
- supplier insert/update;
- article core update, inclusa `package_quantity`;
- store article min/target/active update;
- notifications: update esclusivamente `read_at`.

Non aggiungere alcun metodo DELETE.

- [ ] **5.5 — Run + commit.**

```bash
npm run test:bootstrap
npm run test:run
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
- Real top-level sections: `home | articles | orders | more`.
- Mobile: `Home | Articoli | + | Ordini | Altro`.
- `+`: apre Nuovo articolo nello store attivo solo per Admin; disabled per non-Admin in questa fase.
- Movimenti/Inventari: sotto Altro come moduli non ancora disponibili, non fake screens.

- [ ] **6.1 — Modificare test navigation/AppShell prima del codice.**

Navigation expected:

```ts
['Home', 'Articoli', 'Ordini', 'Altro']
```

AppShell tests:
- store selector Admin presente;
- mobile nav con Home, Articoli, `+`, Ordini, Altro;
- `+` entra in create article;
- nessuna stringa `RATIO`;
- Home non presenta stock/value KPIs inventati.

Run red:

```bash
npx vitest run src/app/navigation.test.ts src/app/AppShell.test.tsx
node --experimental-strip-types --test src/app/navigation.node.test.ts
```

- [ ] **6.2 — Rifattorizzare navigation model.**

```ts
export type NavigationKey = 'home' | 'articles' | 'orders' | 'more'

export const primaryNavigation = [
  { key: 'home', label: 'Home', shortLabel: 'Home' },
  { key: 'articles', label: 'Articoli', shortLabel: 'Articoli' },
  { key: 'orders', label: 'Ordini', shortLabel: 'Ordini' },
  { key: 'more', label: 'Altro', shortLabel: 'Altro' },
] as const
```

`+` non è una route.

- [ ] **6.3 — Creare gateway una volta e iniettarlo in AppShell.**

In `App.tsx`:

```ts
import { createSupabaseCatalogGateway } from './catalog/supabaseCatalogGateway'
import { supabase } from './lib/supabaseClient'

const catalogGateway = createSupabaseCatalogGateway(supabase)
```

Passarlo a `AppShell` per consentire fake gateway nei test.

- [ ] **6.4 — AppShell mantiene store e catalog screen state.**

```ts
export type CatalogScreenState =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'detail'; storeArticleId: string }
```

Cambio store resetta a `{ kind:'list' }`. `+` Admin imposta section `articles` + screen `create`.

- [ ] **6.5 — Implementare MoreScreen reale.**

Attivi ora:
- Fornitori
- Notifiche

Ricezioni/Movimenti/Inventari, se mostrati, hanno stato `Prossimamente` e nessuna azione operativa.

- [ ] **6.6 — Aggiornare CSS mobile/desktop e verificare.**

Mobile bottom nav a cinque slot con centro `+`; palette neutra charcoal/white con accento gold sobrio. Nessun logo Ratio.

```bash
npm run test:bootstrap
npm run test:run
npm run lint
npm run build
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

- [ ] **7.1 — UI tests prima.**

`ArticlesScreen`:
- mostra nome/categoria/unità e `Min 20 / Obiettivo 40`;
- non mostra `Giacenza`, `Sotto minimo`, `Valore magazzino`.

`ArticleForm`:
- accetta `0,375`;
- blocca target < min prima della call;
- EAN opzionale;
- candidato duplicato mostra `Usa esistente` e `Crea comunque`;
- `Usa esistente` chiama `associateArticleToStore`, non `createStoreArticle`.

`ArticleDetail`:
- mostra package quantity;
- Admin vede edit/associate;
- non-Admin read-only;
- nessun dato stock.

Run red:

```bash
npx vitest run src/catalog/ArticlesScreen.test.tsx src/catalog/ArticleForm.test.tsx src/catalog/ArticleDetail.test.tsx
```

- [ ] **7.2 — Implementare CatalogWorkspace controlled.**

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

Gestisce loading/error/refresh, non lo store attivo.

- [ ] **7.3 — Implementare ArticlesScreen store-scoped.**

Filtri reali:
- testo nome/EAN/fornitore;
- categoria;
- unità;
- active/inactive Admin.

Card/row:
- min/target;
- preferred supplier/current package price se presenti.

Nessun filtro sotto-minimo.

- [ ] **7.4 — Implementare ArticleForm con duplicate preflight.**

Sequenza:
1. valida campi/decimali;
2. `findDuplicateArticles`;
3. se candidati, mostra scelta;
4. `Usa esistente` → `associateArticleToStore` con store/min/target;
5. `Crea comunque` → `createStoreArticle`;
6. naviga al detail restituito.

Admin può creare categoria inline e selezionarla subito.

- [ ] **7.5 — Implementare ArticleDetail e association altro store.**

Mostrare:
- name/category/unit/EAN/package qty;
- min/target;
- supplier section entry;
- stato associazione altro store.

Admin può:
- edit core article/package qty;
- edit min/target/active;
- associare articolo all'altro store con min/target propri.

L'edit package quantity non tocca history.

- [ ] **7.6 — Styles, import e verifica.**

In `main.tsx`:

```ts
import './catalog/catalog.css'
```

Poi:

```bash
npm run test:bootstrap
npm run test:run
npm run lint
npm run build
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

- [ ] **8.1 — Tests prima.**

`SuppliersScreen`:
- main list solo store selezionato;
- Admin può associare central supplier o crearne uno;
- non-Admin read-only.

`ArticleSuppliersPanel`:
- prezzo confezione + costo unitario corrente;
- preferred change chiama `setPreferredSupplier` una volta;
- price change chiama solo `setSupplierPrice`, poi refresh;
- nessuna insert history client-side.

`PriceHistory`:
- usa `unitPriceSnapshot` DB;
- +6% evidenziato, +5% normale;
- unità snapshot corretta.

`NotificationsPanel`:
- unread;
- significant emphasis;
- mark-read chiama gateway e aggiorna stato.

- [ ] **8.2 — Implementare supplier management.**

Fornitori nello store:
- lista `store_suppliers`;
- “Aggiungi fornitore” permette central existing o nuovo;
- nuovo central via `createSupplier`;
- associazione via `associateSupplierToStore` con customer code/min order/delivery notes.

Un supplier può esistere senza essere ancora legato a un articolo.

- [ ] **8.3 — Implementare ArticleSuppliersPanel.**

Admin:
- seleziona supplier;
- optional supplier article code;
- package price IVA inclusa;
- preferred flag;
- cambia prezzo;
- cambia preferred.

Primo link → initial history senza variation notification. Update prezzo → trigger DB history + notification.

- [ ] **8.4 — Implementare PriceHistory usando snapshot immutabili.**

Mostrare data, package price, snapshot unit cost, absolute/percent change, source. Non ricalcolare vecchi costi usando package quantity corrente.

- [ ] **8.5 — Implementare NotificationsPanel e MoreScreen.**

Ogni Admin legge solo le proprie notification rows tramite RLS. `markNotificationRead` aggiorna soltanto `read_at`; il client non può modificare severity/body/title.

- [ ] **8.6 — Run + commit.**

```bash
npm run test:bootstrap
npm run test:run
npm run lint
npm run build
git add src/catalog src/app/MoreScreen.tsx
git commit -m "feat: add suppliers price history and notifications"
```

---

## Task 9: Acceptance, hardening, documentazione e deploy smoke

**Files:**
- Create: `magazzino-fnb-v1/src/catalog/catalogAcceptance.node.test.ts`
- Modify: `magazzino-fnb-v1/README.md`
- Review: tutti i file Tasks 1-8.

- [ ] **9.1 — Aggiungere acceptance regression tests puri.**

Bloccare:
- `Coca-Cola` vs `Coca Cola` normalization;
- 0.375 precision;
- target >= min;
- solo CF/PZ/KG/L;
- 5% normale, 5.01% significativa;
- previous price 0 → percent null;
- non-Admin cannot manage catalog.

```bash
node --experimental-strip-types --test src/catalog/catalogAcceptance.node.test.ts
```

- [ ] **9.2 — Acceptance DB live dentro una sola transazione + rollback.**

Senza dati fake persistenti:
1. categoria test;
2. Eccellenze article via RPC con package qty `0.375`;
3. verifica exact value;
4. target<min fallisce dentro savepoint;
5. duplicate EAN fallisce dentro savepoint;
6. stesso central article associato a Nonna Titti e una sola `articles` row;
7. supplier/store/link prezzo;
8. initial history count 1, zero variation notification;
9. price change → history count 2 + notification;
10. variazione >5% → `SIGNIFICANT`;
11. package quantity edit → old history snapshot invariato;
12. cross-store RLS check;
13. rollback outer transaction.

- [ ] **9.3 — Source scans anti-fake/anti-brand.**

```bash
rg -n "Giacenza|Sotto minimo|Valore magazzino" src/catalog src/app
rg -ni "ratio" src public index.html
```

Expected: nessuna metrica stock operativa e nessun brand Ratio. Eventuali test che verificano l'assenza possono contenere quelle parole solo come assertion negative.

- [ ] **9.4 — Aggiornare README.**

Correggere stack da `Cloudflare Pages` a `Cloudflare Workers + Static Assets`, aggiungere URL live `https://magazzino-fnb-v1.peppesposito88.workers.dev`, e aggiornare stato DB/module dopo verifica migrations.

- [ ] **9.5 — Full local verification.**

```bash
npm run test:bootstrap
npm run test:run
npm run lint
npm run build
```

Expected: tutto green; build PWA genera service worker.

- [ ] **9.6 — Supabase advisor finale.**

Zero nuovi finding security. Performance findings solo se compresi; aggiungere index se una query del catalogo è chiaramente scoperta.

- [ ] **9.7 — Commit hardening/docs.**

```bash
git add src/catalog/catalogAcceptance.node.test.ts README.md
git commit -m "test: finalize catalog suppliers acceptance"
```

- [ ] **9.8 — Verificare deploy Cloudflare production.**

Configurazione invariata:

```text
Root directory: magazzino-fnb-v1
Build command: npm run build
Deploy command: npx wrangler deploy
```

Aprire `https://magazzino-fnb-v1.peppesposito88.workers.dev` e verificare:
- login Admin ancora funzionante;
- switch Eccellenze/Nonna Titti;
- Articoli carica anche vuoto;
- `+` apre New Article per store attivo;
- Fornitori/Notifiche caricano;
- nessun valore stock inventato;
- nessun Ratio branding;
- logout/login invariato.

Non creare dummy products persistenti: CRUD è già coperto da DB acceptance con rollback e UI test con fake gateway.

---

## Completion Definition

La fase Catalogo + Fornitori è completa solo quando:

- schema, constraints, RLS e grants corrispondono alla spec;
- Admin crea/associa articoli e fornitori sui due store senza duplicare entità centrali;
- non-Admin non oltrepassa store boundaries e non effettua structural writes;
- EAN, decimali e min/target sono garantiti da PostgreSQL;
- price update non può saltare history/notifications perché l'audit è DB-triggered;
- un solo preferred supplier per article/store;
- vecchia price history conserva package/unit snapshots dopo cambi packaging;
- notification client update è limitato alla sola colonna `read_at`;
- UI store-first, mobile-first e brand-neutral;
- nessun current-stock/under-min fake prima del movement ledger;
- `npm run test:bootstrap`, `npm run test:run`, `npm run lint`, `npm run build` passano;
- Supabase security verification passa;
- Cloudflare production carica il modulo sul Workers URL esistente.
