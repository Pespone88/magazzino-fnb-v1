# Inventari — Design

Data: 2026-09-15

## Stato e relazione con la progettazione esistente

Questo documento è una specifica tecnica delta del modulo Inventari. Non ridefinisce il funzionale V1 già approvato in `Specifica_Funzionale_Magazzini_FnB_V1.docx` né il sottosistema stock già integrato in `main`.

Restano invariati:

- due store operativamente isolati;
- Eccellenze della Costiera usa un solo magazzino logico;
- nessuna giacenza del punto vendita;
- nessuna modifica diretta di `stock_balances`;
- ogni variazione fisica passa dal ledger `stock_movements`;
- quantità base con massimo 3 decimali;
- stock negativo vietato;
- storico immutabile e zero cancellazioni fisiche;
- inventario mensile cieco per il magazziniere;
- Admin vede sempre il teorico; Responsabile/Vice lo vedono solo in verifica;
- tutti i conteggi e riconteggi restano nello storico;
- conteggio straordinario con riallineamento immediato e anomalia quando esiste differenza;
- notifiche persistenti per gli eventi operativi importanti;
- nessun dato economico aggregato fra i due store.

## Obiettivo

Implementare un unico sottosistema Inventari con tre modalità che condividono snapshot, righe, conteggi e audit:

1. **Inventario di apertura** — giorno zero, conteggio completo e generazione dello stock iniziale ufficiale tramite `OPENING_STOCK`.
2. **Inventario mensile** — conteggio completo cieco, verifica, eventuali riconteggi, approvazione e rettifiche `INVENTORY_ADJUSTMENT`.
3. **Conteggio straordinario** — una o più referenze, confronto immediato, `EXTRAORDINARY_ADJUSTMENT` e apertura anomalia quando il fisico differisce dal teorico.

Il modulo non implementa ordini, ricezioni, rifornimenti o prestiti; usa però le primitive stock esistenti e prepara un motore anomalie riutilizzabile da quei flussi futuri.

## Approccio scelto

### Snapshot + delta al momento del conteggio

Il conteggio non blocca il magazzino per ore e non richiede di sospendere altri flussi.

Ogni riga inventario salva uno snapshot teorico all'apertura della sessione. Ogni singolo conteggio salva anche `counted_at`. La differenza contabile del conteggio viene determinata rispetto al teorico effettivo **al momento del conteggio**:

`theoretical_at_count = snapshot_on_hand + somma movimenti ledger successivi allo snapshot e fino a counted_at`

`count_delta = counted_quantity - theoretical_at_count`

In questo modo una ricezione o un altro movimento legittimo avvenuto dopo il conteggio non viene cancellato dall'approvazione dell'inventario. Alla fase di approvazione si registra il `count_delta`, non si forza il saldo corrente al numero contato ore prima.

Per il conteggio straordinario il calcolo e il movimento avvengono nella stessa transazione e quindi il teorico viene letto/lockato direttamente al momento della conferma.

### Perché non bloccare tutti i movimenti

Un lock operativo dell'intero store renderebbe fragile la V1 e introdurrebbe un nuovo vincolo organizzativo non previsto dalla specifica funzionale. Il modello snapshot + ledger conserva invece la correttezza contabile senza modificare i flussi già approvati.

## Modello dati

### `inventory_sessions`

Una pratica inventariale per store.

Campi principali:

- `id`
- `store_id`
- `inventory_type`: `OPENING`, `MONTHLY`, `EXTRAORDINARY`
- `status`
- `snapshot_at`
- `started_at`, `started_by`
- `submitted_at`, `submitted_by` nullable
- `approved_at`, `approved_by` nullable
- `closed_at`, `closed_by` nullable
- `operation_key`
- `created_at`

Stati per `OPENING` e `MONTHLY`:

- `IN_PROGRESS`
- `IN_REVIEW`
- `RECOUNT`
- `APPROVED`
- `CLOSED`

Per `EXTRAORDINARY` sono usati solo `IN_PROGRESS` e `CLOSED`; la conferma è immediata e non passa per approvazione separata.

Regole:

- un solo inventario `OPENING` può essere chiuso per store;
- un inventario di apertura può essere approvato solo se non esistono movimenti stock reali precedenti per lo store; se esistono, la pratica resta bloccata finché la situazione non viene corretta tramite flussi tracciati;
- non possono esistere contemporaneamente due sessioni `OPENING`/`MONTHLY` non chiuse nello stesso store;
- più conteggi straordinari possono esistere nel tempo, ma ogni conferma è atomica;
- nessuna sessione viene cancellata fisicamente.

### `inventory_lines`

