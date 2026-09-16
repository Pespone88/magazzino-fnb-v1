# Magazzini F&B V1

PWA smartphone-first per la gestione separata dei magazzini **Eccellenze della Costiera** e **Nonna Titti**.

## Stack attuale

- React + TypeScript + Vite
- PWA con `vite-plugin-pwa`
- Supabase Free: PostgreSQL, Auth, RLS e Storage quando necessario
- Cloudflare Workers Free con Static Assets
- GitHub per repository e CI

URL applicazione: `https://magazzino-fnb-v1.peppesposito88.workers.dev`

## Vincoli V1

- costo infrastrutturale ricorrente target: €0/mese
- store sempre separati operativamente ed economicamente
- nessuna giacenza del punto vendita
- niente OCR
- niente barcode
- nessuna cancellazione fisica dello storico operativo
- stock derivato esclusivamente dal ledger movimenti, mai da valori inventati o editati direttamente
- quantità operative con precisione fino a 3 decimali

## Moduli disponibili

### Fondazione accessi

- autenticazione Supabase email/password
- ruoli globali `ADMIN` / `USER`
- ruoli store `RESPONSABILE` / `VICE` / `MAGAZZINIERE`
- isolamento store via Row Level Security
- Admin con accesso a entrambi gli store

### Catalogo articoli e fornitori

- catalogo articoli centrale con associazione separata agli store
- categorie centrali
- unità base controllate: `CF`, `PZ`, `KG`, `L`
- quantità confezione e soglie minimo/obiettivo con precisione fino a 3 decimali
- rilevazione assistita dei possibili duplicati articolo
- fornitori centrali associabili ai singoli store
- più fornitori per articolo/store con un solo preferito
- prezzo confezione IVA inclusa e costo unitario derivato
- storico prezzi append-only con snapshot della confezione e dell'unità
- notifica Admin per ogni variazione prezzo; evidenza `SIGNIFICANT` oltre ±5%
- creazione nuovo fornitore + associazione store atomica lato database

### Movimenti e giacenze

- ledger `stock_movements` immutabile come fonte autorevole della giacenza
- proiezione corrente `stock_balances` aggiornata transazionalmente dal database
- quantità fisica, riservata e disponibile separate
- stock negativo e disponibilità negativa bloccati lato database
- rettifiche Admin motivate e storni completi tracciati, senza cancellare movimenti
- storico costo congelato sul movimento quando disponibile
- nessuna scrittura diretta delle tabelle stock dal browser

### Inventari

- inventario di **apertura**, **mensile** e **straordinario**
- conteggio cieco: il Magazziniere non vede il teorico durante il conteggio
- verifica da Responsabile/Vice/Admin con accettazione o richiesta di riconteggio
- cronologia dei round di conteggio preservata
- approvazione apertura/mensile che scrive esclusivamente attraverso il ledger movimenti
- conteggio straordinario su referenze selezionate con motivo preliminare obbligatorio in caso di differenza
- rettifica straordinaria atomica: se una riga non può essere applicata, l'intera conferma viene annullata
- anomalie post-rettifica con stati `TO_VERIFY`, `IN_REVIEW`, `RESOLVED`, `CLOSED_UNKNOWN`
- gestione anomalie per Responsabile/Vice/Admin; visualizzazione read-only per Magazziniere
- notifiche generiche per verifica inventario, riconteggio e rettifiche straordinarie
- isolamento completo tra store e nessun accesso diretto alle tabelle Inventari dal client

## Database

Migrazioni principali applicate:

- foundation access model: `stores`, `profiles`, `store_memberships`
- bootstrap Admin
- schema catalogo/fornitori, RPC operative, storico prezzi e notifiche
- ledger movimenti, saldi correnti, riserve e hardening delle primitive private
- schema Inventari, workflow conteggio/verifica, scrittura stock e gestione anomalie
- policy RLS/deny-direct e indici sulle foreign key dei moduli operativi

Le mutazioni operative passano da RPC controllate che verificano autenticazione, ruolo e store. Le primitive `private.*` non sono eseguibili dai client autenticati.

## Verifica

```bash
npm install
npm run test:bootstrap
npm run test:run
npm run lint
npm run build
```

La CI GitHub esegue test Node/bootstrap, Vitest, lint e build TypeScript/Vite. Cloudflare esegue inoltre il build/deploy della produzione.

> Il repository non include `node_modules` né `package-lock.json`; le dipendenze vengono risolte con `npm install` negli ambienti di sviluppo e CI.

## Moduli successivi

La base ledger + Inventari è pronta per i flussi successivi: **ricezioni/DDT**, replenishment verso i punti vendita, prestiti tra store e ordini fornitori.
