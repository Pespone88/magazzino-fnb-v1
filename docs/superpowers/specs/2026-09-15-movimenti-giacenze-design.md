# Movimenti + Giacenze — Design

Data: 2026-09-15

## Stato e relazione con la progettazione esistente

Questo documento NON ridefinisce il funzionale già approvato per Magazzino F&B. È una specifica di implementazione del sottosistema stock che eredita i principi della progettazione V1 e del modulo Catalogo + Fornitori già integrato in `main`.

Restano invariati i principi già approvati:

- nessuna cancellazione definitiva dei dati di business;
- nessuna modifica manuale diretta della giacenza;
- ogni variazione fisica dello stock genera un movimento tracciato;
- Eccellenze della Costiera e Nonna Titti restano operativamente isolati;
- Eccellenze ha due depositi fisici trattati come un solo magazzino logico;
- il punto vendita non possiede una propria giacenza contabile nell'app;
- quantità con precisione massima di 3 decimali;
- prezzi IVA inclusa;
- valorizzazione corrente secondo l'ultimo prezzo di acquisto disponibile;
- i costi storici dei movimenti non vengono ricalcolati quando cambiano i prezzi futuri;
- nessuna quantità stock negativa;
- errori su movimenti già registrati si correggono con storno/reversal, mai modificando o cancellando il movimento originale;
- RLS e controlli DB sono autoritativi: la UI da sola non costituisce sicurezza.

## Delta tecnico approvato

Rispetto alla progettazione funzionale precedente vengono aggiunte due strutture tecniche, senza cambiare i flussi di business:

1. `stock_balances`: saldo corrente materializzato per articolo/store, aggiornato atomicamente dal database.
2. `stock_reservations`: riserve esplicite, tracciabili e auditabili per merce impegnata ma non ancora uscita fisicamente dal magazzino.

Il ledger dei movimenti resta la fonte storica autorevole. `stock_balances` è una proiezione derivata verificabile, introdotta per evitare di eseguire continuamente `SUM()` sull'intero ledger in dashboard, articoli, ordini e inventari.

## Obiettivo del modulo

Costruire una sola infrastruttura stock che verrà usata da tutti i moduli successivi:

- ricezioni fornitore;
- rifornimenti magazzino → punto vendita;
- resi punto vendita → magazzino;
- inventari mensili;
- inventari/controlli straordinari;
- rettifiche Admin;
- prestiti inter-store;
- restituzioni prestiti;
- storni.

Nessuno di questi moduli dovrà implementare una propria logica parallela di giacenza.

## Modello concettuale

### stock_movements

Ledger append-only delle variazioni fisiche della giacenza.

Campi concettuali:

- `id`
- `store_id`
- `store_article_id`
- `movement_type`
- `quantity_delta_base`
- `unit_cost_snapshot` nullable
- `total_value_snapshot` nullable
- `source_type`
- `source_id` nullable
- `source_line_id` nullable
- `reversal_of_movement_id` nullable
- `operation_key`
- `reason` nullable
- `occurred_at`
- `created_at`
- `created_by`

Regole:

- `quantity_delta_base` è espresso sempre nell'unità base dell'articolo;
- non sono ammessi movimenti con quantità zero;
- quantità positive aumentano `on_hand`, quantità negative lo diminuiscono;
- il record è immutabile dopo la creazione;
- nessun `UPDATE` o `DELETE` client sul ledger;
- `operation_key` impedisce doppie registrazioni in caso di retry della stessa operazione;
- un reversal punta al movimento originale e usa quantità opposta;
- un movimento non può essere stornato più volte oltre la quantità originariamente registrata;
- `unit_cost_snapshot` e `total_value_snapshot` sono congelati al momento del movimento;
- se non esiste ancora un costo attendibile, il costo storico resta `NULL`: non viene inventato un costo zero;
- i moduli origine risolvono il costo secondo le proprie regole approvate e lo passano solo attraverso primitive DB fidate, mai tramite scrittura diretta del browser.

