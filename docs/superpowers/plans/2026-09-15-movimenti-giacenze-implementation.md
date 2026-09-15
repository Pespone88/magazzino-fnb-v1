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
- Le migration vanno applicate tramite Supabase; se il backend restituisce un prefisso versione canonico diverso da quello pianificato, il file repository va rinominato a quel prefisso prima del commit e non va conservata una copia duplicata.

---

## File map

Nuovi file:

- `magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql`
- `magazzino-fnb-v1/supabase/tests/stock_ledger_acceptance.sql`
- `magazzino-fnb-v1/supabase/migrations/20260915134500_stock_ledger_schema.sql`
- `magazzino-fnb-v1/supabase/migrations/20260915135500_stock_ledger_operations.sql`
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

Il contract deve verificare presenza delle tre tabelle, RLS attiva e assenza dei privilegi client critici:

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

- [ ] **Step 2: Eseguire il contract e confermare RED**

Eseguire sul progetto Supabase corrente. Expected: oggetti stock assenti.

- [ ] **Step 3: Implementare enum e tabelle**

Enum:

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

Tabelle:

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

`created_by_name_snapshot` evita di allargare la RLS di `profiles`: il nome visualizzato nello storico è congelato al momento del movimento, mentre `created_by` resta l'identità autorevole.

- [ ] **Step 4: Indici e lock-down iniziale**

Creare indici:

```sql
create index stock_movements_store_date_idx on public.stock_movements(store_id, occurred_at desc);
create index stock_movements_article_date_idx on public.stock_movements(store_article_id, occurred_at desc);
create index stock_movements_reversal_idx on public.stock_movements(reversal_of_movement_id) where reversal_of_movement_id is not null;
create index stock_reservations_store_status_idx on public.stock_reservations(store_id, status);
create index stock_reservations_article_status_idx on public.stock_reservations(store_article_id, status);
```

Abilitare RLS su tutte e tre le tabelle e `revoke all ... from anon, authenticated`.

- [ ] **Step 5: Dry-run e applicazione**

Eseguire `BEGIN; <migration>; ROLLBACK;`, poi applicare via Supabase migration. Se il backend assegna un altro prefisso versione, rinominare il file repository a quel valore prima del commit.

- [ ] **Step 6: Rieseguire contract e commit**

Expected: schema/RLS verdi, write privileges `false`.

```bash
git add magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql magazzino-fnb-v1/supabase/migrations/*stock_ledger_schema.sql
git commit -m "feat: add stock ledger schema"
```

---

### Task 2: Primitive atomiche saldo/movimenti + RPC Admin

**Files:**
- Create: `magazzino-fnb-v1/supabase/migrations/20260915135500_stock_ledger_operations.sql`
- Modify: `magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql`

**Interfaces:**
- Consumes: Task 1; `private.current_user_is_admin()`.
- Produces: `private.ensure_stock_balance`, `private.current_stock_unit_cost`, `private.current_user_stock_name`, `private.post_stock_movement`, `private.reverse_stock_movement`, `public.admin_adjust_stock`, `public.admin_reverse_stock_movement`.

- [ ] **Step 1: Estendere contract RED con le routine**

Verificare schema, firme, security mode e grant; `anon` non deve poter eseguire le RPC Admin.

- [ ] **Step 2: Implementare `ensure_stock_balance` concorrente-sicuro**

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

Se la coppia non esiste o appartiene a un altro store: `Invalid store/article relationship`.

- [ ] **Step 3: Implementare nome autore snapshot**

`private.current_user_stock_name()` legge `profiles` per `auth.uid()` e restituisce `first_name || ' ' || last_name` normalizzato; fallback `Utente`. La funzione viene chiamata da `post_stock_movement`, non dal browser.

- [ ] **Step 4: Implementare costo corrente**

`private.current_stock_unit_cost(p_store_article_id uuid)` restituisce l'ultimo `purchase_price_history.unit_price_snapshot` con `source='RECEIPT'`, collegato tramite `store_article_suppliers`, ordinato `recorded_at desc, id desc`. Se non esiste: `NULL`.

- [ ] **Step 5: Implementare `private.post_stock_movement`**

