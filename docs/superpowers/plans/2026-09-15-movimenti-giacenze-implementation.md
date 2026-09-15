# Movimenti + Giacenze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare il ledger stock definitivo di Magazzini F&B con saldo corrente materializzato, riserve auditabili, rettifica/storno Admin, RLS store-scoped e integrazione reale delle giacenze nella UI Articoli e Movimenti.

**Architecture:** `stock_movements` è il ledger fisico append-only e `stock_reservations` è il registro append-only/close-only degli impegni; `stock_balances` è una proiezione materializzata aggiornata nella stessa transazione PostgreSQL delle primitive stock. Il browser non scrive mai direttamente queste tre tabelle: legge tramite RLS e usa solo RPC di business ristrette; le primitive generiche vivono nello schema `private` e vengono riutilizzate dai moduli futuri.

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
- I moduli Ricezioni, Rifornimenti, Inventari e Prestiti useranno le stesse primitive private senza introdurre ledger paralleli.

---

## File map

Nuovi file principali:

- `magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql` — contratto schema, grant, RLS e firme routine.
- `magazzino-fnb-v1/supabase/tests/stock_ledger_acceptance.sql` — acceptance transazionale degli invarianti DB.
- `magazzino-fnb-v1/supabase/migrations/20260915134500_stock_ledger_schema.sql` — enum, tabelle, constraint, indici e RLS base.
- `magazzino-fnb-v1/supabase/migrations/20260915135500_stock_ledger_operations.sql` — primitive private e RPC Admin.
- `magazzino-fnb-v1/src/stock/types.ts` — tipi dominio stock.
- `magazzino-fnb-v1/src/stock/stockGateway.ts` — interfaccia adapter stock.
- `magazzino-fnb-v1/src/stock/supabaseStockGateway.ts` — letture Supabase e RPC Admin.
- `magazzino-fnb-v1/src/stock/supabaseStockGateway.node.test.ts` — mapping, precisione ed error mapping.
- `magazzino-fnb-v1/src/stock/StockSummary.tsx` — fisico/riservato/disponibile/valore.
- `magazzino-fnb-v1/src/stock/StockSummary.test.tsx` — rendering saldo reale/zero/null cost.
- `magazzino-fnb-v1/src/stock/StockMovementsScreen.tsx` — storico, filtri, rettifica e storno Admin.
- `magazzino-fnb-v1/src/stock/StockMovementsScreen.test.tsx` — comportamento UI e permessi.
- `magazzino-fnb-v1/src/stock/stock.css` — styling mobile-first del modulo.
- `magazzino-fnb-v1/src/stock/stockAcceptance.node.test.ts` — invarianti puri/formattazione/anti-hardcode.

File modificati:

- `magazzino-fnb-v1/src/App.tsx` — crea e inietta `StockGateway`.
- `magazzino-fnb-v1/src/app/AppShell.tsx` — apre Movimenti e passa stock gateway al catalogo.
- `magazzino-fnb-v1/src/app/MoreScreen.tsx` — rende Movimenti attivo.
- `magazzino-fnb-v1/src/app/AppShell.test.tsx` — verifica wiring store-first.
- `magazzino-fnb-v1/src/catalog/CatalogWorkspace.tsx` — carica saldi insieme al catalogo.
- `magazzino-fnb-v1/src/catalog/ArticlesScreen.tsx` — mostra stock reale.
- `magazzino-fnb-v1/src/catalog/ArticlesScreen.test.tsx` — sostituisce il vecchio anti-stock con test stock reale.
- `magazzino-fnb-v1/src/catalog/ArticleDetail.tsx` — aggiunge sezione Magazzino e ultimi movimenti.
- `magazzino-fnb-v1/src/catalog/ArticleDetail.test.tsx` — verifica saldo e storico.
- `magazzino-fnb-v1/src/main.tsx` — importa `stock.css`.
- `magazzino-fnb-v1/README.md` — stato modulo e comandi di verifica.

---

### Task 1: Schema ledger, saldo e riserve

**Files:**
- Create: `magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql`
- Create: `magazzino-fnb-v1/supabase/migrations/20260915134500_stock_ledger_schema.sql`

