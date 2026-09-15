# Inventari Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare inventario di apertura, inventario mensile cieco con riconteggi e conteggio straordinario con rettifica/anomalia, usando il ledger stock già in produzione.

**Architecture:** Il database resta autoritativo. Tabelle Inventari/Anomalie non sono scrivibili direttamente dal browser; RPC dedicate applicano ruoli, idempotenza, snapshot e transazioni. Le letture sensibili passano da RPC che omettono teorico/delta/storico quando il ruolo non può vederli. I movimenti stock vengono creati esclusivamente tramite la primitiva privata stock già esistente.

**Tech Stack:** PostgreSQL/Supabase, React 19, TypeScript 6, Supabase JS 2.116, Vitest 5, Node test runner, Vite 8/PWA, Cloudflare Workers Static Assets.

**Spec:** `docs/superpowers/specs/2026-09-15-inventari-design.md`

## Global Constraints

- Zero cancellazioni fisiche di dati business.
- Nessuna modifica diretta di `stock_balances`.
- Quantità stock con massimo 3 decimali.
- Stock negativo e `reserved > on_hand` vietati.
- Magazziniere cieco su teorico/delta/valori durante apertura, mensile e riconteggio.
- Admin vede sempre il teorico; Responsabile/Vice solo dalla fase `IN_REVIEW`.
- Tutti i round inviati restano immutabili.
- Un retry non deve duplicare movimenti, notifiche o anomalie.
- Store isolati via DB, non solo UI.
- Valore differenza e snapshot costi solo da ultimo prezzo `RECEIPT`; assenza prezzo = `NULL`.
- Nessun trasporto Web Push in questo piano; vengono creati gli eventi/notifiche persistenti autorevoli.
- Nessuna modifica delle migration già applicate.

---

## Task map

1. Schema Inventari/Anomalie e contratto DB.
2. Helper privati, ruoli e letture cieche.
3. Start/save/submit/accept/recount.
4. Approve/close OPENING e MONTHLY.
5. Extraordinary + motore anomalie + notifiche.
6. Security hardening, RLS, indici, acceptance DB/advisor.
7. Dominio TypeScript + Supabase InventoryGateway.
8. UI apertura/mensile blind/review.
9. UI straordinario/anomalie + notifiche generiche.
10. App wiring, full verification, PR, review e merge.

---

### Task 1: Schema Inventari e Anomalie

**Files:**
- Create `magazzino-fnb-v1/supabase/migrations/20260915211000_inventory_schema.sql`
- Create `magazzino-fnb-v1/supabase/tests/inventory_contract.sql`

**Produces:** enum `inventory_type`, `inventory_status`, `inventory_review_state`, `inventory_reason`, `stock_anomaly_origin`, `stock_anomaly_status`; tabelle `inventory_sessions`, `inventory_lines`, `inventory_counts`, `inventory_operations`, `stock_anomalies`.

- [ ] Scrivere prima il contract RED: relazioni mancanti e direct critical DML non consentito.
- [ ] Creare enum inventory: `OPENING|MONTHLY|EXTRAORDINARY`, stati `IN_PROGRESS|IN_REVIEW|RECOUNT|APPROVED|CLOSED`, review `PENDING|ACCEPTED|RECOUNT_REQUIRED`, motivi approvati dalla spec.
- [ ] Estendere `notification_type` con `INVENTORY_REVIEW_REQUIRED`, `INVENTORY_RECOUNT_REQUIRED`, `EXTRAORDINARY_ADJUSTMENT_REVIEW_REQUIRED`.
- [ ] Creare sessioni con store, type/status, snapshot_at, actor/timestamp lifecycle, operation_key unique.
- [ ] Creare righe con composite store_article/store FK, snapshot qty, name/unit snapshot, review state/current round.
- [ ] Creare counts con unique `(inventory_line_id,round_number)`, qty >=0 scale 3, counted_at/by, reason/note, submitted_at nullable.
- [ ] Creare `inventory_operations` con operation_key PK per idempotenza delle azioni di stato.
- [ ] Creare `stock_anomalies` con store/article integrity, origin, source refs, movement, difference, preliminary/final reason, status e resolution metadata.
- [ ] Enable RLS e revoke direct access iniziale a `anon, authenticated`.
- [ ] Run contract: atteso schema presente, critical writes false.
- [ ] Commit `feat: add inventory and anomaly schema`.

### Task 2: Helper privati e letture cieche

**Files:**
- Create `magazzino-fnb-v1/supabase/migrations/20260915211100_inventory_core_operations.sql`
- Extend `inventory_contract.sql`

**Produces:**
- `private.inventory_store_role(uuid)`
- `private.inventory_can_supervise(uuid)`
- `private.inventory_can_count(uuid)`
- `private.inventory_theoretical_at(uuid,timestamptz)`
- `private.inventory_claim_operation(...)`
- public read RPC `inventory_list_sessions`, `inventory_get_session`, `inventory_list_session_anomalies`.

- [ ] RED: private helper non eseguibile da authenticated; public read RPC assente.
- [ ] Implementare supervisore = ADMIN o RESP/Vice attivo sullo store; count = ADMIN o qualsiasi membership attiva.
- [ ] `inventory_theoretical_at`: snapshot_on_hand + somma ledger dopo snapshot e fino a counted_at.
- [ ] `inventory_get_session` costruisce JSON server-side in base al ruolo: MAGAZZINIERE non riceve mai teorico/delta/valore/round precedenti durante OPENING/MONTHLY `IN_PROGRESS` o `RECOUNT`; RESP/Vice li vedono da `IN_REVIEW`; ADMIN sempre.
- [ ] Nessun raw SELECT di `inventory_lines`/`inventory_counts` a authenticated.
- [ ] Revoke EXECUTE dei private helper a public/anon/authenticated; grant solo RPC pubbliche.
- [ ] Commit `feat: add secure inventory read model`.
