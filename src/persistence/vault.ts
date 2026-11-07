import { FinanceDB, type RecordRow } from './db';
import { checkVerifier, deriveKey, makeVerifier, open, randomBytes, seal, PBKDF2_ITERATIONS, type Sealed } from './crypto';
import { STORE_NAMES, type StoreMap, type StoreName } from '../core/types';
import { CURRENT_DATA_VERSION, migrate } from './migrations';

// Il "vault" tiene tutti i dati in memoria dopo lo sblocco e salva ogni modifica, cifrata, su IndexedDB.
// Con i volumi di un uso personale (decine di migliaia di movimenti) tutto sta comodamente in memoria.

export const DATA_VERSION = CURRENT_DATA_VERSION;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

interface Auth {
  salt: Uint8Array;
  iterations: number;
  verifier: Sealed;
}

type Maps = { [K in StoreName]: Map<string, StoreMap[K]> };
export type DataDump = { [K in StoreName]: StoreMap[K][] };

const emptyMaps = (): Maps => Object.fromEntries(STORE_NAMES.map((s) => [s, new Map()])) as unknown as Maps;

export class Vault {
  private db: FinanceDB;
  private key: CryptoKey | null = null;
  private maps: Maps = emptyMaps();
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private listeners = new Set<() => void>();
  version = 0;
  lastError: string | null = null;

  constructor(dbName?: string) {
    this.db = new FinanceDB(dbName);
  }