Snapshot delle referenze interessate dalla sessione.

Campi principali:

- `id`
- `session_id`
- `store_id`
- `store_article_id`
- `article_name_snapshot`
- `base_unit_snapshot`
- `snapshot_on_hand`
- `snapshot_reserved`
- `review_state`: `PENDING`, `ACCEPTED`, `RECOUNT_REQUIRED`
- `current_round`
- `created_at`

Regole:

- apertura e mensile includono tutte le `store_articles` attive dello store al momento dell'avvio;
- straordinario include solo le referenze selezionate;
- l'associazione sessione/store/articolo è immutabile;
- nome e unità vengono congelati per conservare lo storico anche se l'anagrafica cambia in futuro.

### `inventory_counts`

Registro storico dei conteggi e riconteggi.

Campi principali:

- `id`
- `session_id`
- `inventory_line_id`
- `round_number`
- `counted_quantity`
- `counted_at`
- `counted_by`
- `preliminary_reason` nullable
- `note` nullable
- `submitted_at` nullable

Regole:

- quantità >= 0, massimo 3 decimali;
- una riga ha al massimo un conteggio per round;
- finché il round è ancora `IN_PROGRESS` o `RECOUNT` e il conteggio non è stato inviato, l'autore può correggere la propria quantità bozza per quel round;
- `Invia in verifica` valorizza `submitted_at` e da quel momento il record del round è immutabile;
- un nuovo round non sovrascrive il precedente;
- il magazziniere non può leggere conteggi di round precedenti durante `IN_PROGRESS` o `RECOUNT`;
- Admin può leggere sempre tutto;
- Responsabile/Vice leggono teorico, differenze e storico dei conteggi solo da `IN_REVIEW` in poi;
- per un conteggio straordinario con differenza non zero `preliminary_reason` è obbligatorio.

Motivi preliminari approvati:

- `PREVIOUS_ERROR` — Errore precedente
- `MISSING_MOVEMENT` — Movimento non registrato
- `UNRECORDED_WASTE` — Scarto/rottura non registrato
- `PREVIOUS_INVENTORY_ERROR` — Errore inventariale precedente
- `UNKNOWN` — Causa sconosciuta
- `OTHER` — Altro

Per `OTHER` è richiesta una nota descrittiva.

## Flusso inventario di apertura

1. Admin/Responsabile/Vice crea la sessione `OPENING` dello store.
2. Il DB fotografa tutte le referenze attive e verifica che lo store non abbia già uno stock storico operativo.
3. Il magazziniere inserisce le quantità fisiche senza vedere teorico, valori economici o conteggi precedenti.
4. `Invia in verifica` rende il round immutabile e porta la sessione in `IN_REVIEW`.
5. Admin/Responsabile/Vice può accettare le righe o chiedere riconteggi mirati.
6. Un riconteggio crea un nuovo round solo per le righe marcate `RECOUNT_REQUIRED`; il magazziniere non vede il conteggio precedente.
7. Quando tutte le righe sono accettate, `Approva` genera un movimento `OPENING_STOCK` positivo per ogni quantità > 0, con `source_type = OPENING`, riferimenti alla sessione/riga e `operation_key` deterministica.
8. La sessione passa a `APPROVED`.
9. `Chiudi` archivia la pratica in `CLOSED`; dopo l'approvazione i conteggi non possono più cambiare.

Le quantità zero restano nello storico inventario ma non generano movimenti ledger a quantità zero.

## Flusso inventario mensile

1. Admin/Responsabile/Vice avvia `MONTHLY`.
2. Il DB crea snapshot di tutte le referenze attive.
3. Il magazziniere conta alla cieca.
4. L'invio porta il round in `IN_REVIEW` e genera la notifica persistente `INVENTORY_REVIEW_REQUIRED` agli utenti di supervisione autorizzati dello store.
5. Il revisore vede teorico al momento di ciascun conteggio, quantità contata, delta e valore economico della differenza quando esiste un ultimo prezzo di acquisto attendibile.
6. Il revisore accetta la riga oppure richiede riconteggio; la richiesta porta la sessione a `RECOUNT` e genera `INVENTORY_RECOUNT_REQUIRED` al/ai magazzinieri dello store.
7. Il magazziniere inserisce il nuovo round solo per le righe richieste e lo rinvia in verifica.
8. Quando tutte le righe sono accettate, `Approva` registra `INVENTORY_ADJUSTMENT` per le sole righe con delta diverso da zero.
9. Ogni movimento usa il costo corrente attendibile disponibile al momento dell'approvazione; se manca resta `NULL`, mai 0 inventato.
10. La sessione passa a `APPROVED`, poi può essere chiusa in `CLOSED`.