### movement_type

Tipi previsti dall'architettura V1:

- `OPENING_STOCK`
- `SUPPLIER_RECEIPT`
- `STORE_SUPPLY`
- `STORE_RETURN`
- `INVENTORY_ADJUSTMENT`
- `EXTRAORDINARY_ADJUSTMENT`
- `ADMIN_ADJUSTMENT`
- `INTERSTORE_LOAN_OUT`
- `INTERSTORE_LOAN_IN`
- `INTERSTORE_RETURN_OUT`
- `INTERSTORE_RETURN_IN`
- `REVERSAL`

Il tipo è controllato dal database e non è testo libero.

### stock_balances

Una riga per ogni `store_article` che ha avuto o può avere attività stock.

Campi concettuali:

- `store_article_id` PK/FK
- `store_id`
- `on_hand`
- `reserved`
- `available`
- `updated_at`
- `last_movement_id` nullable

Regole:

- `on_hand >= 0`;
- `reserved >= 0`;
- `reserved <= on_hand`;
- `available = on_hand - reserved` come valore generato/calcolato, non modificabile liberamente;
- `on_hand` e `reserved` non sono scrivibili dal browser;
- l'aggiornamento avviene nella stessa transazione del movimento o della modifica di una riserva;
- il saldo può essere ricostruito/verificato dal ledger e dalle riserve aperte;
- eventuale divergenza tra proiezione e fonti autorevoli è un errore di integrità da rilevare nei test/advisor, non una situazione da correggere manualmente dall'utente.

### stock_reservations

Registro delle quantità impegnate ma non ancora uscite fisicamente.

Campi concettuali:

- `id`
- `store_id`
- `store_article_id`
- `quantity_base`
- `reservation_type`
- `source_id`
- `source_line_id` nullable
- `status`
- `operation_key`
- `created_at`
- `created_by`
- `closed_at` nullable
- `closed_by` nullable

Stati:

- `OPEN`
- `CONSUMED`
- `RELEASED`

Regole:

- una riserva `OPEN` aumenta `stock_balances.reserved`;
- una riserva consumata o rilasciata non viene cancellata;
- `CONSUMED` significa che l'impegno è stato convertito nel relativo movimento fisico;
- `RELEASED` significa che l'impegno è stato annullato senza uscita fisica;
- nessuna riserva può portare `available` sotto zero;
- la stessa operazione non può creare due volte la stessa riserva;
- le riserve non scadono automaticamente: la chiusura deve essere deterministica e collegata al flusso origine;
- il campo `reserved` del saldo deve essere sempre coerente con la somma delle riserve `OPEN`.

## Semantica delle quantità

Per ogni articolo/store:

`available = on_hand - reserved`

Esempio:

- `on_hand = 100 CF`
- nuovo rifornimento preparato: `15 CF`
- `reserved = 15 CF`
- `available = 85 CF`

Finché il rifornimento è solo preparato, non viene creato un movimento negativo di stock.

Quando il flusso viene confermato:

1. la riserva viene chiusa come `CONSUMED`;
2. viene creato il movimento negativo previsto dal flusso;
3. `on_hand` scende;
4. `reserved` scende;
5. tutto avviene atomicamente.

Se il flusso viene annullato prima dell'uscita fisica:

1. la riserva diventa `RELEASED`;
2. `reserved` scende;
3. `on_hand` non cambia.

## Relazione con i flussi già approvati

### Ricezione fornitore

La conferma ricezione futura creerà `SUPPLIER_RECEIPT` positivo.

La ricezione congelerà prezzo/conversione usati nel documento e alimenterà anche il meccanismo di storico prezzo già esistente.

### Rifornimento magazzino → punto vendita

La preparazione crea una riserva.

La conferma prevista dal flusso approvato consuma la riserva e registra `STORE_SUPPLY` negativo per la quantità inviata.

