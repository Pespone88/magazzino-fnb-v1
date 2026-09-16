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

**Files:** `supabase/migrations/20260915211000_inventory_schema.sql`, `supabase/tests/inventory_contract.sql`.

**Produces:** enum `inventory_type`, `inventory_status`, `inventory_review_state`, `inventory_reason`, `stock_anomaly_origin`, `stock_anomaly_status`; tabelle `inventory_sessions`, `inventory_lines`, `inventory_counts`, `inventory_operations`, `stock_anomalies`.

- [ ] Scrivere prima contract RED: relazioni assenti e critical direct DML non consentito.
- [ ] Creare enum inventory e i sei motivi approvati; estendere `notification_type` con review/recount/extraordinary.
- [ ] Creare sessioni con store/type/status/snapshot lifecycle e `operation_key` unique; una sola OPENING per store e una sola OPENING/MONTHLY non chiusa per store.
- [ ] Creare righe con composite store_article/store FK, snapshot qty/name/unit, review state/current round.
- [ ] Creare counts unique `(inventory_line_id,round_number)`, qty >=0 scale 3, counted_at/by, reason/note, `submitted_at` nullable.
- [ ] Creare `inventory_operations(operation_key PK, action, session_id, anomaly_id, actor_id, result_id, created_at)`.
- [ ] Creare `stock_anomalies` con origin/source/movement/difference/reasons/status/resolution metadata.
- [ ] Enable RLS e revoke raw access a `anon, authenticated`.
- [ ] Run contract e commit `feat: add inventory and anomaly schema`.

### Task 2: Helper privati e letture cieche

**Files:** `supabase/migrations/20260915211100_inventory_core_operations.sql`, `inventory_contract.sql`.

**Produces:** `private.inventory_store_role`, `inventory_can_supervise`, `inventory_can_count`, `inventory_theoretical_at`, `inventory_claim_operation`; read RPC `inventory_list_sessions`, `inventory_get_session`, `inventory_list_session_anomalies`.

- [ ] RED: helper privato non callable; public read RPC assente.
- [ ] Supervisore = ADMIN o RESP/Vice attivo; count = ADMIN o membership attiva.
- [ ] `inventory_theoretical_at` = snapshot_on_hand + ledger dopo snapshot fino a counted_at.
- [ ] `inventory_get_session` costruisce JSON role-shaped: MAGAZZINIERE non riceve teorico/delta/valore/round precedenti durante blind count/recount; RESP/Vice da IN_REVIEW; ADMIN sempre.
- [ ] Nessun raw SELECT di lines/counts a authenticated.
- [ ] Revoke EXECUTE private; grant public read RPC authenticated; commit `feat: add secure inventory read model`.

### Task 3: Start, draft count, submit, accept, recount

**Files:** extend core migration; create/extend `supabase/tests/inventory_acceptance.sql`.

**RPC:** `inventory_start(uuid,inventory_type,uuid[],text)`, `inventory_save_count(uuid,uuid,numeric,inventory_reason,text)`, `inventory_submit_round(uuid,text)`, `inventory_accept_lines(uuid,uuid[],text)`, `inventory_request_recount(uuid,uuid[],text)`.

- [ ] RED acceptance: active-only snapshot, cross-store rejection, `0.375`, draft update allowed, submitted update denied, accept subset, recount keeps prior round.
- [ ] `inventory_start`: OPENING/MONTHLY supervisor + all active store articles; EXTRAORDINARY any count role + nonempty selected IDs; absent balance = zero; operation-key retry returns same session.
- [ ] `inventory_save_count`: validate current state/round; INSERT first draft or UPDATE own unsubmitted current-round draft; refresh counted_at; max 3 decimals.
- [ ] `inventory_submit_round`: require all required lines counted; stamp current counts submitted; session -> IN_REVIEW; idempotent operation row.
- [ ] On submit create one `INVENTORY_REVIEW_REQUIRED` notification for each active ADMIN and store RESP/Vice, deduped.
- [ ] `accept_lines`: supervisor, IN_REVIEW, only submitted current counts -> ACCEPTED.
- [ ] `request_recount`: supervisor, selected nonempty; selected current_round +1, state RECOUNT_REQUIRED, session -> RECOUNT; notify active MAGAZZINIERI once.
- [ ] Commit `feat: add blind inventory workflow`.