### Movimenti avvenuti durante il conteggio

La differenza di ogni round viene calcolata al timestamp del conteggio usando il ledger. L'approvazione applica esattamente quella differenza al saldo corrente, preservando tutti i movimenti legittimi avvenuti successivamente al conteggio.

Se il delta negativo violerebbe una riserva aperta (`reserved > resulting on_hand`) o produrrebbe stock negativo, l'approvazione è bloccata dalla primitiva stock esistente. La sessione resta `IN_REVIEW`; l'utente deve prima risolvere il flusso operativo che mantiene la riserva. Nessun bypass inventariale è ammesso.

## Riconteggio

- Admin/Responsabile/Vice seleziona una o più righe da riconteggiare.
- Il sistema incrementa `current_round` per quelle righe e imposta `RECOUNT_REQUIRED`.
- Il magazziniere vede solo le righe richieste e campi di inserimento vuoti.
- Non vede teorico, delta, valore, quantità del round precedente o motivo per cui il revisore sospetta una differenza.
- Il nuovo conteggio resta accodato allo storico; nessun record precedente viene aggiornato o cancellato.
- Dopo l'invio del riconteggio la sessione torna `IN_REVIEW`.

## Conteggio straordinario

Il conteggio straordinario è un controllo operativo rapido e non usa il workflow di verifica mensile.

1. Magazziniere, Responsabile, Vice o Admin seleziona una o più referenze del proprio store.
2. Inserisce quantità fisica e, per ogni differenza rilevata, un motivo preliminare.
3. La conferma avviene in una singola transazione database per tutte le righe della sessione.
4. Per ogni riga il DB blocca il saldo, legge `on_hand`, calcola `delta = fisico - teorico` e registra `EXTRAORDINARY_ADJUSTMENT` se delta != 0.
5. Per ogni delta != 0 crea una `stock_anomaly` collegata alla sessione, alla riga e al movimento generato.
6. La sessione viene chiusa.
7. Gli utenti di supervisione autorizzati dello store ricevono notifica persistente `EXTRAORDINARY_ADJUSTMENT_REVIEW_REQUIRED`.

Se una singola riga fallisce un vincolo di stock, l'intera conferma straordinaria viene rollbackata: non devono esistere sessioni parzialmente applicate.

## Motore anomalie minimo riutilizzabile

### `stock_anomalies`

Campi principali:

- `id`
- `store_id`
- `store_article_id`
- `origin_type`
- `source_id`
- `source_line_id`
- `movement_id` nullable
- `quantity_difference` nullable
- `preliminary_reason`
- `final_reason` nullable
- `status`
- `resolution_note` nullable
- `created_at`, `created_by`
- `updated_at`, `updated_by`
- `resolved_at` nullable

Origini previste dall'architettura V1:

- `EXTRAORDINARY_COUNT`
- `STORE_SUPPLY_DISCREPANCY`
- `INTERSTORE_DISCREPANCY`
- `STORE_RETURN_DISCREPANCY`
- `OPERATING_ERROR`

Nella prima implementazione Inventari viene creata automaticamente solo `EXTRAORDINARY_COUNT`; le altre origini restano predisposte per i relativi moduli futuri.

Stati già approvati:

- `TO_VERIFY` — DA VERIFICARE
- `IN_REVIEW` — IN VERIFICA
- `RESOLVED` — RISOLTA
- `CLOSED_UNKNOWN` — CHIUSA — CAUSA NON DETERMINATA

Regole:

- nessuna cancellazione;
- `TO_VERIFY` è lo stato iniziale;
- Admin/Responsabile/Vice dello store possono portare l'anomalia in verifica e chiuderla;
- `RESOLVED` richiede causa finale e nota con causa/azione;
- `CLOSED_UNKNOWN` conserva esplicitamente `UNKNOWN` come causa finale e può avere nota di indagine;
- il magazziniere legge le anomalie generate dalla propria operatività nello store ma non le chiude;
- le anomalie fornitore restano entità separate e non vengono modellate qui.

## Notifiche

L'enum `notification_type` viene esteso almeno con:

- `INVENTORY_REVIEW_REQUIRED`
- `INVENTORY_RECOUNT_REQUIRED`
- `EXTRAORDINARY_ADJUSTMENT_REVIEW_REQUIRED`

Le notifiche persistenti vengono create nella stessa transazione dell'evento di business che le origina.

Destinatari:

- invio in verifica: Admin + Responsabile/Vice autorizzati allo store;
- riconteggio richiesto: Magazzinieri attivi dello store;
- rettifica straordinaria: Admin + Responsabile/Vice autorizzati allo store, evitando duplicati.

