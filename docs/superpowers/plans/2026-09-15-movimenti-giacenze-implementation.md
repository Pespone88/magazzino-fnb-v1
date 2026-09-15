# Movimenti + Giacenze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare il ledger stock definitivo di Magazzini F&B con saldo corrente materializzato, riserve auditabili, rettifica/storno Admin, RLS store-scoped e integrazione reale delle giacenze nella UI Articoli e Movimenti.

**Architecture:** `stock_movements` è il ledger fisico append-only; `stock_reservations` traccia gli impegni; `stock_balances` è una proiezione materializzata aggiornata nella stessa transazione PostgreSQL delle primitive stock. Il browser legge tramite RLS e usa soltanto RPC di business ristrette: le primitive generiche vivono nello schema `private` e saranno riutilizzate dai moduli Ricezioni, Rifornimenti, Inventari e Prestiti.

**Tech Stack:** PostgreSQL/Supabase Free + RLS, React 19.3, TypeScript 6.0, Vite 8.3, Supabase JS 2.116, Vitest 5, Node test runner, Cloudflare Workers + Static Assets.

**Spec:** `docs/superpowers/specs/2026-09-15-movimenti-giacenze-design.md`

## Global Constraints

- Zero costo infrastrutturale ricorrente target.
- Eccellenze della Costiera e Nonna Titti restano store operativamente isolati.
- Eccellenze usa un solo magazzino logico anche se fisicamente ha due depositi.
- Il punto vendita non possiede una giacenza contabile nell'app.
- Quantità stock con massimo 3 decimali.
- Nessuna giacenza negativa; `reserved <= on_hand`; `available = on_hand - reserved`.
- Nessuna modifica manuale diretta della giacenza.
- `stock_movements` è immutabile; errori già registrati si correggono con un nuovo `REVERSAL`.
- Reversal V1: completo, una sola volta, non reversibile.
- Costi storici congelati; costo non noto = `NULL`, mai `0` inventato.
- Saldo assente = zero in lettura.
- Nessun endpoint browser generico può scegliere liberamente `movement_type`.
- RLS e permessi DB sono autoritativi; la UI non è un confine di sicurezza.
- Nessun `DELETE` client sulle tabelle stock.
- Nessuna UI deve mostrare stock hardcoded o fittizio.
- I moduli successivi devono usare le primitive private stock, senza introdurre un secondo ledger.
- Una migration applicata non viene mai riscritta: schema, core operations, reservations e security sono migration separate.
- Se Supabase restituisce un prefisso versione canonico diverso da quello pianificato, il file repository viene rinominato a quel prefisso prima del commit e non si conserva una copia duplicata.

---

## File map

Nuovi file:

- `magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql`
- `magazzino-fnb-v1/supabase/tests/stock_ledger_acceptance.sql`
- `magazzino-fnb-v1/supabase/migrations/20260915134500_stock_ledger_schema.sql`
- `magazzino-fnb-v1/supabase/migrations/20260915135500_stock_ledger_core_operations.sql`
- `magazzino-fnb-v1/supabase/migrations/20260915140500_stock_reservations.sql`
- `magazzino-fnb-v1/supabase/migrations/20260915141500_stock_security.sql`
- `magazzino-fnb-v1/src/stock/types.ts`
- `magazzino-fnb-v1/src/stock/validation.ts`
- `magazzino-fnb-v1/src/stock/validation.node.test.ts`
- `magazzino-fnb-v1/src/stock/stockGateway.ts`
- `magazzino-fnb-v1/src/stock/supabaseStockGateway.ts`
- `magazzino-fnb-v1/src/stock/supabaseStockGateway.node.test.ts`
- `magazzino-fnb-v1/src/stock/StockSummary.tsx`
- `magazzino-fnb-v1/src/stock/StockSummary.test.tsx`
- `magazzino-fnb-v1/src/stock/StockMovementsScreen.tsx`
- `magazzino-fnb-v1/src/stock/StockMovementsScreen.test.tsx`
- `magazzino-fnb-v1/src/stock/stockAcceptance.node.test.ts`
- `magazzino-fnb-v1/src/stock/stock.css`

File modificati:

- `magazzino-fnb-v1/src/App.tsx`
- `magazzino-fnb-v1/src/app/AppShell.tsx`
- `magazzino-fnb-v1/src/app/MoreScreen.tsx`
- `magazzino-fnb-v1/src/app/AppShell.test.tsx`
- `magazzino-fnb-v1/src/catalog/CatalogWorkspace.tsx`
- `magazzino-fnb-v1/src/catalog/ArticlesScreen.tsx`
- `magazzino-fnb-v1/src/catalog/ArticlesScreen.test.tsx`
- `magazzino-fnb-v1/src/catalog/ArticleDetail.tsx`
- `magazzino-fnb-v1/src/catalog/ArticleDetail.test.tsx`
- `magazzino-fnb-v1/src/main.tsx`
- `magazzino-fnb-v1/README.md`

---

### Task 1: Schema ledger, saldo e riserve

**Files:**
- Create: `magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql`
- Create: `magazzino-fnb-v1/supabase/migrations/20260915134500_stock_ledger_schema.sql`

**Interfaces:**
- Consumes: `public.store_articles(id, store_id)`, `public.stores`, `public.profiles`.
- Produces: enum `stock_movement_type`, `stock_source_type`, `stock_reservation_type`, `stock_reservation_status`; tabelle `stock_movements`, `stock_balances`, `stock_reservations`.

- [ ] **Step 1: Scrivere il contract SQL RED**

```sql
select to_regclass('public.stock_movements') is not null as has_movements;
select to_regclass('public.stock_balances') is not null as has_balances;
select to_regclass('public.stock_reservations') is not null as has_reservations;

select relname, relrowsecurity
from pg_class
where oid in (
  'public.stock_movements'::regclass,
  'public.stock_balances'::regclass,
  'public.stock_reservations'::regclass
);

select has_table_privilege('authenticated', 'public.stock_movements', 'UPDATE') as movement_update;
select has_table_privilege('authenticated', 'public.stock_movements', 'DELETE') as movement_delete;
select has_table_privilege('authenticated', 'public.stock_balances', 'INSERT,UPDATE,DELETE') as balance_write;
select has_table_privilege('authenticated', 'public.stock_reservations', 'INSERT,UPDATE,DELETE') as reservation_write;
```

- [ ] **Step 2: Eseguire contract e confermare RED**

Expected: oggetti stock assenti.

- [ ] **Step 3: Implementare enum**

```sql
create type public.stock_movement_type as enum (
  'OPENING_STOCK','SUPPLIER_RECEIPT','STORE_SUPPLY','STORE_RETURN',
  'INVENTORY_ADJUSTMENT','EXTRAORDINARY_ADJUSTMENT','ADMIN_ADJUSTMENT',
  'INTERSTORE_LOAN_OUT','INTERSTORE_LOAN_IN',
  'INTERSTORE_RETURN_OUT','INTERSTORE_RETURN_IN','REVERSAL'
);

create type public.stock_source_type as enum (
  'OPENING','SUPPLIER_RECEIPT','STORE_SUPPLY','STORE_RETURN',
  'INVENTORY','ADMIN','INTERSTORE_LOAN','INTERSTORE_RETURN','REVERSAL'
);

create type public.stock_reservation_type as enum ('STORE_SUPPLY','INTERSTORE_LOAN','INTERSTORE_RETURN');
create type public.stock_reservation_status as enum ('OPEN','CONSUMED','RELEASED');
```

- [ ] **Step 4: Implementare tabelle**

