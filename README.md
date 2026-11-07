# Finanze Personali – versione 0.4

Web app (PWA) per iPhone per gestire ricavi, costi e investimenti. I dati restano **solo sul dispositivo**, cifrati con il PIN.

## Cosa contiene questa versione

- Blocco con PIN di 6 cifre. I dati sono cifrati (AES-GCM 256, chiave derivata dal PIN con PBKDF2) e l'app si blocca da sola dopo un periodo di inattività.
- Salvataggio automatico a ogni modifica, in un database IndexedDB.
- Inserimento rapido di costi, ricavi, investimenti e giroconti, con avviso per i possibili duplicati.
- Categorie e sottocategorie del documento di progetto, modificabili. Ognuna è classificata come fissa, variabile o occasionale, e come necessaria o discrezionale.
- Ricorrenze (stipendio, affitto, abbonamenti) che creano i movimenti da sole alla scadenza.
- Home con saldo, tasso di risparmio, confronto con il periodo precedente e grafico degli ultimi 6 mesi.
- Ricavi: quota ricorrente/occasionale, ciambella per categoria, andamento 12 mesi.
- Costi: filtri (fisse, variabili, occasionali, necessarie, discrezionali, junk costs), ciambella per categoria, totale delle spese ricorrenti.
- Investimenti: posizioni, operazioni, costo medio, guadagno/perdita, distribuzione, andamento del valore. I prezzi si aggiornano a mano.
- Report mensile: archiviato a inizio mese ed esportabile in PDF con la stampa.
- Filtri temporali per settimana, mese, trimestre, anno o periodo personalizzato.
- Backup cifrato (file JSON) da salvare in iCloud Drive, ripristino ed export dei movimenti in CSV.

## Novità della versione 0.4 (investimenti, tappa I1 – prima parte)

- Intermediari (broker, banche, fondi pensione) con il regime fiscale: amministrato o dichiarativo.
- Strumenti con ISIN, ticker e borsa, classe fiscale (26%, 12,5% per i titoli di Stato, 33% per le criptovalute dal 2026) e politica dei proventi (accumulo o distribuzione).
- Nuove operazioni: dividendi, cedole, tasse trattenute, costi, frazionamenti.
- Risultato complessivo: non realizzato, vendite realizzate, proventi, costi e tasse.
- Posizioni suddivise per intermediario e filtro per intermediario nella schermata Investimenti.
- Beni non quotati: conti deposito (tasso, scadenza, vincolo), immobili (mutuo collegato), fondo pensione (comparto).
- Collegamenti a Yahoo Finanza e justETF dalla scheda di ogni strumento.
- I dati della versione 0.3 vengono convertiti in automatico al primo sblocco, anche quando ripristini un vecchio backup.

## Comandi

```bash
npm install
npm run dev       # sviluppo su http://localhost:5173
npm test          # test automatici (logica, cifratura, backup)
npm run build     # versione da pubblicare nella cartella dist/
```

## Pubblicazione (una volta sola)

L'app è un sito statico: basta pubblicare il **contenuto della cartella `dist/`** su un hosting HTTPS. I dati non vanno sul server: il server distribuisce solo il codice.

**Opzione semplice – Netlify Drop (da computer)**
1. Crea un account Netlify. Senza account il sito scade.
2. Apri netlify.com/drop e trascina la cartella `dist`.
3. Rinomina il sito con un nome che non cambierai più, ad esempio `finanze-tuonome.netlify.app`.
4. Per gli aggiornamenti futuri, trascina la nuova cartella `dist` nella sezione Deploys dello **stesso** sito.

**Alternativa – GitHub Pages**: crea un repository, carica il contenuto di `dist/` e attiva Pages su quel ramo (Settings › Pages).

> **Importante: l'indirizzo non deve mai cambiare.** Il browser lega i dati all'indirizzo del sito. Se un giorno lo cambi, fai prima un backup e ripristinalo nella nuova installazione.

## Installazione su iPhone

1. Apri l'indirizzo in **Safari**.
2. Tocca Condividi › **Aggiungi alla schermata Home**.
3. Usa l'app **solo dall'icona sulla Home**. Safari e l'app sulla Home hanno archivi separati: i dati inseriti in uno non si vedono nell'altro.
4. Crea il PIN.

## Backup: da fare ogni settimana

Vai in Impostazioni › Backup e ripristino › Crea backup, poi scegli «Salva su File» e la cartella iCloud Drive.
Il file è cifrato con il PIN che avevi quando l'hai creato. **Eliminare l'icona dalla Home cancella i dati**: senza backup non si recuperano.

## Struttura del codice

```
src/
  core/         modello dati, importi (centesimi), date, categorie predefinite
  persistence/  cifratura, database IndexedDB, archivio cifrato in memoria, backup
  ledger/       ricorrenze
  analytics/    statistiche, investimenti, report mensile
  state/        collegamento dati ↔ interfaccia
  ui/           componenti condivisi, grafici, icone
  screens/      schermate (Home, Ricavi, Costi, Investimenti, Report, Impostazioni, Blocco)
  sheets/       moduli di inserimento e modifica
  tests/        test automatici
```

## Limiti noti (previsti per le fasi successive)

- Le importazioni (automazione Wallet, CSV/XLSX della banca) arrivano nella Fase 4.
- I suggerimenti di risparmio personalizzati e l'analisi avanzata dei junk costs arrivano nella Fase 5.
- Prezzi automatici (EODHD) e import dal broker: seconda parte della tappa I1.
- Il Face ID non è disponibile per le web app: si usa il PIN.