La lettura della notifica non modifica lo stato della pratica sottostante.

Il trasporto Web Push è cross-cutting: questo modulo produce l'evento persistente autorevole che il trasporto push può consegnare. Nessun effetto inventariale dipende dalla riuscita del push; un errore di consegna non deve rollbackare conteggi o stock.

## Sicurezza e permessi

### Admin

- entrambi gli store;
- crea apertura/mensile/straordinario;
- vede teorico e valori sempre;
- verifica, richiede riconteggio, approva e chiude;
- gestisce anomalie.

### Responsabile/Vice

- solo store assegnati;
- crea apertura/mensile/straordinario;
- durante il conteggio mensile non usa il teorico come schermata di conteggio;
- da `IN_REVIEW` vede teorico/differenze/valori;
- verifica, richiede riconteggio, approva e chiude;
- gestisce anomalie dello store.

### Magazziniere

- solo store assegnato;
- conta apertura/mensile alla cieca;
- esegue i riconteggi senza teorico né conteggi precedenti;
- può creare/confermare conteggi straordinari;
- non approva o chiude inventari apertura/mensili;
- non chiude anomalie;
- nessuna scrittura diretta alle tabelle: tutte le mutazioni passano da RPC dedicate.

## Primitive DB / RPC

Le primitive generiche stock restano in schema `private` e non sono eseguibili direttamente dal browser.

RPC pubbliche previste, tutte con controllo esplicito ruolo/store e grant minimo:

- `inventory_start(store_id, inventory_type, selected_store_article_ids, operation_key)`
- `inventory_save_count(session_id, line_id, quantity, preliminary_reason, note)`
- `inventory_submit_round(session_id, operation_key)`
- `inventory_request_recount(session_id, line_ids, operation_key)`
- `inventory_accept_lines(session_id, line_ids, operation_key)`
- `inventory_approve(session_id, operation_key)`
- `inventory_close(session_id, operation_key)`
- `inventory_confirm_extraordinary(session_id, operation_key)`
- `anomaly_start_review(anomaly_id, operation_key)`
- `anomaly_resolve(anomaly_id, final_reason, resolution_note, operation_key)`
- `anomaly_close_unknown(anomaly_id, resolution_note, operation_key)`

Le RPC di business possono essere `SECURITY DEFINER` solo quando necessario per richiamare primitive private, con `search_path = ''`, controllo di `auth.uid()`, ruolo/store e revoche esplicite alle funzioni private.

## Idempotenza e concorrenza

- ogni azione di stato significativa usa `operation_key` univoca/deterministica;
- retry della stessa azione restituisce lo stesso esito senza duplicare movimenti, notifiche o anomalie;
- approvazione inventario e conferma straordinaria bloccano le righe `stock_balances` interessate prima di postare i delta;
- tutte le righe di una conferma straordinaria sono una sola transazione;
- l'approvazione mensile/apertura è una sola transazione per la sessione: o tutti i movimenti necessari sono registrati oppure nessuno;
- la sessione cambia stato solo dopo il successo dei movimenti;
- i movimenti usano operation key derivate da sessione + line + round/azione, così un retry non può duplicarli.

## Valorizzazione differenze

Durante la verifica:

- quantità teorica al conteggio e delta sono calcolati dal ledger;
- valore differenza = `abs(delta) × ultimo unit price da purchase_price_history source=RECEIPT`;
- se non esiste un prezzo di ricezione attendibile, il valore è `NULL`/“Costo non disponibile”;
- nessun costo manuale viene inventato per rendere completo il report.

Il movimento generato conserva `unit_cost_snapshot` disponibile al momento dell'approvazione/conferma.

## UI

La navigazione mobile già approvata resta invariata. La card `Inventari` in `Altro` diventa attiva; non viene riaperto il layout della bottom navigation.

### Lista Inventari

Store-first, con:

- inventari aperti in alto;
- tipo, stato, data avvio, autore;
- numero righe conteggiate / totali;
- badge riconteggi richiesti;
- storico chiuso sotto;
- azione `Nuovo inventario` visibile ai ruoli autorizzati;
- azione separata `Conteggio straordinario`.

### Conteggio cieco

Per Magazziniere:

- articolo;
- unità base;
- campo quantità;
- avanzamento;
- salva/continua;
- invio in verifica.

Non mostra teorico, differenza, valore, conteggio precedente o indicatori grafici che permettano di dedurli.

### Verifica

Admin/Responsabile/Vice vedono:

- teorico al momento del conteggio;
- contato;
- delta;
- valore differenza se disponibile;
- storico round;
- accetta;
- richiedi riconteggio.