```sql
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  store_article_id uuid not null,
  movement_type public.stock_movement_type not null,
  quantity_delta_base numeric(14,3) not null,
  unit_cost_snapshot numeric(18,6),
  total_value_snapshot numeric(20,6) generated always as (
    case when unit_cost_snapshot is null then null
         else round(abs(quantity_delta_base) * unit_cost_snapshot, 6) end
  ) stored,
  source_type public.stock_source_type not null,
  source_id uuid,
  source_line_id uuid,
  reversal_of_movement_id uuid references public.stock_movements(id) on delete restrict,
  operation_key text not null,
  reason text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_by_name_snapshot text not null,
  constraint stock_movements_store_article_fk
    foreign key (store_article_id, store_id)
    references public.store_articles(id, store_id) on delete restrict,
  constraint stock_movements_nonzero check (quantity_delta_base <> 0),
  constraint stock_movements_cost_nonnegative check (unit_cost_snapshot is null or unit_cost_snapshot >= 0),
  constraint stock_movements_operation_key_not_blank check (length(btrim(operation_key)) > 0),
  constraint stock_movements_operation_key_unique unique (operation_key)
);

create table public.stock_balances (
  store_article_id uuid primary key,
  store_id uuid not null,
  on_hand numeric(14,3) not null default 0,
  reserved numeric(14,3) not null default 0,
  available numeric(14,3) generated always as (on_hand - reserved) stored,
  updated_at timestamptz not null default now(),
  last_movement_id uuid references public.stock_movements(id) on delete restrict,
  constraint stock_balances_store_article_fk
    foreign key (store_article_id, store_id)
    references public.store_articles(id, store_id) on delete restrict,
  constraint stock_balances_on_hand_nonnegative check (on_hand >= 0),
  constraint stock_balances_reserved_nonnegative check (reserved >= 0),
  constraint stock_balances_reserved_not_over_on_hand check (reserved <= on_hand)
);

create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  store_article_id uuid not null,
  quantity_base numeric(14,3) not null,
  reservation_type public.stock_reservation_type not null,
  source_id uuid not null,
  source_line_id uuid,
  status public.stock_reservation_status not null default 'OPEN',
  operation_key text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete restrict,
  constraint stock_reservations_store_article_fk
    foreign key (store_article_id, store_id)
    references public.store_articles(id, store_id) on delete restrict,
  constraint stock_reservations_quantity_positive check (quantity_base > 0),
  constraint stock_reservations_operation_key_not_blank check (length(btrim(operation_key)) > 0),
  constraint stock_reservations_operation_key_unique unique (operation_key),
  constraint stock_reservations_close_state check (
    (status = 'OPEN' and closed_at is null and closed_by is null)
    or (status in ('CONSUMED','RELEASED') and closed_at is not null and closed_by is not null)
  )
);
```

`created_by_name_snapshot` mantiene leggibile l'autore senza allargare la RLS di `profiles`; `created_by` resta l'identità autorevole.

- [ ] **Step 5: Indici, RLS e revoke iniziale**

```sql
create index stock_movements_store_date_idx on public.stock_movements(store_id, occurred_at desc);
create index stock_movements_article_date_idx on public.stock_movements(store_article_id, occurred_at desc);
create index stock_movements_reversal_idx on public.stock_movements(reversal_of_movement_id) where reversal_of_movement_id is not null;
create index stock_reservations_store_status_idx on public.stock_reservations(store_id, status);
create index stock_reservations_article_status_idx on public.stock_reservations(store_article_id, status);
```

Abilitare RLS su tutte e tre; `revoke all ... from anon, authenticated`.

- [ ] **Step 6: Dry-run, apply, contract e commit**

Prima `BEGIN; <migration>; ROLLBACK;`, poi apply migration Supabase, contract verde. Se il backend assegna altro prefisso, rinominare il file prima del commit.

```bash
git add magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql magazzino-fnb-v1/supabase/migrations/*stock_ledger_schema.sql
git commit -m "feat: add stock ledger schema"
```

---

### Task 2: Primitive atomiche saldo/movimenti + RPC Admin

**Files:**
- Create: `magazzino-fnb-v1/supabase/migrations/20260915135500_stock_ledger_core_operations.sql`
- Modify: `magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql`

**Interfaces:**
- Consumes: Task 1; `private.current_user_is_admin()`.
- Produces: `ensure_stock_balance`, `current_stock_unit_cost`, `current_user_stock_name`, `post_stock_movement`, `reverse_stock_movement`, `admin_adjust_stock`, `admin_reverse_stock_movement`.

- [ ] **Step 1: Contract RED routine**

Verificare schema/firme/security/grant; `anon` non esegue RPC Admin.

- [ ] **Step 2: Implementare `private.ensure_stock_balance`**

