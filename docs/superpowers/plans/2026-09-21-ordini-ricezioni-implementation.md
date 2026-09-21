# Piano implementazione ordini e ricezioni

## Sequenza

1. Schema procurement: enum, ordini, righe, ricezioni, righe ricezione, NC, operation log.
2. RPC lettura: fabbisogni, lista ordini, dettaglio ordine.
3. RPC scrittura ordini: genera bozze multi-fornitore, segna ordinato, annulla.
4. RPC ricezioni atomiche: quantità documento/ricevuta/accettata, carichi stock, storico prezzi, NC, stati derivati.
5. RPC NC: aggiornamento risoluzione e registrazione nota di credito.
6. Sicurezza: RLS, revoche, grant RPC, indici.
7. Acceptance SQL con rollback.
8. OrderGateway + adapter Supabase + validation/mapping tests.
9. UI Fabbisogni/Ordini/Dettaglio/Ricezione/NC.
10. Wiring AppShell e reset su cambio store.
11. CI completa.
12. Applicazione migrazioni live + acceptance rollback + advisor.
13. PR, review, merge, CI post-merge.