### Straordinario

Form selezione referenze + quantità fisica. Quando esiste differenza la conferma richiede uno dei motivi preliminari; `Altro` richiede nota.

### Anomalie

Nel dettaglio del conteggio straordinario vengono mostrate le anomalie create, stato e azioni di indagine consentite. Un modulo Anomalie globale potrà riusare la stessa tabella in seguito senza cambiare l'Inventario.

## Error handling funzionale

Messaggi minimi:

- Quantità non valida.
- Inventario già aperto per questo store.
- Inventario di apertura già completato.
- Inventario di apertura non può essere approvato perché esistono movimenti precedenti.
- Conteggio non disponibile in questo stato.
- Non puoi vedere il teorico durante il conteggio.
- Seleziona almeno una referenza da riconteggiare.
- Completa tutti i conteggi richiesti prima dell'invio.
- Alcune righe non sono ancora accettate.
- Una rettifica violerebbe una riserva aperta: risolvi prima il flusso operativo collegato.
- Motivo preliminare obbligatorio per la differenza.
- Per “Altro” inserisci una nota.
- Non hai i permessi per questa operazione.
- L'inventario è cambiato nel frattempo. Ricarica e riprova.

## Invarianti / acceptance

Devono essere verificabili almeno:

1. Apertura e mensile fotografano tutte e sole le referenze attive dello store al momento dell'avvio.
2. Straordinario fotografa solo le referenze selezionate.
3. Un utente non vede inventari di store non autorizzati.
4. Magazziniere non riceve teorico/delta/valori in nessuna query di conteggio mensile/apertura.
5. Responsabile/Vice vedono teorico solo dalla verifica.
6. Admin vede teorico sempre.
7. Quantità `0.375` resta esatta.
8. Un round inviato non viene modificato.
9. Un riconteggio conserva il round precedente e crea un nuovo round.
10. Il magazziniere non vede il valore del round precedente durante riconteggio.
11. Un inventario con righe non accettate non può essere approvato.
12. Apertura genera solo `OPENING_STOCK` positivi per quantità > 0.
13. Apertura non può essere chiusa due volte o eseguita due volte per store.
14. Mensile genera `INVENTORY_ADJUSTMENT` solo per delta != 0.
15. Il delta usa il teorico al timestamp del conteggio, preservando movimenti successivi legittimi.
16. Retry approvazione non duplica movimenti.
17. Approvazione è atomica su tutte le righe.
18. Un delta non può produrre saldo negativo o `reserved > on_hand`.
19. Conteggio straordinario differente genera `EXTRAORDINARY_ADJUSTMENT` + anomalia nella stessa transazione.
20. Conteggio straordinario conforme non genera movimento né anomalia.
21. Straordinario multi-riga è atomico.
22. Motivo preliminare è obbligatorio solo per righe straordinarie con differenza.
23. `OTHER` richiede nota.
24. Anomalia nasce `TO_VERIFY` e non può essere cancellata.
25. `RESOLVED` richiede causa finale + resolution note.
26. `CLOSED_UNKNOWN` conserva causa `UNKNOWN`.
27. Invio in verifica crea notifica persistente ai supervisori dello store.
28. Riconteggio crea notifica persistente ai magazzinieri dello store.
29. Rettifica straordinaria crea notifica persistente ai supervisori.
30. Lettura notifica non cambia lo stato inventario/anomalia.
31. Nessuna scrittura diretta client a sessioni, righe, conteggi o anomalie.
32. Tutte le funzioni private critiche sono non eseguibili direttamente da `authenticated`.
33. Nessun hardcoded/mock stock appare nella UI.
34. Inventario chiuso resta immutabile.
35. Il valore differenza usa solo ultimo prezzo `RECEIPT`; costo assente resta `NULL`.

## Scope implementazione Inventari

Incluso:

- schema sessioni/righe/conteggi;
- snapshot e calcolo teorico al timestamp del conteggio;
- apertura;
- mensile cieco;
- riconteggi;
- approvazione/chiusura;
- straordinario multi-riga;
- motore anomalie minimo;
- notifiche persistenti e relativo evento push-ready;
- RLS/grant/RPC dedicate;
- gateway TypeScript;
- UI Inventari mobile-first;
- integrazione card `Inventari` in `Altro`;
- test DB, RLS, dominio, UI e build.

Escluso:

- trasporto Web Push generico dell'intera app;
- ordini/ricezioni;
- rifornimenti/resi;
- prestiti inter-store;
- non conformità fornitore;
- OCR;
- reportistica aggregata;
- cancellazioni fisiche.