```sql
insert into public.stock_balances (store_article_id, store_id)
values (p_store_article_id, p_store_id)
on conflict (store_article_id) do nothing;

perform 1
from public.stock_balances
where store_article_id = p_store_article_id
  and store_id = p_store_id
for update;
```

Se la coppia non esiste/coincide: `Invalid store/article relationship`.

- [ ] **Step 3: Implementare snapshot autore e costo**

`private.current_user_stock_name()` legge il profilo `auth.uid()`, restituisce nome/cognome normalizzati o `Utente`.

`private.current_stock_unit_cost(p_store_article_id uuid)` restituisce l'ultimo `purchase_price_history.unit_price_snapshot` con `source='RECEIPT'`, collegato via `store_article_suppliers`, ordinato `recorded_at desc, id desc`; se assente `NULL`.

- [ ] **Step 4: Implementare `private.post_stock_movement`**

```sql
private.post_stock_movement(
  p_store_id uuid,
  p_store_article_id uuid,
  p_movement_type public.stock_movement_type,
  p_quantity_delta numeric,
  p_unit_cost numeric,
  p_source_type public.stock_source_type,
  p_source_id uuid,
  p_source_line_id uuid,
  p_reversal_of uuid,
  p_operation_key text,
  p_reason text,
  p_occurred_at timestamptz default now()
) returns uuid
```

Regole: zero vietato; `p_quantity_delta <> round(p_quantity_delta,3)` vietato; key vuota vietata; retry identico restituisce id esistente; stessa key con semantica diversa -> `Movement operation key conflict`; lock saldo; `new_on_hand < 0` -> `Stock would become negative`; `new_on_hand < reserved` -> `Reserved quantity exceeds resulting stock`; insert movimento + update saldo nella stessa transazione.

- [ ] **Step 5: Implementare `public.admin_adjust_stock`**

```sql
public.admin_adjust_stock(
  p_store_article_id uuid,
  p_quantity_delta numeric,
  p_reason text,
  p_operation_key text
) returns uuid
```

Deriva store dal `store_article`, richiede Admin e motivo non vuoto, usa `ADMIN_ADJUSTMENT`/`ADMIN`, costo corrente da helper.

- [ ] **Step 6: Implementare reversal completo**

`private.reverse_stock_movement`: lock originale; rifiuta `REVERSAL`; rifiuta originale già stornato; quantità esattamente opposta; stesso costo snapshot; `REVERSAL`/`REVERSAL`; delega a `post_stock_movement`.

```sql
public.admin_reverse_stock_movement(
  p_movement_id uuid,
  p_reason text,
  p_operation_key text
) returns uuid
```

Richiede Admin e motivo.

- [ ] **Step 7: Grant, apply e test DB**

Revocare `PUBLIC/anon`; concedere sole RPC pubbliche ad `authenticated`. Test: +10, retry identico, key conflict, -3, -8 rifiutato, reversal, secondo reversal rifiutato, reversal di reversal rifiutato, costo assente NULL.

- [ ] **Step 8: Commit**

```bash
git add magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql magazzino-fnb-v1/supabase/migrations/*stock_ledger_core_operations.sql
git commit -m "feat: add atomic stock movement operations"
```

---

### Task 3: Riserve auditabili

**Files:**
- Create: `magazzino-fnb-v1/supabase/migrations/20260915140500_stock_reservations.sql`
- Modify: `magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql`

**Interfaces:**
- Consumes: `ensure_stock_balance`, `post_stock_movement`.
- Produces: `open_stock_reservation`, `release_stock_reservation`, `consume_stock_reservation`; nessuna RPC browser generica.

- [ ] **Step 1: Contract RED**

Verificare le tre primitive in `private` e l'assenza di omonime funzioni pubbliche esposte.

- [ ] **Step 2: Implementare apertura**

```sql
private.open_stock_reservation(
  p_store_id uuid,
  p_store_article_id uuid,
  p_quantity numeric,
  p_reservation_type public.stock_reservation_type,
  p_source_id uuid,
  p_source_line_id uuid,
  p_operation_key text
) returns uuid
```

Quantità >0, massimo 3 decimali, lock saldo, `available >= quantity`, idempotenza semantica, insert OPEN + incremento reserved atomico.

- [ ] **Step 3: Implementare release**