**Interfaces:**
- Consumes: `public.store_articles(id, store_id)`, `public.stores`, `public.profiles`, `private.current_user_has_store_access(uuid)`.
- Produces: enum `stock_movement_type`, `stock_source_type`, `stock_reservation_type`, `stock_reservation_status`; tables `stock_movements`, `stock_balances`, `stock_reservations`.

- [ ] **Step 1: Scrivere il contract SQL RED**

Il contract deve verificare almeno:

```sql
select to_regclass('public.stock_movements') is not null as has_movements;
select to_regclass('public.stock_balances') is not null as has_balances;
select to_regclass('public.stock_reservations') is not null as has_reservations;

select relrowsecurity
from pg_class
where oid in (
  'public.stock_movements'::regclass,
  'public.stock_balances'::regclass,
  'public.stock_reservations'::regclass
);

select has_table_privilege('authenticated', 'public.stock_movements', 'DELETE') as movement_delete;
select has_table_privilege('authenticated', 'public.stock_movements', 'UPDATE') as movement_update;
select has_table_privilege('authenticated', 'public.stock_balances', 'INSERT,UPDATE,DELETE') as balance_write;
select has_table_privilege('authenticated', 'public.stock_reservations', 'INSERT,UPDATE,DELETE') as reservation_write;
```

Expected finale: tre tabelle presenti, RLS `true`, tutti i privilegi di scrittura diretta sopra `false`.

- [ ] **Step 2: Eseguire il contract e confermare RED**

Eseguire il file sul progetto Supabase corrente tramite SQL query. Expected: tabelle/tipi mancanti.

- [ ] **Step 3: Implementare schema e constraint**

Creare gli enum esatti:

```sql
create type public.stock_movement_type as enum (
  'OPENING_STOCK', 'SUPPLIER_RECEIPT', 'STORE_SUPPLY', 'STORE_RETURN',
  'INVENTORY_ADJUSTMENT', 'EXTRAORDINARY_ADJUSTMENT', 'ADMIN_ADJUSTMENT',
  'INTERSTORE_LOAN_OUT', 'INTERSTORE_LOAN_IN',
  'INTERSTORE_RETURN_OUT', 'INTERSTORE_RETURN_IN', 'REVERSAL'
);

create type public.stock_source_type as enum (
  'OPENING', 'SUPPLIER_RECEIPT', 'STORE_SUPPLY', 'STORE_RETURN',
  'INVENTORY', 'ADMIN', 'INTERSTORE_LOAN', 'INTERSTORE_RETURN', 'REVERSAL'
);

create type public.stock_reservation_type as enum ('STORE_SUPPLY', 'INTERSTORE_LOAN', 'INTERSTORE_RETURN');
create type public.stock_reservation_status as enum ('OPEN', 'CONSUMED', 'RELEASED');
```

Schema minimo:

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

Aggiungere indici su `(store_id, occurred_at desc)`, `(store_article_id, occurred_at desc)`, `reversal_of_movement_id`, riserve `(store_id, status)`, `(store_article_id, status)`; abilitare RLS e revocare inizialmente tutti i privilegi ad `anon, authenticated`.

- [ ] **Step 4: Dry-run migration in transaction**

Eseguire `BEGIN; <migration>; ROLLBACK;` sul DB e verificare che non restino oggetti persistiti.

- [ ] **Step 5: Applicare migration e rieseguire contract**

Applicare la migration con lo strumento Supabase migrations. Expected: contract schema verde.

- [ ] **Step 6: Commit**

```bash
git add magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql magazzino-fnb-v1/supabase/migrations/20260915134500_stock_ledger_schema.sql
git commit -m "feat: add stock ledger schema"
```

---

### Task 2: Primitive atomiche di saldo e movimenti + RPC Admin

**Files:**
- Create: `magazzino-fnb-v1/supabase/migrations/20260915135500_stock_ledger_operations.sql`
- Modify: `magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql`

**Interfaces:**
- Consumes: tabelle Task 1, `private.current_user_is_admin()`.
- Produces: `private.ensure_stock_balance(uuid,uuid)`, `private.current_stock_unit_cost(uuid)`, `private.post_stock_movement(...)`, `private.reverse_stock_movement(...)`, `public.admin_adjust_stock(...)`, `public.admin_reverse_stock_movement(...)`.