Firma:

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

Regole:
- rifiuta `0`;
- rifiuta `p_quantity_delta <> round(p_quantity_delta, 3)` prima del cast a `numeric(14,3)`;
- operation key vuota -> errore;
- su operation key esistente restituisce lo stesso id solo se store, articolo, tipo, quantità, source e reversal coincidono; altrimenti `Movement operation key conflict`;
- crea/locka saldo;
- rifiuta `new_on_hand < 0` (`Stock would become negative`);
- rifiuta `new_on_hand < reserved` (`Reserved quantity exceeds resulting stock`);
- inserisce movimento con `created_by=auth.uid()` e `created_by_name_snapshot=private.current_user_stock_name()`;
- aggiorna saldo nella stessa transazione.

- [ ] **Step 6: Implementare rettifica Admin**

```sql
public.admin_adjust_stock(
  p_store_article_id uuid,
  p_quantity_delta numeric,
  p_reason text,
  p_operation_key text
) returns uuid
```

Deriva lo store dal `store_article`, richiede Admin, motivo non vuoto, usa `ADMIN_ADJUSTMENT`, `ADMIN`, costo da `current_stock_unit_cost`.

- [ ] **Step 7: Implementare reversal Admin**

`private.reverse_stock_movement` locka l'originale, rifiuta `REVERSAL`, rifiuta originali già stornati, crea quantità esattamente opposta e copia il costo snapshot. Delega a `post_stock_movement`, quindi uno storno che causerebbe saldo negativo o conflitto con reserved fallisce atomicamente.

RPC:

```sql
public.admin_reverse_stock_movement(
  p_movement_id uuid,
  p_reason text,
  p_operation_key text
) returns uuid
```

Richiede Admin e motivo non vuoto.

- [ ] **Step 8: Grant minimi e test DB**

Revocare `PUBLIC/anon`; concedere solo le RPC pubbliche ad `authenticated`. Test in outer transaction:
- `+10` -> 10;
- retry identico -> un record;
- retry stessa key con quantità diversa -> errore;
- `-3` -> 7;
- `-8` -> errore e saldo invariato;
- reversal del `-3` -> 10;
- secondo reversal -> errore;
- reversal di reversal -> errore;
- costo assente resta `NULL`.

- [ ] **Step 9: Commit**

```bash
git add magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql magazzino-fnb-v1/supabase/migrations/*stock_ledger_operations.sql
git commit -m "feat: add atomic stock movement operations"
```

---

### Task 3: Riserve auditabili e consumo atomico

**Files:**
- Modify: `magazzino-fnb-v1/supabase/migrations/20260915135500_stock_ledger_operations.sql`
- Modify: `magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql`

**Interfaces:**
- Consumes: `ensure_stock_balance`, `post_stock_movement`.
- Produces: `private.open_stock_reservation`, `private.release_stock_reservation`, `private.consume_stock_reservation`; nessuna RPC pubblica generica.

- [ ] **Step 1: Contract RED**

Verificare le tre primitive in `private` e verificare che non esistano omonime funzioni pubbliche invocabili dal Data API.

- [ ] **Step 2: Implementare apertura riserva**

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

Rifiuta quantità <=0 o oltre 3 decimali, crea/locka saldo, verifica `available >= p_quantity`, idempotenza operation key con controllo semantico, inserisce `OPEN` e incrementa `reserved` atomicamente.

- [ ] **Step 3: Implementare release**

`private.release_stock_reservation(p_reservation_id uuid)` locka riserva e saldo; solo `OPEN`; imposta `RELEASED`, `closed_at`, `closed_by`, decrementa reserved; `on_hand` invariato. Seconda chiusura -> `Reservation already closed`.

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

Lock riserva e saldo, chiude `CONSUMED`, decrementa reserved e crea il movimento negativo della stessa quantità nella medesima transazione. Se il movimento fallisce, anche la chiusura della riserva deve rollbackare.

- [ ] **Step 5: Test DB riserve**