`release_stock_reservation(id)` locka riserva/saldo; solo OPEN; imposta RELEASED/closed metadata; decrementa reserved; on_hand invariato; seconda chiusura -> `Reservation already closed`.

- [ ] **Step 4: Implementare consume**

```sql
private.consume_stock_reservation(
  p_reservation_id uuid,
  p_movement_type public.stock_movement_type,
  p_unit_cost numeric,
  p_source_type public.stock_source_type,
  p_movement_operation_key text,
  p_reason text
) returns uuid
```

Lock, chiude CONSUMED, decrementa reserved e crea movimento negativo stessa quantità nella medesima transazione; qualsiasi errore movimento rollbacka anche la chiusura.

- [ ] **Step 5: Apply/test DB**

On_hand 10; open4 -> reserved4/available6; open7 rifiutato; release -> reserved0/on_hand10; seconda release rifiutata; open3+consume -> reserved0/on_hand7/movimento-3; retry apertura identica non duplica.

- [ ] **Step 6: Commit**

```bash
git add magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql magazzino-fnb-v1/supabase/migrations/*stock_reservations.sql
git commit -m "feat: add auditable stock reservations"
```

---

### Task 4: RLS, immutabilità e acceptance DB

**Files:**
- Create: `magazzino-fnb-v1/supabase/migrations/20260915141500_stock_security.sql`
- Create: `magazzino-fnb-v1/supabase/tests/stock_ledger_acceptance.sql`

**Interfaces:**
- Consumes: Tasks 1-3 + foundation access helpers.
- Produces: read store-scoped, ledger immutabile e acceptance DB.

- [ ] **Step 1: Scrivere acceptance RED `BEGIN/ROLLBACK`**

Creare dati temporanei entrambi store e profilo USER temporaneo.

- [ ] **Step 2: Grant/policy SELECT**

```sql
grant select on public.stock_movements to authenticated;
grant select on public.stock_balances to authenticated;
grant select on public.stock_reservations to authenticated;
```

Per tutte:

```sql
using (private.current_user_has_store_access(store_id))
```

Nessuna policy write client.

- [ ] **Step 3: Trigger immutabilità**

`before update or delete on stock_movements` -> `Stock movements are immutable`.

- [ ] **Step 4: Apply e RLS acceptance**

USER Eccellenze vede solo Eccellenze; Admin entrambi. Direct insert/update/delete critici negati; RPC Admin negate a non-Admin; mismatch store/store_article rifiutato.

- [ ] **Step 5: Invarianti ricostruzione**

Somma movimenti = on_hand; somma OPEN = reserved; available = differenza. Precisione 0,375 preservata.

- [ ] **Step 6: Advisor indici**

Performance Advisor: correggere ogni `unindexed_foreign_keys` introdotta dal modulo. Non rimuovere indici `unused` solo perché le tabelle sono nuove.

- [ ] **Step 7: Commit**

```bash
git add magazzino-fnb-v1/supabase/tests/stock_ledger_acceptance.sql magazzino-fnb-v1/supabase/migrations/*stock_security.sql
git commit -m "test: enforce stock ledger security and invariants"
```

---

### Task 5: Dominio TypeScript, validazione e `StockGateway`

**Files:**
- Create: `magazzino-fnb-v1/src/stock/types.ts`
- Create: `magazzino-fnb-v1/src/stock/validation.ts`
- Create: `magazzino-fnb-v1/src/stock/validation.node.test.ts`
- Create: `magazzino-fnb-v1/src/stock/stockGateway.ts`
- Create: `magazzino-fnb-v1/src/stock/supabaseStockGateway.ts`
- Create: `magazzino-fnb-v1/src/stock/supabaseStockGateway.node.test.ts`
- Create: `magazzino-fnb-v1/src/stock/stockAcceptance.node.test.ts`

**Interfaces:**
- Consumes: SELECT RLS stock + RPC Admin.
- Produces: `StockGateway` isolato dal catalog gateway.

- [ ] **Step 1: Test/implementare quantità firmata**

```ts
assert.equal(parseSignedStockQuantity('0,375'), 0.375)
assert.equal(parseSignedStockQuantity('-0,375'), -0.375)
assert.equal(parseSignedStockQuantity('1.2345'), null)
assert.equal(parseSignedStockQuantity('-'), null)
```

