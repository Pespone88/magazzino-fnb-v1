# Catalogo + Fornitori — Design

Data: 2026-09-15

## Obiettivo

Definire il sottosistema anagrafico e commerciale che farà da base a ordini, ricezioni, movimenti e inventari del gestionale Magazzino F&B.

Il sistema deve mantenere un catalogo centrale coerente, ma l’esperienza quotidiana deve essere store-first: l’utente lavora sempre nel contesto di Eccellenze della Costiera oppure Nonna Titti, senza dover passare esplicitamente da un catalogo centrale.

## Principi approvati

- Un solo catalogo articoli centrale.
- Un solo catalogo fornitori centrale.
- Articoli e fornitori vengono poi associati ai singoli store.
- L’interfaccia è store-first; il catalogo centrale rimane una struttura tecnica e una funzione di manutenzione Admin.
- Nessuna cancellazione fisica di dati usati nello storico: si usa la disattivazione.
- Quantità decimali, con precisione fino a 3 decimali.
- Prezzi IVA inclusa.
- Tutte le variazioni di prezzo restano storicizzate.
- La sicurezza deve essere applicata con RLS Supabase, non solo tramite UI.

## Modello dati

### categories

Categorie centrali uniche condivise tra gli store.

Campi concettuali:
- id
- name
- active
- created_at
- updated_at

Vincoli:
- nome categoria unico tra le categorie attive;
- nessuna cancellazione fisica se referenziata.

### articles

Catalogo centrale degli articoli.

Campi concettuali:
- id
- name
- normalized_name
- category_id
- base_unit
- ean nullable
- package_quantity
- active
- created_at
- updated_at

Unità ammesse:
- CF
- PZ
- KG
- L

Regole:
- EAN opzionale ma univoco se valorizzato;
- package_quantity > 0;
- package_quantity supporta valori decimali;
- normalized_name serve alla ricerca di possibili duplicati ma non deve imporre un merge automatico;
- cambio di package_quantity vale solo per il futuro.

### store_articles

Associazione articolo × store.

Campi concettuali:
- id
- store_id
- article_id
- min_stock
- target_stock
- active
- created_at
- updated_at

Vincoli:
- una sola associazione articolo/store;
- min_stock >= 0;
- target_stock >= min_stock;
- valori con massimo 3 decimali.

### suppliers

Anagrafica centrale dei fornitori.

Campi concettuali:
- id
- name
- vat_number nullable
- tax_code nullable
- email nullable
- phone nullable
- notes nullable
- active
- created_at
- updated_at

Un fornitore può servire uno o entrambi gli store senza duplicazione dell’anagrafica.

### store_suppliers

Associazione fornitore × store.

Campi concettuali:
- id
- store_id
- supplier_id
- customer_code nullable
- minimum_order_amount nullable
- delivery_notes nullable
- active
- created_at
- updated_at

Serve a contenere condizioni generali specifiche dello store.

### store_article_suppliers

Relazione articolo × fornitore × store.

Campi concettuali:
- id
- store_article_id
- store_supplier_id
- supplier_article_code nullable
- current_package_price
- is_preferred
- active
- created_at
- updated_at

Regole:
- uno stesso fornitore non può essere associato due volte allo stesso articolo nello stesso store;
- un solo fornitore preferito per articolo/store;
- current_package_price >= 0;
- il prezzo rappresenta la confezione commerciale IVA inclusa;
- il costo unitario viene calcolato come prezzo confezione / package_quantity dell’articolo corrente.

### purchase_price_history

Storico append-only delle variazioni prezzo.

Campi concettuali:
- id
- store_article_supplier_id
- package_price
- package_quantity_snapshot
- base_unit_snapshot
- unit_price_snapshot
- previous_package_price nullable
- absolute_change nullable
- percent_change nullable
- source
- recorded_at
- recorded_by

Regole:
- nessun aggiornamento retroattivo;
- la quantità confezione e l’unità vengono salvate come snapshot;
- i valori storici non devono cambiare se viene modificata successivamente la confezione standard dell’articolo.

## Creazione articolo

Il flusso parte dallo store selezionato.

1. L’utente inserisce nome, categoria e unità base.
2. Il sistema normalizza il nome e cerca possibili duplicati.
3. Se è presente un EAN, controlla che non sia già assegnato.
4. L’utente può riutilizzare un articolo centrale esistente oppure confermare la creazione di uno nuovo.
5. Inserisce la quantità standard per confezione.
6. Imposta minimo e obiettivo per lo store corrente.
7. Il fornitore è opzionale.
8. Se viene aggiunto un fornitore, si sceglie o crea l’anagrafica centrale, quindi si imposta codice fornitore, prezzo confezione e preferenza.