- [ ] **Step 1: Estendere contract con firme e security**

Verificare tramite `pg_proc` che gli helper esistano nello schema `private`, che le RPC pubbliche esistano in `public`, e che `anon` non abbia `EXECUTE` sulle RPC Admin.

- [ ] **Step 2: Eseguire contract e confermare RED**

Expected: routine mancanti.

- [ ] **Step 3: Implementare `ensure_stock_balance` concorrente-sicuro**

Semantica obbligatoria:

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

Se la coppia store/articolo è incoerente, alzare `Invalid store/article relationship`.

- [ ] **Step 4: Implementare costo corrente senza inventare valori**

`private.current_stock_unit_cost(p_store_article_id uuid)` restituisce l'ultimo `unit_price_snapshot` di `purchase_price_history` con `source='RECEIPT'`, ordinato `recorded_at desc, id desc`. Se non esiste, restituisce `NULL`.

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

Comportamento:
- rifiuta zero e precisione oltre 3 decimali;
- su `operation_key` già presente restituisce l'id esistente solo se tutti i dati semantici coincidono, altrimenti errore `Movement operation key conflict`;
- chiama `ensure_stock_balance`, mantiene il lock, calcola `new_on_hand`;
- rifiuta `new_on_hand < 0` con `Stock would become negative`;
- rifiuta `new_on_hand < reserved` con `Reserved quantity exceeds resulting stock`;
- inserisce il movimento con `created_by = auth.uid()`;
- aggiorna `stock_balances.on_hand`, `updated_at`, `last_movement_id` nella stessa transazione;
- restituisce l'id del movimento.

- [ ] **Step 6: Implementare rettifica Admin**

RPC esatta:

```sql
public.admin_adjust_stock(
  p_store_article_id uuid,
  p_quantity_delta numeric,
  p_reason text,
  p_operation_key text
) returns uuid
```

Deriva `store_id` da `store_articles`, richiede `private.current_user_is_admin()`, motivo non vuoto, usa `movement_type='ADMIN_ADJUSTMENT'`, `source_type='ADMIN'` e `private.current_stock_unit_cost(...)`.

- [ ] **Step 7: Implementare reversal completo**

`private.reverse_stock_movement(p_movement_id uuid, p_reason text, p_operation_key text)`:
- locka il movimento originale;
- rifiuta originali `REVERSAL`;
- rifiuta se esiste già un movimento con `reversal_of_movement_id = original.id`;
- crea esattamente `-original.quantity_delta_base`;
- copia `unit_cost_snapshot`;
- usa `movement_type='REVERSAL'`, `source_type='REVERSAL'`, `reversal_of_movement_id=original.id`;
- delega a `post_stock_movement`, quindi eredita i controlli stock/reserved.

RPC pubblica:

```sql
public.admin_reverse_stock_movement(
  p_movement_id uuid,
  p_reason text,
  p_operation_key text
) returns uuid
```

Richiede Admin e motivo non vuoto.

- [ ] **Step 8: Grant minimi**

Revocare `PUBLIC/anon`; concedere `EXECUTE` delle sole RPC pubbliche ad `authenticated`. Gli helper `private` restano non esposti dal Data API; se `SECURITY INVOKER` richiede `EXECUTE` interno, concederlo esclusivamente ad `authenticated` nello schema privato già non esposto.

- [ ] **Step 9: Test DB mirato**

In una transazione con dati temporanei verificare:
- `+10` => on_hand 10;
- retry stessa operation key => un solo movimento;
- `-3` => on_hand 7;
- `-8` => errore e saldo resta 7;
- reversal del `-3` => on_hand 10 e record originale presente;
- secondo reversal => errore;
- reversal di reversal => errore;
- costo assente => `unit_cost_snapshot is null`.

Rollback finale.

- [ ] **Step 10: Commit**

```bash
git add magazzino-fnb-v1/supabase/migrations/20260915135500_stock_ledger_operations.sql magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql
git commit -m "feat: add atomic stock movement operations"
```

---

### Task 3: Primitive riserve e coerenza `reserved`

**Files:**
- Modify: `magazzino-fnb-v1/supabase/migrations/20260915135500_stock_ledger_operations.sql`
- Modify: `magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql`