Sequenza minima:
- on_hand 10;
- open 4 -> reserved 4 / available 6;
- open 7 -> errore;
- release -> reserved 0 / on_hand 10;
- seconda release -> errore;
- open 3 + consume -> reserved 0 / on_hand 7 / movimento -3;
- retry apertura identica -> nessun duplicato.

- [ ] **Step 6: Commit**

```bash
git add magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql magazzino-fnb-v1/supabase/migrations/*stock_ledger_operations.sql
git commit -m "feat: add auditable stock reservations"
```

---

### Task 4: RLS, immutabilità e acceptance DB

**Files:**
- Modify: `magazzino-fnb-v1/supabase/migrations/20260915135500_stock_ledger_operations.sql`
- Create: `magazzino-fnb-v1/supabase/tests/stock_ledger_acceptance.sql`

**Interfaces:**
- Consumes: foundation access helpers + Tasks 1-3.
- Produces: SELECT store-scoped, ledger immutabile, acceptance degli invarianti DB.

- [ ] **Step 1: Scrivere acceptance RED in `BEGIN/ROLLBACK`**

Creare dati temporanei per entrambi gli store e un profilo USER temporaneo; nessun dato test deve persistere.

- [ ] **Step 2: Grant e policy**

```sql
grant select on public.stock_movements to authenticated;
grant select on public.stock_balances to authenticated;
grant select on public.stock_reservations to authenticated;
```

Policy SELECT su tutte e tre:

```sql
using (private.current_user_has_store_access(store_id))
```

Nessuna policy di scrittura client.

- [ ] **Step 3: Trigger immutabilità ledger**

`before update or delete on stock_movements` alza sempre `Stock movements are immutable`. Le correzioni sono solo nuovi movimenti/reversal.

- [ ] **Step 4: Acceptance RLS**

Simulare JWT USER assegnato solo a Eccellenze: deve vedere soltanto movimenti/saldi/riserve Eccellenze. Admin deve vedere entrambi.

- [ ] **Step 5: Acceptance invarianti**

Per ogni store_article test:

```sql
select coalesce(sum(quantity_delta_base), 0)
from public.stock_movements
where store_article_id = v_store_article_id;
```

Deve coincidere con `on_hand`. La somma delle riserve `OPEN` deve coincidere con `reserved`; `available=on_hand-reserved`.

Testare inoltre mismatch `store_id/store_article_id`, direct writes negate e RPC Admin negate al non-Admin.

- [ ] **Step 6: Advisor indici**

Eseguire Performance Advisor e aggiungere gli indici mancanti per ogni `unindexed_foreign_keys` del modulo stock. Non eliminare indici solo perché `unused` su tabelle nuove.

- [ ] **Step 7: Commit**