L’articolo può essere creato anche senza fornitore.

## Associazione all’altro store

Se un articolo centrale esiste già, l’utente non deve ricrearlo.

Dal dettaglio articolo l’Admin può associarlo all’altro store. La nuova associazione avrà propri:
- minimo;
- obiettivo;
- fornitori;
- prezzi;
- fornitore preferito;
- stato attivo/disattivo.

## Confezioni e conversioni

Ogni articolo ha una quantità standard per confezione.

Esempi:
- 1 CF = 24 PZ;
- 1 CF = 2,5 KG;
- 1 CF = 6 L.

Il valore resta di default e può essere modificato dall’Admin quando cambia il formato commerciale.

La modifica non deve alterare:
- ordini già creati;
- ricezioni già registrate;
- movimenti già registrati;
- storico prezzi.

I documenti futuri useranno il nuovo valore.

## Minimo e obiettivo

Ogni store_article contiene:
- giacenza minima;
- giacenza obiettivo.

La quantità suggerita per il riordino sarà calcolata in futuro in base alla distanza dall’obiettivo e arrotondata alle confezioni commerciali necessarie.

Esempio:
- giacenza attuale: 40 PZ;
- minimo: 48 PZ;
- obiettivo: 120 PZ;
- confezione: 24 PZ;
- suggerimento: 4 confezioni, cioè 96 PZ, per arrivare a 136 PZ.

L’arrotondamento deve privilegiare il raggiungimento o superamento dell’obiettivo, non il semplice raggiungimento del minimo.

## Prezzi

Il prezzo inserito è sempre il prezzo della confezione commerciale, IVA inclusa.

Il costo unitario viene calcolato automaticamente.

Esempio:
- confezione: 24 PZ;
- prezzo confezione: 24,00 €;
- costo unitario: 1,00 €/PZ.

## Variazioni prezzo

Quando una ricezione futura rileverà un prezzo diverso:

1. il nuovo prezzo viene salvato nello storico;
2. diventa automaticamente il prezzo corrente;
3. il prezzo precedente resta disponibile nello storico;
4. viene calcolata la variazione assoluta;
5. viene calcolata la variazione percentuale;
6. viene generata una notifica Admin per qualsiasi variazione;
7. variazioni superiori a ±5% vengono marcate come significative.

La soglia del 5% riguarda l’evidenza della notifica, non la decisione di registrare o notificare la variazione.

## Duplicati articolo

Controllo assistito, non rigido.

Il sistema usa:
- normalized_name;
- categoria;
- unità base;
- EAN quando presente.

Se trova un possibile duplicato, lo propone all’utente.

Non deve effettuare merge automatici.

L’utente può confermare che si tratta di un articolo differente.

## Permessi

### ADMIN

Può:
- vedere entrambi gli store;
- creare e modificare articoli centrali;
- creare e modificare categorie;
- creare e modificare fornitori centrali;
- associare articoli e fornitori agli store;
- modificare package_quantity;
- modificare minimo e obiettivo;
- scegliere il fornitore preferito;
- disattivare articoli, associazioni e fornitori.

### RESPONSABILE / VICE

Può operare solo sugli store assegnati.

Può gestire dati operativi dello store, ma non deve poter alterare liberamente dati centrali che impattano altri store.

I permessi puntuali di scrittura sul catalogo verranno mantenuti restrittivi nella prima versione.

### MAGAZZINIERE

Può vedere e usare gli articoli dello store assegnato e lavorare sui futuri flussi operativi di magazzino.

Non può modificare:
- catalogo centrale;
- categorie;
- configurazioni globali;
- dati condivisi tra store.

## RLS e sicurezza

Tutte le tabelle esposte al Data API devono avere RLS abilitata.

Le policy devono rispettare:
- Admin globale vede entrambi gli store;
- utenti non Admin vedono solo store assegnati e righe correlate;
- nessun ruolo client deve poter modificare dati centrali non autorizzati;
- nessuna autorizzazione deve dipendere da user_metadata modificabile dall’utente;
- eventuali funzioni SECURITY DEFINER devono vivere in schema privato, fare controlli espliciti su auth.uid() ed essere esposte solo quando strettamente necessario.

## Integrità e soft delete

Non si cancellano fisicamente record di business già referenziati.