**Interfaces:**
- Consumes: `private.ensure_stock_balance`, `private.post_stock_movement`.
- Produces: `private.open_stock_reservation(...)`, `private.release_stock_reservation(...)`, `private.consume_stock_reservation(...)` per moduli futuri; nessuna nuova RPC browser pubblica.

- [ ] **Step 1: Aggiungere contract RED delle tre primitive private**

Controllare nome/schema/firma in `pg_proc` e assenza di funzioni pubbliche generiche `post_stock_movement`, `open_stock_reservation`, `consume_stock_reservation`.

- [ ] **Step 2: Implementare apertura riserva**

Firma:

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

Lock saldo, idempotenza su operation key, `quantity > 0`, massimo 3 decimali, verifica `available >= quantity`, inserisce `OPEN`, incrementa `reserved` nella stessa transazione.

- [ ] **Step 3: Implementare release**

`private.release_stock_reservation(p_reservation_id uuid)` locka la riserva `OPEN` e il saldo, imposta `RELEASED`, `closed_at=now()`, `closed_by=auth.uid()`, decrementa `reserved`; una seconda chiusura fallisce con `Reservation already closed`. `on_hand` non cambia.

- [ ] **Step 4: Implementare consume atomico**

Firma:

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

Lock riserva e saldo; chiude `CONSUMED`, decrementa `reserved`, crea il movimento negativo della stessa quantità con `post_stock_movement` nella stessa transazione. Qualunque errore del movimento deve rollbackare anche la chiusura della riserva.

- [ ] **Step 5: Test transazionale riserve**

Verificare sequenza:
- on_hand 10;
- open 4 => reserved 4, available 6;
- open 7 => errore;
- release 4 => reserved 0, on_hand 10;
- seconda release => errore;
- open 3 + consume => reserved 0, on_hand 7, reservation CONSUMED, movimento -3;
- retry operation key apertura => nessun duplicato.

Rollback finale.

- [ ] **Step 6: Commit**

```bash
git add magazzino-fnb-v1/supabase/migrations/20260915135500_stock_ledger_operations.sql magazzino-fnb-v1/supabase/tests/stock_ledger_contract.sql
git commit -m "feat: add auditable stock reservations"
```

---

### Task 4: RLS, immutabilità e acceptance DB

**Files:**
- Modify: `magazzino-fnb-v1/supabase/migrations/20260915135500_stock_ledger_operations.sql`
- Create: `magazzino-fnb-v1/supabase/tests/stock_ledger_acceptance.sql`

**Interfaces:**
- Consumes: access helpers foundation + tutte le primitive Task 1-3.
- Produces: policy SELECT store-scoped, grant read-only, trigger/guard immutabilità ledger, acceptance riutilizzabile.

- [ ] **Step 1: Scrivere acceptance SQL prima delle policy**

Il file deve usare `BEGIN`/`ROLLBACK`, creare dati temporanei e verificare con eccezioni/assert SQL i 25 invarianti della spec che sono verificabili in questa fase.

- [ ] **Step 2: Implementare grant/RLS**

Concedere solo:

```sql
grant select on public.stock_movements to authenticated;
grant select on public.stock_balances to authenticated;
grant select on public.stock_reservations to authenticated;
```

Policy `SELECT` su ciascuna tabella:

```sql
using (private.current_user_has_store_access(store_id))
```

Nessuna policy `INSERT/UPDATE/DELETE` client.

- [ ] **Step 3: Rendere il ledger immutabile anche oltre i grant client**

Creare trigger `before update or delete` su `stock_movements` che alza `Stock movements are immutable`. L'unica correzione ammessa resta la creazione di un nuovo reversal.

- [ ] **Step 4: Testare RLS cross-store**

Nell'acceptance, temporaneamente simulare un profilo USER con membership Eccellenze e JWT claims; verificare che vede saldi/movimenti/riserve Eccellenze e non Nonna Titti. Simulare Admin e verificare entrambi. Ripristino automatico con rollback.

- [ ] **Step 5: Verificare invarianti di ricostruzione**

Per ogni `store_article` creato nel test:

```sql
select coalesce(sum(quantity_delta_base), 0)
from public.stock_movements
where store_article_id = v_store_article_id;
```