```ts
export function parseSignedStockQuantity(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}
```

- [ ] **Step 2: Definire tipi esatti**

```ts
export type StockMovementType =
  | 'OPENING_STOCK' | 'SUPPLIER_RECEIPT' | 'STORE_SUPPLY' | 'STORE_RETURN'
  | 'INVENTORY_ADJUSTMENT' | 'EXTRAORDINARY_ADJUSTMENT' | 'ADMIN_ADJUSTMENT'
  | 'INTERSTORE_LOAN_OUT' | 'INTERSTORE_LOAN_IN'
  | 'INTERSTORE_RETURN_OUT' | 'INTERSTORE_RETURN_IN' | 'REVERSAL'

export interface StockBalance {
  storeArticleId: string
  storeId: string
  onHand: number
  reserved: number
  available: number
  currentUnitCost: number | null
  currentValue: number | null
}

export interface StockMovement {
  id: string
  storeId: string
  storeArticleId: string
  articleName: string
  baseUnit: 'CF' | 'PZ' | 'KG' | 'L'
  movementType: StockMovementType
  quantityDelta: number
  unitCostSnapshot: number | null
  totalValueSnapshot: number | null
  sourceType: string
  sourceId: string | null
  reversalOfMovementId: string | null
  reason: string | null
  occurredAt: string
  createdBy: string
  createdByName: string
  reversed: boolean
}

export interface MovementFilters {
  query?: string
  storeArticleId?: string
  movementType?: StockMovementType
  fromDate?: string
  toDate?: string
}

export interface AdminAdjustmentInput {
  storeArticleId: string
  quantityDelta: number
  reason: string
  operationKey: string
}

export interface ReverseMovementInput {
  movementId: string
  reason: string
  operationKey: string
}
```

- [ ] **Step 3: Definire saldo zero e gateway**

```ts
export function zeroStockBalance(storeId: string, storeArticleId: string): StockBalance {
  return { storeId, storeArticleId, onHand: 0, reserved: 0, available: 0, currentUnitCost: null, currentValue: null }
}

export interface StockGateway {
  listBalances(storeId: string): Promise<StockBalance[]>
  getBalance(storeId: string, storeArticleId: string): Promise<StockBalance>
  listMovements(storeId: string, filters?: MovementFilters): Promise<StockMovement[]>
  listRecentMovements(storeArticleId: string, limit?: number): Promise<StockMovement[]>
  adjustStock(input: AdminAdjustmentInput): Promise<string>
  reverseMovement(input: ReverseMovementInput): Promise<string>
}
```

- [ ] **Step 4: Test RED adapter**

Verificare numeric 0.375, saldo assente zero, cost NULL preservato, RPC quantity serializzata a 3 decimali ed error mapping.

- [ ] **Step 5: Implementare saldo/costo senza N+1**

Due query store-scoped: `stock_balances`; `purchase_price_history` con `source='RECEIPT'`, ordinata data/id desc e relazione `store_article_suppliers(store_article_id)`. Prima riga per store_article = currentUnitCost; currentValue = onHand*cost; assenza = null. `getBalance` senza riga usa `zeroStockBalance`.

- [ ] **Step 6: Implementare movimenti/reversed**

Query movimenti con `store_articles -> articles`; autore da `created_by_name_snapshot`. Seconda query dei REVERSAL costruisce un Set degli originali già stornati. `storeArticleId`, tipo e date filtrati DB; ricerca testo articolo applicata dopo mapping sul set già store-scoped.

- [ ] **Step 7: RPC/error mapping**

- negative stock -> `L’operazione porterebbe la giacenza sotto zero.`
- reserved conflict -> `Disponibilità insufficiente.`
- operation conflict -> `Movimento già registrato.`
- already reversed -> `Movimento già stornato.`
- non reversible -> `Movimento non stornabile.`
- permission -> `Non hai i permessi per operare su questo store.`
- SQLSTATE `40001` o `40P01` -> `La giacenza è cambiata nel frattempo. Riprova.`

- [ ] **Step 8: Node tests e commit**