```bash
git add magazzino-fnb-v1/supabase/tests/stock_ledger_acceptance.sql magazzino-fnb-v1/supabase/migrations/*stock_ledger_operations.sql
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

- [ ] **Step 1: Test RED validazione quantità firmata**

```ts
assert.equal(parseSignedStockQuantity('0,375'), 0.375)
assert.equal(parseSignedStockQuantity('-0,375'), -0.375)
assert.equal(parseSignedStockQuantity('1.2345'), null)
assert.equal(parseSignedStockQuantity('-'), null)
```

Implementare:

```ts
export function parseSignedStockQuantity(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}
```

- [ ] **Step 2: Definire tipi**

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

- [ ] **Step 3: Definire helper saldo zero e gateway**

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

- [ ] **Step 4: Test RED adapter Supabase**

Verificare numeric `'0.375'`, saldo assente -> zero, `NULL` cost preservato, quantità RPC serializzata a 3 decimali e mapping errori funzionali.

- [ ] **Step 5: Implementare `listBalances/getBalance` senza N+1**

Fare due query store-scoped:
1. `stock_balances` dello store;
2. `purchase_price_history` dello store con `source='RECEIPT'`, ordinata `recorded_at desc, id desc`, selezionando la relazione `store_article_suppliers(store_article_id)`.

Costruire una map del primo prezzo RECEIPT per `store_article_id`. Per ciascun saldo: `currentUnitCost=ultimoReceipt ?? null`; `currentValue = currentUnitCost === null ? null : onHand * currentUnitCost`. `getBalance` senza riga usa `zeroStockBalance` e applica lo stesso lookup costo.

- [ ] **Step 6: Implementare movimenti e `reversed`**

Query stock movements store-scoped con relazione `store_articles -> articles`; il nome autore arriva da `created_by_name_snapshot`, non da join a `profiles`. Una seconda query leggera dei `REVERSAL` dello store costruisce `Set<reversal_of_movement_id>` per marcare gli originali già stornati anche se il reversal è fuori dal filtro data corrente.

Applicare `movementType/fromDate/toDate` sul DB; `query` articolo può essere applicata dopo mapping sul set già store-scoped per evitare filtri PostgREST fragili sulle relazioni.

- [ ] **Step 7: Implementare RPC write/error mapping**

`adjustStock` chiama `admin_adjust_stock`; `reverseMovement` chiama `admin_reverse_stock_movement`. Mappare:
- `Stock would become negative` -> `L’operazione porterebbe la giacenza sotto zero.`
- `Reserved quantity exceeds resulting stock` -> `Disponibilità insufficiente.`
- operation key conflict -> `Movimento già registrato.`
- already reversed -> `Movimento già stornato.`
- reversal original/not reversible -> `Movimento non stornabile.`
- permission -> `Non hai i permessi per operare su questo store.`

- [ ] **Step 8: Test Node e commit**

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
- Consumes: `StockGateway.listBalances`, `getBalance`, `listRecentMovements`.
- Produces: lista e dettaglio Articoli con stock reale.

- [ ] **Step 1: Aggiornare test Articoli RED**

Il vecchio test anti-giacenza diventa un test di giacenza reale. Con `{onHand:20,reserved:5,available:15}` mostra `Fisico 20 PZ`, `Riservato 5`, `Disponibile 15`; senza saldo mostra zero.

- [ ] **Step 2: Testare `StockSummary` RED**

Casi:
- saldo reale;
- reserved zero senza enfasi;
- costo null -> `Valore non disponibile`;
- costo 1.25/onHand 20 -> `€ 25,00`.

- [ ] **Step 3: Caricare saldi in `CatalogWorkspace`**

Aggiungere `stockGateway` props e usare:

```ts
Promise.all([
  gateway.listCategories(),
  gateway.listStoreArticles(storeId),
  stockGateway.listBalances(storeId),
])
```

Costruire `Map<string, StockBalance>`; per articoli senza riga usare `zeroStockBalance(storeId, article.id)`.

- [ ] **Step 4: Integrare lista**

`ArticlesScreen` riceve `stockByArticleId` e mostra fisico/riservato/disponibile accanto a minimo/obiettivo e fornitore. Non calcola suggerimenti d'ordine.

- [ ] **Step 5: Integrare dettaglio**

`ArticleDetail` riceve `stockGateway`, carica saldo e ultimi 5 movimenti, mostra sezione Magazzino. Nessun pulsante generico “nuovo movimento”.

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
- Consumes: `StockGateway`, `CatalogGateway`, ActorAccess, active store.
- Produces: Movimenti reale in Altro, storico store-first e sole azioni Admin previste.

- [ ] **Step 1: Test UI RED**

Verificare:
- Movimenti cliccabile da Altro;
- cambio store richiama solo lo store selezionato;
- filtri articolo/tipo/date sono applicati;
- non-Admin non vede Rettifica/Storna;
- Admin vede Rettifica;
- motivo obbligatorio;
- reversal e originali già stornati non espongono Storna.

- [ ] **Step 2: Implementare props e caricamento**

```ts
type StockMovementsScreenProps = {
  actor: ActorAccess
  storeId: string
  gateway: StockGateway
  catalogGateway: CatalogGateway
}
```

Caricare `gateway.listMovements(storeId, filters)` e `catalogGateway.listStoreArticles(storeId)` per popolare il form Admin senza duplicare il catalogo dentro StockGateway.

- [ ] **Step 3: Implementare lista/filtri**

UI mostra articolo, tipo, data, quantità con segno/unità, `createdByName`, origine, costo/valore se noti e stato storno. Filtri: ricerca articolo, tipo, data da/a.

- [ ] **Step 4: Implementare rettifica Admin con idempotenza UI**

Form separato: articolo store, quantità delta firmata (`parseSignedStockQuantity`, diversa da zero), motivo obbligatorio. Usare `useRef<string | null>` per operation key: generarne una con `crypto.randomUUID()` al primo submit, mantenerla se la stessa richiesta fallisce e viene ritentata; azzerarla al successo o quando l'utente modifica articolo/quantità/motivo.

- [ ] **Step 5: Implementare storno Admin**

Conferma con motivo e operation key propria; chiamare `reverseMovement`, poi ricaricare elenco. Non mostrare azione per `REVERSAL` o `reversed=true`.

- [ ] **Step 6: Wiring applicazione**

`App.tsx` crea `createSupabaseStockGateway`. `AppShell` riceve `stockGateway`; `MoreTarget` include `movements`; `MoreScreen` sostituisce la card Movimenti disabilitata con bottone reale. Passare sia `stockGateway` sia `catalogGateway` a `StockMovementsScreen` e `stockGateway` a `CatalogWorkspace`.

- [ ] **Step 7: CSS/import**

Creare `stock.css`, importarlo da `main.tsx`, mantenendo palette/layout esistenti e mobile-first.

- [ ] **Step 8: Full task verification e commit**

```bash
npm run test:run
npm run test:bootstrap
npm run lint
npm run build
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