Il punto vendita non riceve una giacenza contabile nell'app.

Una differenza tra inviato e ricevuto genera anomalia nel modulo dedicato; non produce automaticamente un rientro di merce.

### Reso punto vendita → magazzino

La conferma del reso futuro genera `STORE_RETURN` positivo.

### Inventario mensile

Il conteggio non modifica direttamente il saldo.

Alla chiusura/approvazione dell'inventario viene calcolata la differenza tra quantità fisica approvata e `on_hand` atteso e viene generato `INVENTORY_ADJUSTMENT`.

Il meccanismo blind count e gli snapshot per round restano nel modulo Inventari già progettato.

### Conteggio straordinario

Alla conferma genera immediatamente `EXTRAORDINARY_ADJUSTMENT` per gli articoli interessati e l'anomalia interna prevista.

### Rettifica Admin

Una rettifica eccezionale usa `ADMIN_ADJUSTMENT` e richiede motivo obbligatorio.

Non è una modifica del saldo: è sempre un nuovo movimento ledger.

### Prestito inter-store

Alla spedizione viene creata una riserva nel magazzino prestatore.

Alla conferma prevista dal flusso, le primitive del prestito producono movimenti accoppiati e atomici:

- `INTERSTORE_LOAN_OUT` sul prestatore;
- `INTERSTORE_LOAN_IN` sul ricevente.

La restituzione usa:

- `INTERSTORE_RETURN_OUT` sullo store che restituisce;
- `INTERSTORE_RETURN_IN` sullo store originario.

Il debito di prestito resta gestito dal modulo Prestiti e si basa sulle quantità effettivamente confermate, non sulla sola prenotazione.

## Concorrenza e atomicità

Qualunque operazione che modifica stock o riserve deve bloccare la riga di saldo interessata durante la transazione database.

Obiettivi:

- due utenti non possono impegnare contemporaneamente la stessa disponibilità oltre il saldo reale;
- nessun retry HTTP duplica un movimento;
- movimento, saldo e chiusura riserva non possono divergere;
- le operazioni multi-store dei prestiti sono una sola transazione: o vengono applicate entrambe le gambe oppure nessuna.

Le primitive stock interne devono quindi essere database-first, non sequenze di INSERT/UPDATE orchestrate dal client.

## Primitive DB

Il browser non riceve una RPC generica capace di creare arbitrariamente qualunque `movement_type`.

Il sottosistema espone helper privati riutilizzabili dai moduli di business, ad esempio concettualmente:

- `private.post_stock_movement(...)`
- `private.open_stock_reservation(...)`
- `private.consume_stock_reservation(...)`
- `private.release_stock_reservation(...)`
- `private.reverse_stock_movement(...)`

Le funzioni pubbliche/RPC vengono definite per il singolo caso d'uso autorizzato.

Nella prima implementazione del sottosistema può esistere una RPC Admin dedicata alla rettifica straordinaria/manuale; non deve trasformarsi in un endpoint generico che consenta al client di scegliere liberamente tipo movimento, store e semantica.

## Reversal / storno

Un movimento errato non viene editato.

Lo storno:

1. verifica che il movimento sia stornabile;
2. verifica che non sia già stato completamente stornato;
3. crea un nuovo movimento `REVERSAL` con quantità opposta;
4. copia/congela i riferimenti economici necessari dal movimento originale;
5. collega `reversal_of_movement_id`;
6. aggiorna il saldo nella stessa transazione;
7. rifiuta lo storno se produrrebbe uno stock negativo o violerebbe una riserva aperta.

Il record originale rimane sempre leggibile.

## Costi e valorizzazione

Ogni movimento conserva il costo storico conosciuto al momento della registrazione.

Regole:

- un futuro cambio prezzo non modifica i movimenti storici;
- il valore storico di un movimento, quando disponibile, è `abs(quantity_delta_base) × unit_cost_snapshot`;
- un costo non noto è `NULL`, non `0`;
- la valorizzazione corrente del magazzino usa `on_hand` e l'ultimo prezzo di acquisto disponibile secondo le regole commerciali già approvate;
- una valorizzazione non deve fingere precisione quando manca il prezzo: la UI segnala il costo non disponibile;
- `reserved` non cambia il valore fisicamente presente: il valore di magazzino si basa su `on_hand`, mentre `available` serve alle decisioni operative.

## Minimo, obiettivo e disponibilità

Con il ledger disponibile, Articoli può finalmente mostrare lo stato stock reale.

Per decisioni operative e stato sotto-minimo viene usata `available`, perché la quantità riservata non è più disponibile per nuovi impegni.

Vengono comunque mostrati separatamente:

- fisico (`on_hand`);
- riservato (`reserved`);
- disponibile (`available`);
- minimo;
- obiettivo.

Il suggerimento automatico di ordine resta fuori da questo modulo e verrà implementato nel modulo Ordini, usando questi dati.

## Permessi

### ADMIN

Può leggere entrambi gli store e lo storico completo.

Può usare le funzioni Admin esplicitamente previste, inclusi rettifica motivata e storno quando consentito.

### RESPONSABILE / VICE

Legge giacenze, riserve e movimenti solo negli store assegnati.

Le operazioni stock vengono consentite solo attraverso i flussi operativi a cui il ruolo è autorizzato; non può creare movimenti arbitrari.

### MAGAZZINIERE

Legge giacenze, disponibilità e storico del proprio store.

Può originare i flussi operativi già previsti per il magazziniere (ricezioni, inventari, ordini, rifornimenti, movimenti e prestiti quando i relativi moduli vengono implementati), ma non può alterare direttamente ledger, saldo o riserve.

### Sicurezza trasversale

- RLS su tutte le tabelle esposte al Data API;
- nessun accesso cross-store non autorizzato;
- nessun `DELETE` client;
- ledger senza `UPDATE` client;
- saldo senza `INSERT/UPDATE/DELETE` client;
- riserve senza modifiche dirette client;
- helper critici in schema `private` con `search_path` sicuro;
- RPC pubbliche con grant minimo e controllo esplicito dei ruoli/store;
- nessuna autorizzazione basata su `user_metadata` modificabile dall'utente.

## Audit

Ogni movimento deve consentire di ricostruire:

- chi lo ha originato;
- quando;
- quale store e articolo ha interessato;
- quale documento o flusso lo ha prodotto;
- quantità;
- costo storico, quando noto;
- eventuale motivo;
- eventuale movimento originale stornato.

Ogni riserva deve consentire di ricostruire:

- chi l'ha aperta;
- origine;
- quantità;
- quando è stata aperta;
- come e quando è stata chiusa.

Il sistema generale di `audit_log` resta separato dal ledger: il ledger è prova delle variazioni stock, l'audit log registra le azioni applicative/amministrative.

## UX

### Articoli

La lista articoli, ora che esiste una giacenza reale, può mostrare:

- `on_hand`;
- `reserved` quando > 0;
- `available`;
- indicatore sotto minimo basato su `available`;
- minimo/obiettivo;
- fornitore/prezzo già esistenti.

Nessun numero stock viene simulato se non esiste ancora una riga saldo: in assenza di movimenti/riserve il valore operativo è zero, non un valore demo.

### Dettaglio articolo

Aggiunge una sezione Magazzino con:

- fisico;
- riservato;
- disponibile;
- minimo/obiettivo;
- valore corrente quando calcolabile;
- ultimi movimenti;
- accesso allo storico completo.

### Movimenti

La voce `Movimenti` in `Altro` diventa reale.

Schermata store-first con:

- ricerca articolo;
- filtro tipo movimento;
- intervallo data;
- quantità con segno;
- utente;
- origine/documento;
- eventuale storno;
- costo/valore storico quando disponibile.

L'interfaccia non espone un generico pulsante “nuovo movimento” ai ruoli operativi.