  // ---- stato ----
  get unlocked() {
    return this.key !== null;
  }
  get saving() {
    return this.pending > 0;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  async isInitialized(): Promise<boolean> {
    return (await this.db.meta.get('auth')) !== undefined;
  }

  // ---- PIN ----
  async setup(pin: string, seed: Partial<DataDump>): Promise<void> {
    if (await this.isInitialized()) throw new Error('Già inizializzato');
    const salt = randomBytes(16);
    const key = await deriveKey(pin, salt);
    const verifier = await makeVerifier(key);
    await this.db.meta.bulkPut([
      { key: 'auth', value: { salt, iterations: PBKDF2_ITERATIONS, verifier } satisfies Auth },
      { key: 'dataVersion', value: DATA_VERSION }
    ]);
    this.key = key;
    this.maps = emptyMaps();
    await this.writeAll(seed);
    this.emit();
  }

  /** Restituisce null se sbloccato, altrimenti un messaggio d'errore */
  async unlock(pin: string): Promise<string | null> {
    const lock = (await this.db.meta.get('lockout'))?.value as { attempts: number; until: number } | undefined;
    if (lock && lock.until > Date.now()) {
      return `Troppi tentativi. Riprova tra ${Math.ceil((lock.until - Date.now()) / 1000)} secondi.`;
    }
    const auth = (await this.db.meta.get('auth'))?.value as Auth | undefined;
    if (!auth) return 'Nessun archivio trovato.';
    const key = await deriveKey(pin, auth.salt, auth.iterations);
    if (!(await checkVerifier(key, auth.verifier))) {
      const attempts = (lock?.attempts ?? 0) + 1;
      const until = attempts >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0;
      await this.db.meta.put({ key: 'lockout', value: { attempts: attempts >= MAX_ATTEMPTS ? 0 : attempts, until } });
      return attempts >= MAX_ATTEMPTS ? 'PIN errato. App bloccata per 30 secondi.' : 'PIN errato.';
    }
    await this.db.meta.delete('lockout');
    const rows = await this.db.records.toArray();
    const maps = emptyMaps();
    for (const row of rows) {
      if (!(row.store in maps)) continue;
      const value = await open(key, { iv: row.iv, data: row.data });
      (maps[row.store as StoreName] as Map<string, unknown>).set(row.id, value);
    }
    this.key = key;
    this.maps = maps;
    // Conversione automatica dei dati salvati con una versione precedente dell'app
    const stored = ((await this.db.meta.get('dataVersion'))?.value as number | undefined) ?? 1;
    if (stored < DATA_VERSION) {
      await this.replaceAll(migrate(this.dump(), stored));
      await this.db.meta.put({ key: 'dataVersion', value: DATA_VERSION });
    }
    this.emit();
    return null;
  }

  lock() {
    this.key = null;
    this.maps = emptyMaps();
    this.emit();
  }

  async verifyPin(pin: string): Promise<boolean> {
    const auth = (await this.db.meta.get('auth'))?.value as Auth | undefined;
    if (!auth) return false;
    return checkVerifier(await deriveKey(pin, auth.salt, auth.iterations), auth.verifier);
  }

  async changePin(oldPin: string, newPin: string): Promise<string | null> {
    const auth = (await this.db.meta.get('auth'))?.value as Auth | undefined;
    if (!auth || !this.key) return 'Archivio non sbloccato.';
    const oldKey = await deriveKey(oldPin, auth.salt, auth.iterations);
    if (!(await checkVerifier(oldKey, auth.verifier))) return 'Il PIN attuale non è corretto.';
    const salt = randomBytes(16);
    const key = await deriveKey(newPin, salt);
    const rows = await this.sealAll(key, this.dump());
    const verifier = await makeVerifier(key);
    await this.flush();
    await this.db.transaction('rw', this.db.meta, this.db.records, async () => {
      await this.db.records.clear();
      await this.db.records.bulkPut(rows);
      await this.db.meta.put({ key: 'auth', value: { salt, iterations: PBKDF2_ITERATIONS, verifier } satisfies Auth });
    });
    this.key = key;
    return null;
  }

  // ---- lettura ----
  list<K extends StoreName>(store: K): StoreMap[K][] {
    return [...this.maps[store].values()];
  }

  get<K extends StoreName>(store: K, id: string): StoreMap[K] | undefined {
    return this.maps[store].get(id);
  }

  dump(): DataDump {
    return Object.fromEntries(STORE_NAMES.map((s) => [s, this.list(s)])) as unknown as DataDump;
  }

  // ---- scrittura (salvataggio automatico a ogni modifica) ----
  put<K extends StoreName>(store: K, value: StoreMap[K] & { id: string }): void {
    this.putMany(store, [value]);
  }

  putMany<K extends StoreName>(store: K, values: (StoreMap[K] & { id: string })[]): void {
    if (!this.key || values.length === 0) return;
    const map = this.maps[store] as Map<string, StoreMap[K]>;
    for (const v of values) map.set(v.id, structuredClone(v));
    const key = this.key;
    this.enqueue(async () => {
      const rows: RecordRow[] = [];
      for (const v of values) {
        const s = await seal(key, v);
        rows.push({ store, id: v.id, iv: s.iv, data: s.data });
      }
      await this.db.records.bulkPut(rows);
    });
    this.emit();
  }

  remove(store: StoreName, ids: string | string[]): void {
    const list = Array.isArray(ids) ? ids : [ids];
    if (!this.key || list.length === 0) return;
    for (const id of list) this.maps[store].delete(id);
    this.enqueue(() => this.db.records.bulkDelete(list.map((id) => [store, id] as [string, string])));
    this.emit();
  }

  /** Sostituisce l'intero archivio (ripristino da backup) */
  async replaceAll(data: Partial<DataDump>): Promise<void> {
    if (!this.key) throw new Error('Archivio bloccato');
    await this.flush();
    const rows = await this.sealAll(this.key, data);
    await this.db.transaction('rw', this.db.records, async () => {
      await this.db.records.clear();
      await this.db.records.bulkPut(rows);
    });
    const maps = emptyMaps();
    for (const s of STORE_NAMES) for (const v of data[s] ?? []) (maps[s] as Map<string, unknown>).set((v as { id: string }).id, v);
    this.maps = maps;
    this.emit();
  }

  /** Cancella tutto, PIN compreso */
  async wipe(): Promise<void> {
    await this.flush();
    await this.db.transaction('rw', this.db.meta, this.db.records, async () => {
      await this.db.records.clear();
      await this.db.meta.clear();
    });
    this.lock();
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  // ---- interni ----
  private async writeAll(data: Partial<DataDump>) {
    if (!this.key) return;
    const rows = await this.sealAll(this.key, data);
    await this.db.records.bulkPut(rows);
    for (const s of STORE_NAMES) for (const v of data[s] ?? []) (this.maps[s] as Map<string, unknown>).set((v as { id: string }).id, v);
  }

  private async sealAll(key: CryptoKey, data: Partial<DataDump>): Promise<RecordRow[]> {
    const rows: RecordRow[] = [];
    for (const s of STORE_NAMES) {
      for (const v of data[s] ?? []) {
        const sealed = await seal(key, v);
        rows.push({ store: s, id: (v as { id: string }).id, iv: sealed.iv, data: sealed.data });
      }
    }
    return rows;
  }

  private enqueue(job: () => Promise<unknown>) {
    this.pending++;
    this.queue = this.queue
      .then(job)
      .then(() => {
        this.lastError = null;
      })
      .catch((e: unknown) => {
        // Un errore di scrittura non deve bloccare la coda: viene mostrato all'utente.
        this.lastError = e instanceof Error ? e.message : String(e);
        console.error('Errore di salvataggio', e);
      })
      .finally(() => {
        this.pending--;
        if (this.pending === 0) this.emit();
      });
  }
}

export const vault = new Vault();
