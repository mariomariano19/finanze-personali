import Dexie, { type Table } from 'dexie';

// Database IndexedDB. Ogni record è cifrato singolarmente: in chiaro restano solo il tipo di archivio e l'id.

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface RecordRow {
  store: string;
  id: string;
  iv: Uint8Array;
  data: ArrayBuffer;
}

export class FinanceDB extends Dexie {
  meta!: Table<MetaRow, string>;
  records!: Table<RecordRow, [string, string]>;

  constructor(name = 'finanze-personali') {
    super(name);
    // Versione 1 dello schema IndexedDB. Ogni modifica futura aggiunge un nuovo .version(n) con migrazione.
    this.version(1).stores({
      meta: 'key',
      records: '[store+id], store'
    });
  }
}