Per Admin può essere disponibile `Rettifica` come azione separata e chiaramente identificata, con motivo obbligatorio.

## Error handling

Messaggi funzionali minimi:

- Quantità non valida.
- Disponibilità insufficiente.
- La riserva supera la quantità disponibile.
- L'operazione porterebbe la giacenza sotto zero.
- Movimento già registrato.
- Movimento non stornabile.
- Movimento già stornato.
- La rettifica richiede un motivo.
- Non hai i permessi per operare su questo store.
- La giacenza è cambiata nel frattempo. Riprova.

Gli errori di concorrenza e i vincoli DB devono essere tradotti in messaggi comprensibili dalla UI senza nascondere l'errore tecnico nei log.

## Invarianti verificabili

Devono esistere controlli/test che verifichino almeno:

1. `stock_balances.on_hand` coincide con la somma dei movimenti fisici per `store_article`.
2. `stock_balances.reserved` coincide con la somma delle riserve `OPEN`.
3. `available = on_hand - reserved`.
4. Nessun saldo negativo.
5. Nessuna riserva superiore a `on_hand`.
6. Retry della stessa `operation_key` non duplica movimento o riserva.
7. Un movimento non viene aggiornato o cancellato dal client.
8. Un saldo non viene modificato direttamente dal client.
9. Un utente Eccellenze non legge stock Nonna Titti e viceversa.
10. Admin legge entrambi.
11. Quantità `0,375` mantiene precisione.
12. Un reversal crea un secondo record e conserva l'originale.
13. Uno storno non può produrre stock negativo.
14. Una riserva può essere consumata una sola volta.
15. Una riserva rilasciata non modifica `on_hand`.
16. Una riserva consumata e il relativo movimento vengono applicati atomicamente.
17. Operazione inter-store futura può aggiornare entrambe le gambe in una singola transazione.
18. Il costo storico di un movimento non cambia dopo variazioni prezzo successive.
19. Nessuna UI mostra stock fittizio o hardcoded.
20. Nessuna scrittura diretta alle tabelle critiche è consentita via Data API.

## Scope della prima implementazione Movimenti + Giacenze

Incluso:

- schema `stock_movements`;
- schema `stock_balances`;
- schema `stock_reservations`;
- enum/tipi controllati;
- primitive DB private atomiche;
- protezione concorrenza;
- idempotenza;
- RLS/grant;
- lettura giacenza e disponibilità;
- integrazione stock nella lista/dettaglio Articoli;
- schermata storico Movimenti;
- rettifica Admin motivata;
- reversal Admin dove consentito;
- test di integrità/RLS/concorrenza essenziali;
- adapter TypeScript/Supabase e UI mobile-first.

Predisposto ma non ancora implementato come flusso completo:

- `SUPPLIER_RECEIPT`;
- `STORE_SUPPLY` / `STORE_RETURN`;
- `INVENTORY_ADJUSTMENT` / `EXTRAORDINARY_ADJUSTMENT`;
- `INTERSTORE_LOAN_*` / `INTERSTORE_RETURN_*`.

Questi tipi e primitive devono essere compatibili fin da subito, ma le rispettive UI/documenti/RPC di business verranno implementate nei moduli già pianificati per Ricezioni, Inventari, Rifornimenti e Prestiti.

Escluso:

- generazione automatica ordini;
- ricezione DDT completa;
- inventario blind-count completo;
- gestione richieste/rifornimenti completa;
- gestione debito prestiti completa;
- OCR;
- barcode;
- giacenza del punto vendita.

## Criterio di completamento

Il modulo è completo quando il database può dimostrare che ogni saldo deriva da movimenti/riserve autorizzati, nessuna operazione può produrre disponibilità o stock negativi, il frontend mostra solo dati reali dello store corrente e l'infrastruttura può essere riutilizzata dai moduli successivi senza introdurre una seconda logica di giacenza.