```bash
node --experimental-strip-types --test src/stock/validation.node.test.ts src/stock/supabaseStockGateway.node.test.ts src/stock/stockAcceptance.node.test.ts
git add magazzino-fnb-v1/src/stock
git commit -m "feat: add stock domain gateway"
```

---

### Task 6: Stock reale in Articoli

**Files:**
- Modify: `magazzino-fnb-v1/src/catalog/CatalogWorkspace.tsx`
- Modify: `magazzino-fnb-v1/src/catalog/ArticlesScreen.tsx`
- Modify: `magazzino-fnb-v1/src/catalog/ArticlesScreen.test.tsx`
- Modify: `magazzino-fnb-v1/src/catalog/ArticleDetail.tsx`
- Modify: `magazzino-fnb-v1/src/catalog/ArticleDetail.test.tsx`
- Create: `magazzino-fnb-v1/src/stock/StockSummary.tsx`
- Create: `magazzino-fnb-v1/src/stock/StockSummary.test.tsx`

**Interfaces:**
- Consumes: StockGateway.
- Produces: stock reale lista/dettaglio e callback verso storico completo.

- [ ] **Step 1: Test lista RED**

Saldo 20/5/15 -> `Fisico 20 PZ`, `Riservato 5`, `Disponibile 15`; saldo assente -> zero.

- [ ] **Step 2: Test `StockSummary` RED**

Saldo reale; reserved 0; costo null -> `Valore non disponibile`; costo 1.25/onHand20 -> `€ 25,00`.

- [ ] **Step 3: CatalogWorkspace**

Prop `stockGateway` e `onOpenMovementsForArticle(storeArticleId)`. Caricare categories + articles + balances in Promise.all; map saldo per storeArticleId, fallback `zeroStockBalance`.

- [ ] **Step 4: ArticlesScreen**

Prop `stockByArticleId`; mostra fisico/riservato/disponibile senza introdurre logica riordino.

- [ ] **Step 5: ArticleDetail**

Riceve `stockGateway` e `onOpenMovements`; mostra `StockSummary`, ultimi 5 movimenti e bottone `Vedi tutti i movimenti` che invoca callback con `article.id`. Nessun “nuovo movimento”.

- [ ] **Step 6: Regression e commit**

```bash
npm run test:run -- ArticlesScreen ArticleDetail StockSummary
npm run test:bootstrap
git add magazzino-fnb-v1/src/catalog magazzino-fnb-v1/src/stock/StockSummary.tsx magazzino-fnb-v1/src/stock/StockSummary.test.tsx
git commit -m "feat: show real warehouse stock in catalog"
```

---

### Task 7: Schermata Movimenti + rettifica/storno Admin

**Files:**
- Create: `magazzino-fnb-v1/src/stock/StockMovementsScreen.tsx`
- Create: `magazzino-fnb-v1/src/stock/StockMovementsScreen.test.tsx`
- Create: `magazzino-fnb-v1/src/stock/stock.css`
- Modify: `magazzino-fnb-v1/src/App.tsx`
- Modify: `magazzino-fnb-v1/src/app/AppShell.tsx`
- Modify: `magazzino-fnb-v1/src/app/MoreScreen.tsx`
- Modify: `magazzino-fnb-v1/src/app/AppShell.test.tsx`
- Modify: `magazzino-fnb-v1/src/main.tsx`

**Interfaces:**
- Consumes: StockGateway, CatalogGateway, ActorAccess, store attivo.
- Produces: Movimenti reale in Altro; filtro iniziale da dettaglio articolo; azioni Admin previste.

- [ ] **Step 1: Test UI RED**

Movimenti cliccabile; cambio store ricarica store; filtri articolo/tipo/date; non-Admin senza Rettifica/Storna; Admin con Rettifica; motivo obbligatorio; reversal/originale già stornato senza Storna; apertura da ArticleDetail prefiltra `storeArticleId`.

- [ ] **Step 2: Implementare props**

```ts
type StockMovementsScreenProps = {
  actor: ActorAccess
  storeId: string
  gateway: StockGateway
  catalogGateway: CatalogGateway
  initialStoreArticleId?: string
}
```