Si usa active=false per:
- articoli;
- store_articles;
- fornitori;
- store_suppliers;
- associazioni articolo/fornitore.

I record disattivati restano leggibili nello storico.

## Error handling

Messaggi previsti:
- Articolo già presente in questo store.
- EAN già associato a un altro articolo.
- L’obiettivo non può essere inferiore al minimo.
- Questo fornitore è già associato all’articolo.
- Non hai i permessi per modificare questo dato.
- Il dato è utilizzato nello storico e non può essere eliminato.

Le operazioni multi-tabella critiche dovranno essere atomiche tramite transazione/RPC database.

## UX mobile-first

Lo store selezionato è sempre visibile.

Navigazione primaria mobile:
- Home
- Articoli
- +
- Ordini
- Altro

Da Altro:
- Fornitori
- Ricezioni
- Movimenti
- Inventari
- Notifiche
- Configurazioni

Su desktop la stessa struttura può diventare una sidebar.

### Lista articoli

Mostra:
- ricerca;
- filtri;
- stato sotto minimo;
- preferiti;
- giacenza;
- minimo/obiettivo.

### Dettaglio articolo

Mostra:
- giacenza corrente;
- minimo;
- obiettivo;
- fornitore preferito;
- altri fornitori;
- prezzo corrente;
- costo unitario;
- storico prezzi;
- accesso ai futuri movimenti.

### Nuovo articolo

Form singolo e guidato, senza wizard multi-step salvo futura necessità reale.

### Catalogo centrale

Non compare nella navigazione quotidiana.

Rimane disponibile solo come funzione Admin di manutenzione avanzata.

## Notifiche prezzo

Ogni variazione genera una notifica Admin.

Classificazione:
- normale: variazione compresa tra -5% e +5%, estremi inclusi;
- significativa: variazione < -5% oppure > +5%.

## Test di accettazione

Il modulo è considerato completo solo se passano almeno questi casi:

1. Admin crea un articolo da Eccellenze.
2. Lo stesso articolo viene associato a Nonna Titti senza duplicare articles.
3. Un utente di uno store non può leggere configurazioni private dell’altro.
4. EAN duplicato viene rifiutato.
5. Possibile duplicato per nome genera suggerimento ma non blocco assoluto.
6. Quantità 0,375 viene salvata e riletta senza perdita di precisione.
7. target_stock inferiore a min_stock viene rifiutato.
8. Un solo fornitore può essere preferito per articolo/store.
9. Un articolo può esistere senza fornitore.
10. Un fornitore centrale può essere associato a entrambi gli store.
11. Cambio prezzo crea una nuova riga nello storico.
12. Cambio prezzo aggiorna il prezzo corrente.
13. Qualsiasi cambio prezzo genera notifica Admin.
14. Variazione oltre ±5% viene marcata significativa.
15. Modifica package_quantity non altera record storici.
16. Articolo disattivato resta leggibile nei documenti storici.
17. RLS impedisce accessi cross-store non autorizzati anche con chiamate API dirette.

## Scope prima implementazione

Incluso:
- categorie;
- articoli;
- associazione articolo/store;
- minimo/obiettivo;
- fornitori;
- associazione fornitore/store;
- relazione articolo/fornitore/store;
- fornitore preferito;
- prezzo confezione corrente;
- costo unitario calcolato;
- storico prezzi;
- notifiche variazione prezzo;
- schermate mobile-first relative a questi dati;
- RLS e test.

Escluso da questo blocco:
- generazione automatica ordini;
- invio ordini;
- ricezioni;
- movimenti di magazzino;
- inventari;
- prestiti interstore;
- OCR;
- barcode scanning.

Questi moduli useranno il sottosistema qui definito come base dati e di autorizzazione.

## Decisioni definitive

- UX store-first.
- Catalogo centrale unico.
- Categorie centrali uniche.
- Fornitori centrali unici.
- Articolo creabile senza fornitore.
- EAN opzionale e univoco.
- Controllo duplicati assistito.
- Unità: CF, PZ, KG, L.
- Quantità decimali fino a 3 cifre.
- Quantità standard per confezione modificabile dall’Admin.
- Minimo + obiettivo per articolo/store.
- Prezzo inserito per confezione, IVA inclusa.
- Storico prezzi automatico.
- Nuovo prezzo ricevuto diventa automaticamente prezzo corrente.
- Notifica Admin per ogni variazione prezzo.
- Evidenza significativa oltre ±5%.
- Un solo fornitore preferito per articolo/store.
- Soft delete per i dati di business.