deve coincidere con `stock_balances.on_hand`; la somma delle `stock_reservations` `OPEN` deve coincidere con `reserved`; `available` deve coincidere con la differenza.

- [ ] **Step 6: Verificare scritture Data API negate**

Con ruolo `authenticated`, tentare insert/update/delete diretti sulle tre tabelle e verificare errore permission/RLS. Verificare che le RPC Admin falliscano per non-Admin.

- [ ] **Step 7: Verificare indici con Supabase Performance Advisor**

Correggere eventuali `unindexed_foreign_keys` introdotte dal modulo prima di chiudere il task. Non rimuovere indici solo perché inizialmente risultano `unused` su tabelle nuove.

- [ ] **Step 8: Commit**

```bash
git add magazzino-fnb-v1/supabase/migrations/20260915135500_stock_ledger_operations.sql magazzino-fnb-v1/supabase/tests/stock_ledger_acceptance.sql
git commit -m "test: enforce stock ledger security and invariants"
```

---

### Task 5: Dominio TypeScript e `StockGateway`

**Files:**
- Create: `magazzino-fnb-v1/src/stock/types.ts`
- Create: `magazzino-fnb-v1/src/stock/stockGateway.ts`
- Create: `magazzino-fnb-v1/src/stock/supabaseStockGateway.ts`
- Create: `magazzino-fnb-v1/src/stock/supabaseStockGateway.node.test.ts`
- Create: `magazzino-fnb-v1/src/stock/stockAcceptance.node.test.ts`

**Interfaces:**
- Consumes: RPC `admin_adjust_stock`, `admin_reverse_stock_movement`; SELECT RLS su stock tables; `formatQuantityForDb` dal catalogo.
- Produces: `StockGateway` usato da AppShell, CatalogWorkspace e Movimenti.

- [ ] **Step 1: Scrivere test Node RED per mapping e precisione**

Testare almeno `numericFromStockDb('0.375') === 0.375`, saldo assente normalizzato a zero dal consumer helper, costo nullo preservato e mapping dei messaggi DB.

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
  createdByName: string | null
  reversed: boolean
}
```

- [ ] **Step 3: Definire `StockGateway`**

```ts
export interface StockGateway {
  listBalances(storeId: string): Promise<StockBalance[]>
  getBalance(storeArticleId: string): Promise<StockBalance>
  listMovements(storeId: string, filters?: MovementFilters): Promise<StockMovement[]>
  listRecentMovements(storeArticleId: string, limit?: number): Promise<StockMovement[]>
  adjustStock(input: AdminAdjustmentInput): Promise<string>
  reverseMovement(input: ReverseMovementInput): Promise<string>
}
```

`getBalance` deve restituire `{onHand:0,reserved:0,available:0,currentUnitCost:null,currentValue:null}` quando la riga saldo non esiste.

- [ ] **Step 4: Implementare adapter Supabase**

Usare un piccolo `SupabaseLike` strutturale come già fatto nel catalog gateway; nessun `any`. Query movimenti con relazioni `store_articles -> articles` e `profiles` per nome utente. `reversed` deriva dalla presenza di movimenti con `reversal_of_movement_id` oppure da una query/lista coerente, non da stato mutabile sull'originale.

`currentUnitCost/currentValue`: usare esclusivamente ultimo storico prezzo `source='RECEIPT'`; se assente, entrambi `null`.

- [ ] **Step 5: Implementare RPC write mapping**

`adjustStock` invia quantità con `formatQuantityForDb`, motivo trim e operation key generata dal chiamante UI. `reverseMovement` invia movement id, motivo e operation key. Mappare messaggi DB:
- negative stock -> `L’operazione porterebbe la giacenza sotto zero.`
- reserved conflict -> `Disponibilità insufficiente.`
- operation conflict -> `Movimento già registrato.`
- already reversed -> `Movimento già stornato.`
- non reversible -> `Movimento non stornabile.`
- permission -> `Non hai i permessi per operare su questo store.`

- [ ] **Step 6: Eseguire test Node**

```bash
node --experimental-strip-types --test src/stock/supabaseStockGateway.node.test.ts src/stock/stockAcceptance.node.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add magazzino-fnb-v1/src/stock
git commit -m "feat: add stock domain gateway"
```

---

### Task 6: Integrare stock reale in Articoli

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
- Produces: lista Articoli con dati stock reali e dettaglio Magazzino.

- [ ] **Step 1: Aggiornare test Articoli RED**

Il vecchio test che proibiva la parola `Giacenza` va sostituito. Con saldo `{onHand:20,reserved:5,available:15}` la card deve mostrare `Fisico 20 PZ`, `Riservato 5`, `Disponibile 15`; con saldo mancante deve mostrare zero, mai valore inventato.

- [ ] **Step 2: Testare `StockSummary` RED**

Casi:
- saldo reale;
- `reserved=0` senza evidenza inutile;
- costo corrente null => `Valore non disponibile`;
- costo presente 1.25 e onHand 20 => valore 25.00 €.

- [ ] **Step 3: Caricare saldi store-first in `CatalogWorkspace`**

Aggiungere prop `stockGateway`. Nel caricamento lista usare:

```ts
Promise.all([
  gateway.listCategories(),
  gateway.listStoreArticles(storeId),
  stockGateway.listBalances(storeId),
])
```

Creare una `Map<string, StockBalance>` per `storeArticleId`; assenza => helper saldo zero.

- [ ] **Step 4: Integrare `ArticlesScreen`**

Aggiungere prop `stockByArticleId`. Visualizzare fisico/riservato/disponibile senza alterare minimo/obiettivo e dati fornitore. Nessun calcolo di riordino in questo task.

- [ ] **Step 5: Integrare dettaglio articolo**

`ArticleDetail` riceve `stockGateway`; aggiunge sezione Magazzino con `StockSummary` e ultimi 5 movimenti. Nessun pulsante generico “nuovo movimento”.

- [ ] **Step 6: Regression test catalogo**

```bash
npm run test:run -- ArticlesScreen ArticleDetail StockSummary
npm run test:bootstrap
```

Expected: tutti verdi; aggiornare solo le asserzioni che diventano obsolete perché ora il ledger esiste.

- [ ] **Step 7: Commit**

```bash
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
- Consumes: `StockGateway`, ActorAccess, active store id.
- Produces: voce Movimenti reale in Altro; storico store-first; Admin adjustment/reversal.