### Task 4: Approve and close OPENING/MONTHLY

**Files:** `supabase/migrations/20260915211200_inventory_stock_operations.sql`, acceptance SQL.

**RPC:** `inventory_approve(uuid,text)`, `inventory_close(uuid,text)`.

- [ ] RED OPENING: accepted 2/0/0.375 creates two positive OPENING_STOCK rows, zero creates none, retry no duplicate, second opening rejected, pre-existing movement blocks approval.
- [ ] RED MONTHLY timing: snapshot 10, count 8, later legitimate +5, approve -> final 13 and exactly -2 INVENTORY_ADJUSTMENT; zero delta creates none.
- [ ] Approve requires all lines ACCEPTED + submitted latest count; all writes one transaction.
- [ ] OPENING checks no prior store movements before loop; movement source OPENING/session/line and deterministic key.
- [ ] MONTHLY computes `delta = counted - theoretical_at(counted_at)`; movement uses INVENTORY source and `private.current_stock_unit_cost`; NULL cost stays NULL.
- [ ] Let stock primitive reject negative/reservation conflict; session changes to APPROVED only after all movements succeed.
- [ ] `inventory_close`: supervisor + APPROVED only, idempotent, no stock effect, -> CLOSED.
- [ ] Commit `feat: approve inventory into stock ledger`.

### Task 5: Extraordinary counts and anomaly engine

**Files:** extend stock operations migration + acceptance SQL.

**RPC:** `inventory_confirm_extraordinary`, `anomaly_start_review`, `anomaly_resolve`, `anomaly_close_unknown`.

- [ ] RED: compliant line => no movement/anomaly; differing line => EXTRAORDINARY_ADJUSTMENT + TO_VERIFY anomaly; multi-line rollback if one invariant fails; reason required on diff; OTHER requires note; retry no duplicates.
- [ ] Extraordinary delta uses latest draft `counted_at`: compute discrepancy at physical count time, then apply that delta to current locked balance, preserving later legitimate movements.
- [ ] Lock balances in deterministic store_article order; whole session one transaction; stamp counts submitted and session CLOSED only after success.
- [ ] If anomalies created, notify ADMIN + store RESP/Vice once with `EXTRAORDINARY_ADJUSTMENT_REVIEW_REQUIRED`.
- [ ] Anomaly workflow: TO_VERIFY->IN_REVIEW; resolve requires final reason + nonblank action note; close unknown forces UNKNOWN; only supervisors mutate.
- [ ] Commit `feat: add extraordinary counts and anomalies`.

### Task 6: Security, indexes, live DB acceptance

**Files:** `supabase/migrations/20260915211300_inventory_security_indexes.sql`, final contract/acceptance.

- [ ] Revoke authenticated DML on all inventory/anomaly tables and SELECT on sensitive raw lines/counts; use read RPC only.
- [ ] Every public RPC: anon revoked, authenticated granted; every private inventory helper public/anon/authenticated revoked.
- [ ] SECURITY DEFINER only where required, always `search_path=''` + explicit auth/store/role checks.
- [ ] Add indexes for session store/status/date; line session/store_article; count line/round/counted_by; operations refs; anomaly store/status/date/article/movement/actors.
- [ ] Run transactional acceptance with rollback: isolation, blind shaping, roles, 0.375, immutability, recount, opening, monthly timing, extraordinary, anomalies, idempotency, direct privilege denial.
- [ ] Run Security Advisor: no new private-helper/RLS issues; document only intentional public RPC warning if any.
- [ ] Run Performance Advisor: fix all new unindexed FKs; do not remove fresh indexes just because unused.
- [ ] Commit `fix: harden inventory database access`.

### Task 7: TypeScript domain + InventoryGateway

