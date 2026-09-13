# Magazzini F&B V1

PWA smartphone-first per la gestione separata dei magazzini **Eccellenze della Costiera** e **Nonna Titti**.

## Stack previsto

- React + TypeScript + Vite
- PWA con `vite-plugin-pwa`
- Supabase Free (PostgreSQL, Auth, Storage, RLS) — progetto `MAGAZZINO FNB V1` attivo
- Cloudflare Pages Free per il frontend

## Vincoli V1

- costo infrastrutturale ricorrente target: €0/mese
- store sempre separati
- nessuna giacenza del punto vendita
- niente OCR
- niente barcode
- nessuna cancellazione fisica dello storico operativo

## Comandi

```bash
npm install
npm run dev
npm run test:run
npm run lint
npm run build
```

> Nota ambiente: nel sandbox di generazione il DNS verso npm non è disponibile; il repository include quindi il `package.json` completo ma non `node_modules`/`package-lock.json`. Il bootstrap zero-dependency può essere verificato con `npm run test:bootstrap` una volta installate le dipendenze, oppure direttamente con Node 22.


## Stato database

STEP 3.3 applicato: `stores`, `profiles`, `store_memberships`, RLS e policy di isolamento store. I due store iniziali sono già presenti nel database.