- [ ] **Step 1: Scrivere test UI RED**

Verificare:
- `Movimenti` è cliccabile da Altro;
- cambio store ricarica solo movimenti del nuovo store;
- ricerca articolo, filtro tipo e date cambiano i filtri passati al gateway;
- non-Admin non vede `Rettifica` né `Storna`;
- Admin vede `Rettifica`;
- motivo rettifica obbligatorio;
- storno disponibile solo per movimento non `REVERSAL` e non già stornato.

- [ ] **Step 2: Implementare `StockMovementsScreen`**

Props:

```ts
type StockMovementsScreenProps = {
  actor: ActorAccess
  storeId: string
  gateway: StockGateway
}
```

Lista mostra: articolo, tipo, data, quantità con segno/unità, autore, origine, costo/valore se noti, indicazione `Stornato` o `Storno di ...`.

- [ ] **Step 3: Implementare filtri**

UI mobile-first: input ricerca articolo, select `movementType`, `fromDate`, `toDate`. Il gateway applica filtri DB dove possibile; nessun accesso cross-store.

- [ ] **Step 4: Implementare rettifica Admin**

Form separato, non un “nuovo movimento” generico: selezione articolo tra gli articoli dello store, quantità delta firmata con massimo 3 decimali, motivo obbligatorio. Generare `operationKey` una sola volta per submit usando `crypto.randomUUID()` e conservarlo durante eventuale retry della stessa submission.

- [ ] **Step 5: Implementare storno Admin**

Dal dettaglio/riga movimento aprire conferma con motivo; chiamare `reverseMovement`. Dopo successo ricaricare elenco e saldo. Non offrire storno per `REVERSAL` o movimento già stornato.

- [ ] **Step 6: Wiring App**

`App.tsx` crea `createSupabaseStockGateway(supabase...)`. `AppShell` riceve `stockGateway`; `MoreTarget` diventa `'menu' | 'suppliers' | 'notifications' | 'movements'`. `MoreScreen` riceve `onOpenMovements` e sostituisce la card disabilitata con bottone reale.