- [ ] **Step 1: Acceptance Node anti-regressione**

Verificare quantità `0,375`, saldo zero, formula available, costo null, nessuno stock hardcoded nei source production `src/stock`, `src/catalog`, `src/app`, nessun branding `RATIO`.

- [ ] **Step 2: Acceptance DB completa con rollback**

Verificare esplicitamente gli invarianti spec:
1. on_hand = somma movimenti;
2. reserved = somma OPEN;
3. available corretto;
4. niente saldo negativo;
5. niente reserved > on_hand;
6. idempotenza;
7. ledger non aggiornabile/cancellabile;
8. saldo non scrivibile client;
9. RLS cross-store;
10. Admin entrambi;
11. precisione 0,375;
12-15. reversal record separato, una volta, non reversibile, non negativo;
16. riserva chiudibile una volta;
17. release non cambia on_hand;
18. consume+movimento atomici;
20. costo storico immutabile;
21. costo assente null;
22. UI anti-hardcode via Node test;
23. niente direct writes tabelle critiche;
24. saldo assente -> zero via adapter;
25. mismatch store/store_article rifiutato.

Per il punto 19, predisposizione inter-store: eseguire in una singola transazione di acceptance due `private.post_stock_movement` su store diversi, poi forzare un'eccezione prima del commit e verificare dopo rollback che nessuna gamba persista. Non esporre ancora una RPC prestito.

- [ ] **Step 3: Security/Performance Advisor**

Nessun nuovo finding security stock; nessuna FK stock non indicizzata. Il warning Auth leaked-password protection già preesistente può restare separato dal modulo.

- [ ] **Step 4: README**

Documentare ledger immutabile, `on_hand/reserved/available`, rettifica/storno Admin, RLS, valore solo con costo RECEIPT disponibile e dipendenza futura dei moduli operativi dalle primitive stock.

- [ ] **Step 5: Full verification**

```bash
npm install
npm run test:run
npm run test:bootstrap
npm run lint
npm run build
```

Expected: tutto verde.

- [ ] **Step 6: Cloudflare e review diff**

Controllare GitHub build e `Workers Builds: magazzino-fnb-v1` sul commit finale. Review `main...branch`: nessuna modifica estranea, workflow temporaneo, dato test, segreto o service-role key.

- [ ] **Step 7: Commit finale**

```bash
git add magazzino-fnb-v1/README.md magazzino-fnb-v1/src/stock/stockAcceptance.node.test.ts magazzino-fnb-v1/supabase/tests/stock_ledger_acceptance.sql
git commit -m "docs: finalize stock ledger module"
```

- [ ] **Step 8: Handoff**

Non fare merge automatico su `main`. Presentare le opzioni del finishing workflow solo dopo evidenza fresca di test/build/Cloudflare verdi.
