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
- stock futuro derivato esclusivamente dal ledger movimenti, mai da valori inventati o editati direttamente

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
- nessuna metrica di giacenza mostrata prima del modulo ledger movimenti

## Database

Migrazioni principali applicate:

- foundation access model: `stores`, `profiles`, `store_memberships`
- bootstrap Admin
- schema catalogo/fornitori
- RLS, RPC operative, trigger storico prezzi e notifiche
- RPC atomica creazione fornitore/store
- indici sulle foreign key del modulo catalogo

Tutte le tabelle pubbliche del modulo sono protette da RLS. Le operazioni strutturali sono riservate all'Admin; storico prezzi e notifiche non vengono inseriti direttamente dal browser.

## Verifica

```bash
npm install
npm run test:run
npm run test:bootstrap
npm run lint
npm run build
```

La CI GitHub esegue test, test Node/bootstrap, lint e build TypeScript/Vite. Cloudflare esegue inoltre il build/deploy del branch e della produzione.

> Il repository non include `node_modules` né `package-lock.json`; le dipendenze vengono risolte con `npm install` negli ambienti di sviluppo e CI.

## Moduli successivi

Il prossimo blocco funzionale userà questa base per implementare il **ledger movimenti e le giacenze di magazzino**, seguito da ricezioni, replenishment verso store, inventari e ordini fornitori.