**Files:** `src/inventory/types.ts`, `validation.ts`, `validation.node.test.ts`, `inventoryGateway.ts`, `supabaseInventoryGateway.ts`, `supabaseInventoryGateway.node.test.ts`.

**Types:** InventoryType/Status/Reason/ReviewState, session summary/detail, line/count, anomaly. **Gateway methods:** list/get/start/save/submit/accept/recount/approve/close/confirmExtraordinary/listAnomalies/startReview/resolve/closeUnknown.

- [ ] RED validation: comma/dot `0,375`, zero count allowed, signed negative rejected, >3 decimals rejected, OTHER requires note.
- [ ] Implement exact decimal serialization without silent rounding.
- [ ] RED gateway fake-client tests for exact RPC names/args, JSON mapping and no invention of hidden theoretical fields.
- [ ] Map DB errors to functional messages: state conflict, missing count, unaccepted lines, reservation conflict, reason/note, permission, serialization/deadlock.
- [ ] Commit `feat: add inventory domain gateway`.

### Task 8: UI apertura/mensile

**Files:** `InventoryWorkspace.tsx`, `InventoryListScreen.tsx`, `InventoryCountScreen.tsx`, `InventoryReviewScreen.tsx`, `inventory.css`, tests.

- [ ] RED list: open first/history below; ADMIN/RESP/VICE can start OPENING/MONTHLY; MAGAZZINIERE cannot; extraordinary visible to count roles.
- [ ] Implement store-first workspace; no bottom-nav change.
- [ ] RED blind UI: MAGAZZINIERE fixture must not render theoretical/delta/value/previous count; recount only requested rows.
- [ ] Implement draft save/progress/submit; one stable operation key per click retry cycle.
- [ ] RED review: supervisor sees theoretical/count/delta/value/history; accept/recount; approve disabled until all ACCEPTED; APPROVED exposes Close.
- [ ] Implement review from server-computed values only; no authoritative delta client-side.
- [ ] Commit `feat: add opening and monthly inventory UI`.

### Task 9: Extraordinary UI, anomaly panel, generic notifications

**Files:** `ExtraordinaryCountScreen.tsx`, `AnomalyPanel.tsx`, tests; modify catalog notification types/adapter/panel only as needed.

- [ ] RED extraordinary UI: multi-select, physical qty, difference reason, OTHER note, confirm, anomaly result.
- [ ] Use existing CatalogGateway only for store article labels; DB inventory RPC stays authoritative.
- [ ] RED anomaly UI: MAGAZZINIERE read-only; supervisor start review/resolve/close unknown; resolve validation.
- [ ] Implement refresh after state transitions.
- [ ] Rename `PriceNotification` to generic `AppNotification`; preserve PRICE_CHANGE and allow new inventory types; panel stays title/body/severity driven.
- [ ] Commit `feat: add extraordinary inventory and anomaly UI`.

### Task 10: Wiring, verification, PR and merge

**Files:** modify `src/App.tsx`, `src/app/AppShell.tsx`, `src/app/MoreScreen.tsx`, related tests, README.

- [ ] RED AppShell: Inventari card enabled, opens workspace for active store, store change resets workspace.
- [ ] Instantiate `createSupabaseInventoryGateway(...)`, pass to AppShell, add `inventories` MoreTarget and render InventoryWorkspace.
- [ ] Run `npm install`, `npm run test:run`, `npm run test:bootstrap`, `npm run lint`, `npm run build`; all exit 0 and npm audit 0 vulnerabilities.
- [ ] Re-run DB acceptance/advisors after final migrations.
- [ ] Self-review all 35 spec invariants, especially blind leakage, private RPC execute grants, idempotency and delta-at-count.
- [ ] Create implementation branch `feature/inventari` from main, preserving design commits, then PR `feat: inventari e conteggi straordinari`.
- [ ] Pre-merge code/security review; any DB correction is a new migration; rerun full CI.
- [ ] Merge only green; verify post-merge GitHub Actions on merge SHA.
- [ ] Verify Cloudflare production deploy only if accessible; otherwise mark deployment unverified instead of assuming success.
