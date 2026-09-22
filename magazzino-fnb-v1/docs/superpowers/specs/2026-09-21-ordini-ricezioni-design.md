# Ordini fornitori e ricezioni DDT — V1

**Data:** 21 settembre 2026  
**Stato:** implementazione V1

## Obiettivo
Gestire il ciclo operativo dal fabbisogno di magazzino alla ricezione del fornitore, mantenendo stock, prezzi e difformità tracciati e isolati per store.

## Flusso ordine
1. La schermata Ordini mostra le referenze attive dello store con disponibilità, scorta minima e obiettivo.
2. Quando la disponibilità è sotto il minimo, il sistema propone la quantità necessaria per raggiungere l'obiettivo.
3. L'operatore può modificare quantità e fornitore.
4. Le righe selezionate vengono raggruppate automaticamente per fornitore in una o più bozze.
5. La bozza conserva snapshot di articolo, UM, quantità per confezione e prezzo stimato.
6. La bozza può essere copiata o predisposta per invio via WhatsApp/email; l'invio esterno non modifica lo stock.
7. Solo una bozza può passare a ORDINATO.
8. Un ordine senza ricezioni può essere annullato con motivo obbligatorio.

## Flusso ricezione / DDT
1. Una ricezione è ammessa solo per ordini ORDINATI o PARZIALMENTE RICEVUTI.
2. Sono registrati numero/data DDT, totale documento, eventuali extra e note.
3. Per ogni riga si distinguono quantità su DDT, quantità fisicamente ricevuta e quantità accettata.
4. Solo la quantità accettata genera un movimento SUPPLIER_RECEIPT e aumenta la giacenza.
5. Ogni movimento conserva il costo unitario usato al momento della ricezione.
6. Se il prezzo DDT cambia rispetto al prezzo ordine/corrente, la variazione richiede conferma esplicita prima della registrazione.
7. Il prezzo confermato alimenta storico prezzi e prezzo corrente del legame articolo/fornitore.
8. Il totale DDT non coerente con righe + extra richiede una spiegazione.

## Difformità
Esiti supportati:
- quantità parziale;
- mancante;
- articolo errato;
- qualità/non idoneo;
- non fatturato;
- altro.

Gestione prevista:
- consegna successiva;
- chiusura della differenza;
- nessuna azione;
- sostituzione;
- accettazione come altro articolo compatibile con lo stesso fornitore;
- nota credito;
- altro con nota obbligatoria.

Le difformità restano tracciate in supplier_nonconformities; nessuna cancellazione fisica. Una nota credito viene registrata con numero, data e importo.

## Invarianti
1. Store isolati e accesso verificato lato database.
2. Nessuna modifica manuale di stock_balances.
3. Ogni carico reale passa dal ledger stock_movements.
4. Quantità con massimo 3 decimali.
5. Stock mai negativo e riserve mai superiori alla giacenza.
6. Operazioni mutative idempotenti tramite operation_key.
7. Nessun doppio DDT attivo per stesso fornitore, numero e data.
8. Un articolo ricevuto come articolo diverso è ammesso solo nel flusso “articolo errato → accetta come altro articolo” e deve essere attivo per lo stesso fornitore/store.
9. La quantità accettata di una riga non può superare il residuo ordinato dell'articolo atteso.
10. Le ricezioni parziali preservano il residuo e possono essere completate da ricezioni successive.
11. Prezzi e valori mancanti non vengono inventati.
12. Tutti i cambi di stato rilevanti conservano attore e timestamp.