Caricare movimenti e `catalogGateway.listStoreArticles(storeId)` per selezione rettifica.

- [ ] **Step 3: Lista/filtri**

Mostra articolo, tipo, data, quantità con segno/unità, autore snapshot, origine, costo/valore se noti, stato storno. Filtri: ricerca, articolo iniziale/esatto, tipo, date.

- [ ] **Step 4: Rettifica Admin idempotente**

Form separato: articolo, quantità firmata non zero, motivo. `useRef<string|null>` per operation key: genera UUID al primo submit, conserva su retry identico, azzera al successo o quando cambiano articolo/quantità/motivo.

- [ ] **Step 5: Storno Admin**

Motivo + operation key propria; `reverseMovement`, refresh; azione solo se non REVERSAL e `reversed=false`.

- [ ] **Step 6: Wiring AppShell**

`App.tsx` crea `stockGateway`. `AppShell` riceve stockGateway, `MoreTarget` include movements e mantiene `movementArticleFilter: string | undefined`. `onOpenMovementsForArticle` passa da AppShell -> CatalogWorkspace -> ArticleDetail; imposta sezione `more`, target `movements`, filtro articolo. Aprendo Movimenti dal menu il filtro viene azzerato. Cambio store azzera filtro.

- [ ] **Step 7: CSS/import e full task verify**

```bash
npm run test:run
npm run test:bootstrap
npm run lint
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add magazzino-fnb-v1/src/App.tsx magazzino-fnb-v1/src/app magazzino-fnb-v1/src/catalog magazzino-fnb-v1/src/stock magazzino-fnb-v1/src/main.tsx
git commit -m "feat: add stock movements workspace"
```

---

### Task 8: Acceptance finale, advisor, README e Cloudflare

**Files:**
- Modify: `magazzino-fnb-v1/src/stock/stockAcceptance.node.test.ts`
- Modify: `magazzino-fnb-v1/supabase/tests/stock_ledger_acceptance.sql`
- Modify: `magazzino-fnb-v1/README.md`

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: evidenza fresca di completamento e branch pronto per finishing workflow.

- [ ] **Step 1: Acceptance Node**

Verificare 0,375; saldo zero; formula available; costo null; nessuno stock hardcoded production in `src/stock`, `src/catalog`, `src/app`; nessun branding `RATIO`.

- [ ] **Step 2: Acceptance DB completa con rollback**

Verificare gli invarianti 1-18 e 20-25 della spec: somme ledger/saldo, riserve, non-negatività, idempotenza, immutabilità, RLS, precisione, reversal, release/consume, costo storico/null, direct writes negate, saldo zero, store mismatch.

Per l'invariante 19 inter-store: nella stessa transazione chiamare due volte `private.post_stock_movement` su store diversi, forzare un'eccezione prima del commit e verificare dopo rollback che nessuna gamba persista. Non esporre ancora RPC prestito.

- [ ] **Step 3: Security/Performance Advisor**

Nessun nuovo finding security stock; nessuna FK stock non indicizzata. Il warning Auth leaked-password protection preesistente resta separato.

- [ ] **Step 4: README**

Documentare ledger immutabile, on_hand/reserved/available, rettifica/storno Admin, RLS, valore solo con costo RECEIPT disponibile e dipendenza dei moduli futuri dalle primitive stock.

- [ ] **Step 5: Full verification**

```bash
npm install
npm run test:run
npm run test:bootstrap
npm run lint
npm run build
```

- [ ] **Step 6: Cloudflare + diff review**

GitHub build e `Workers Builds: magazzino-fnb-v1` devono essere `success`. Review `main...branch`: nessuna modifica estranea, workflow temporaneo, dato test, segreto o service-role key.

- [ ] **Step 7: Commit finale**

```bash
git add magazzino-fnb-v1/README.md magazzino-fnb-v1/src/stock/stockAcceptance.node.test.ts magazzino-fnb-v1/supabase/tests/stock_ledger_acceptance.sql
git commit -m "docs: finalize stock ledger module"
```

- [ ] **Step 8: Handoff**

Non fare merge automatico su `main`. Presentare le opzioni del finishing workflow solo dopo evidenza fresca di test/build/Cloudflare verdi.