- [ ] **Step 7: CSS e import**

Aggiungere `stock.css` con card, filtri, righe movimento e form responsive; non impostare branding diverso dal sistema esistente. Import in `main.tsx`.

- [ ] **Step 8: Test e build del task**

```bash
npm run test:run
npm run test:bootstrap
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add magazzino-fnb-v1/src/App.tsx magazzino-fnb-v1/src/app magazzino-fnb-v1/src/stock magazzino-fnb-v1/src/main.tsx
git commit -m "feat: add stock movements workspace"
```

---

### Task 8: Acceptance finale, advisor, documentazione e deploy

**Files:**
- Modify: `magazzino-fnb-v1/src/stock/stockAcceptance.node.test.ts`
- Modify: `magazzino-fnb-v1/supabase/tests/stock_ledger_acceptance.sql`
- Modify: `magazzino-fnb-v1/README.md`

**Interfaces:**
- Consumes: modulo completo Tasks 1-7.
- Produces: evidenza verificabile di completamento e branch pronto per review/merge.

- [ ] **Step 1: Completare acceptance Node anti-regressione**

Aggiungere controlli puri per:
- quantità `0,375`;
- saldo assente => zero;
- `available = onHand - reserved`;
- costo null preservato;
- nessun source production in `src/stock`, `src/catalog`, `src/app` contiene stock hardcoded di esempio o branding `RATIO`.

- [ ] **Step 2: Eseguire acceptance DB completa in outer transaction**

Il file `stock_ledger_acceptance.sql` deve creare categoria/articolo/store_article temporanei e verificare:
1. saldo = somma movimenti;
2. reserved = somma riserve OPEN;
3. available corretto;
4. stock negativo bloccato;
5. riserva > available bloccata;
6. idempotenza operation key;
7. ledger update/delete negati;
8. balance write diretto negato;
9. RLS cross-store;
10. Admin vede entrambi;
11. precisione 0,375;
12-15. reversal completo/una volta/non reversibile/non negativo;
16-18. chiusura riserva/release/consume atomico;
20-21. costo storico immutabile/null;
23. scritture critiche Data API negate;
24. saldo assente letto zero a livello adapter;
25. mismatch store/store_article rifiutato.

Il punto 19 (operazione inter-store futura) viene verificato a livello strutturale: le primitive private accettano store/articolo espliciti e possono essere chiamate nella stessa transazione PostgreSQL; nessuna RPC di prestito viene esposta in questo modulo.

- [ ] **Step 3: Verifica advisor**

Eseguire Security Advisor e Performance Advisor. Accettabile solo il warning Auth preesistente sulla leaked-password protection; nessun nuovo finding security del modulo stock e nessuna FK stock non indicizzata.

- [ ] **Step 4: Aggiornare README**

Spostare Movimenti + Giacenze in `Moduli disponibili` e documentare:
- ledger immutabile;
- `on_hand/reserved/available`;
- rettifica/storno Admin;
- RLS store-scoped;
- moduli successivi che consumeranno le primitive stock.

- [ ] **Step 5: Full verification**

```bash
npm install
npm run test:run
npm run test:bootstrap
npm run lint
npm run build
```

Expected: tutto verde.

- [ ] **Step 6: Verificare build Cloudflare sul commit finale**

Controllare GitHub check `Workers Builds: magazzino-fnb-v1`; non dichiarare completo finché GitHub build e Cloudflare non sono entrambi `success`.

- [ ] **Step 7: Review diff contro main**

Verificare che non siano presenti modifiche estranee, workflow CI temporanei, dati test, segreti o service-role key.

- [ ] **Step 8: Commit finale docs/acceptance**

```bash
git add magazzino-fnb-v1/README.md magazzino-fnb-v1/src/stock/stockAcceptance.node.test.ts magazzino-fnb-v1/supabase/tests/stock_ledger_acceptance.sql
git commit -m "docs: finalize stock ledger module"
```

- [ ] **Step 9: Handoff di integrazione**

Non fare merge automatico su `main`. Presentare all'utente le opzioni di finishing branch dopo evidenza fresca di test/build/Cloudflare verdi.
