# Ordini fornitori, ricezioni e non conformità

**Data:** 21 settembre 2026  
**Stato:** design derivato dalla specifica funzionale V1 approvata.

## Obiettivo

Implementare il flusso operativo:

Fabbisogni → assegnazione fornitore → ordini separati per fornitore → copia esterna → segna come ordinato → una o più ricezioni → movimenti di carico → eventuali non conformità → chiusura.

## Decisioni funzionali congelate

1. Nessun ordine automatico: il sotto-scorta è un suggerimento, decide l'utente.
2. Nessuna approvazione preventiva dell'ordine.
3. La lista fabbisogni è unica e può contenere articoli di fornitori diversi.
4. Prima di generare gli ordini, il fornitore di ogni riga è modificabile.
5. La generazione suddivide automaticamente la lista in un ordine per fornitore.
6. Copiare/condividere il testo dell'ordine non modifica lo stato.
7. Solo “Segna come ordinato” porta la bozza in attesa di ricezione.
8. Il totale stimato IVA inclusa viene congelato nelle righe dell'ordine.
9. Un ordine può avere più ricezioni.
10. Una ricezione distingue quantità documentata, fisicamente ricevuta e accettata.
11. Solo la quantità fisicamente accettata entra in giacenza.
12. Ogni carico genera un movimento SUPPLIER_RECEIPT tracciato.
13. La merce rifiutata non entra in giacenza.
14. Il prezzo documento viene confrontato con prezzo stimato e ultimo prezzo noto; se cambia serve conferma esplicita.
15. Un prezzo di ricezione confermato crea un punto storico con source RECEIPT e aggiorna il prezzo corrente senza perdere lo storico.
16. Le differenze economiche del documento possono essere spiegate da extra (trasporto, cauzioni, arrotondamenti, altro).
17. Le non conformità fornitore restano separate dalle anomalie interne.
18. Nessuna cancellazione fisica: ordini annullati con motivazione, ricezioni confermate immutabili, NC chiuse ma conservate.
19. Accesso operativo consentito ad Admin, Responsabile/Vice e Magazziniere sullo store autorizzato.
20. Ricezioni restano dentro il modulo Ordini, non diventano una voce di navigazione primaria separata.

## Stati

### Ordine
- DRAFT
- ORDERED
- PARTIALLY_RECEIVED
- COMPLETED
- CANCELLED

### Riga ordine
- TO_RECEIVE
- PARTIAL
- COMPLETED
- NOT_SUPPLIED
- AWAITING_REPLACEMENT
- AWAITING_CREDIT_NOTE
- CLOSED_WITH_DISCREPANCY

### Ricezione
- CONFIRMED
- CANCELLED

La V1 salva la ricezione in modo atomico alla conferma; la bozza resta nel client fino alla conferma.

### Esito riga ricezione
- CONFORMING
- PARTIAL_QUANTITY
- MISSING
- WRONG_ITEM
- QUALITY_NOT_SUITABLE
- UNBILLED
- OTHER

### Non conformità
Tipo:
- QUANTITY_MISMATCH
- MISSING_ITEM
- WRONG_ITEM
- QUALITY_NOT_SUITABLE
- UNBILLED_ITEM
- OTHER

Risoluzione:
- NEXT_DELIVERY
- CLOSE
- NO_ACTION
- REPLACEMENT
- ACCEPT_AS_OTHER_ARTICLE
- CREDIT_NOTE
- OTHER

Stato:
- OPEN
- AWAITING_REPLACEMENT
- AWAITING_CREDIT_NOTE
- RESOLVED
- CLOSED

## Quantità e prezzi

Le quantità ufficiali restano in unità base con massimo 3 decimali.

Per ciascuna riga ordine vengono congelati:
- nome articolo;
- unità base;
- fattore confezione;
- quantità ordinata base;
- prezzo confezione stimato IVA inclusa;
- totale stimato.

Totale stimato riga = quantità base / fattore confezione × prezzo confezione.

La ricezione conserva il prezzo documento. Il costo unitario del movimento è prezzo confezione / fattore confezione.

## Lista fabbisogni

La lista viene costruita in UI da articoli attivi dello store. Per ogni articolo:
- stock on hand;
- riservato;
- disponibile;
- minimo;
- target;
- fornitori attivi;
- fornitore preferito;
- quantità suggerita.

La quantità suggerita è target - disponibile solo quando disponibile < minimo; non crea né invia ordini automaticamente.

## Ricezione e stato riga

Esempi:
- ordinato 10, documentato 10, accettato 6 → 6 entrano in stock, riga PARTIAL, 4 restano da ricevere;
- ordinato 10, documentato 6, accettato 6 + CLOSE/NO_ACTION → 6 in stock, residuo chiuso con difformità;
- qualità non idonea, accettato 0 + REPLACEMENT → nessun carico, NC AWAITING_REPLACEMENT;
- qualità non idonea, accettato 0 + CREDIT_NOTE → nessun carico, NC AWAITING_CREDIT_NOTE;
- articolo errato accettato esplicitamente come altra referenza → carico sulla referenza effettiva e NC collegata alla riga ordinata;
- articolo non fatturato → può essere fisicamente accettato anche con quantità documentata 0; se manca il prezzo documento si usa per il movimento l'ultimo costo noto, altrimenti il prezzo stimato congelato.

## Atomicità

La conferma di una ricezione è una singola transazione:
- valida store, ordine, righe, quantità e conferme prezzo;
- crea ricezione e righe;
- genera movimenti stock;
- registra prezzi RECEIPT;
- crea NC;
- aggiorna stati riga/ordine;
- registra audit operativo.

Un errore su una riga annulla l'intera ricezione.

## Sicurezza

Le tabelle operative hanno RLS attiva e non sono direttamente scrivibili dal browser. Le operazioni avvengono tramite RPC con:
- autenticazione obbligatoria;
- controllo store con private.current_user_has_store_access;
- chiavi operazione idempotenti;
- nessun EXECUTE a anon/PUBLIC;
- accesso authenticated solo alle RPC pubbliche intenzionali.

## Criteri di accettazione modulo

1. Una lista multi-articolo viene suddivisa in ordini per fornitore.
2. Copia ordine non cambia stato.
3. Segna come ordinato abilita la ricezione.
4. Ricezione completa porta ordine a COMPLETED.
5. Ricezione parziale mantiene residuo.
6. Articolo documentato meno dell'ordinato può essere chiuso come non fornito/difformità.
7. Quantità rifiutata non entra in stock.
8. Ricezione accettata genera esattamente un carico per riga accettata e retry non duplica.
9. Variazione prezzo richiede conferma esplicita.
10. Ricezione registra storico prezzo source RECEIPT.
11. Articolo errato/qualità non idonea generano NC coerente.
12. CREDIT_NOTE resta aperta fino a registrazione numero/data/importo.
13. Store non autorizzato non è leggibile né scrivibile.
14. Nessuna cancellazione fisica.
