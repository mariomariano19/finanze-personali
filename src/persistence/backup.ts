import { deriveKey, fromBase64, open, randomBytes, seal, toBase64, PBKDF2_ITERATIONS } from './crypto';
import type { DataDump } from './vault';
import { DATA_VERSION } from './vault';
import type { Category, Transaction, Account } from '../core/types';
import { STORE_NAMES } from '../core/types';
import { migrate } from './migrations';

// Backup = un file JSON con tutti i dati cifrati (AES-GCM) con il PIN. Si salva in File / iCloud Drive.

export interface BackupFile {
  format: 'finanze-personali-backup';
  formatVersion: 1;
  dataVersion: number;
  createdAt: string;
  counts: Record<string, number>;
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  iv: string;
  data: string;
}

export async function createBackup(dump: DataDump, pin: string): Promise<BackupFile> {
  const salt = randomBytes(16);
  const key = await deriveKey(pin, salt);
  const sealed = await seal(key, dump);
  return {
    format: 'finanze-personali-backup',
    formatVersion: 1,
    dataVersion: DATA_VERSION,
    createdAt: new Date().toISOString(),
    counts: Object.fromEntries(STORE_NAMES.map((s) => [s, dump[s].length])),
    kdf: { name: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: toBase64(salt) },
    iv: toBase64(sealed.iv),
    data: toBase64(sealed.data)
  };
}

export function parseBackup(text: string): BackupFile {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Il file non è un backup valido.');
  }
  const b = obj as Partial<BackupFile>;
  if (b.format !== 'finanze-personali-backup' || !b.kdf || !b.iv || !b.data) throw new Error('Il file non è un backup di questa app.');
  if ((b.dataVersion ?? 0) > DATA_VERSION) throw new Error('Il backup è stato creato da una versione più recente dell’app. Aggiorna l’app e riprova.');
  return b as BackupFile;
}

/** Decifra un backup; null se il PIN è errato */
export async function openBackup(b: BackupFile, pin: string): Promise<DataDump | null> {
  const key = await deriveKey(pin, fromBase64(b.kdf.salt), b.kdf.iterations);
  try {
    const raw = await open<Partial<DataDump>>(key, { iv: fromBase64(b.iv), data: fromBase64(b.data).buffer as ArrayBuffer });
    for (const s of STORE_NAMES) if (!Array.isArray(raw[s])) (raw as Record<string, unknown[]>)[s] = [];
    // un backup creato con una versione precedente viene convertito al modello attuale
    return migrate(raw, b.dataVersion ?? 1);
  } catch {
    return null;
  }
}

export function backupFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `finanze-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Esporta i movimenti in CSV (separatore ; e virgola decimale, come Excel in italiano). NON cifrato. */
export function transactionsCSV(txs: Transaction[], cats: Category[], accs: Account[]): string {
  const catById = new Map(cats.map((c) => [c.id, c]));
  const accById = new Map(accs.map((a) => [a.id, a.name]));
  const typeLabel = { income: 'Ricavo', expense: 'Costo', transfer: 'Giroconto' } as const;
  const header = ['Data', 'Tipo', 'Importo', 'Categoria', 'Sottocategoria', 'Descrizione', 'Esercente', 'Conto', 'Fonte'];
  const lines = [header.join(';')];
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date))) {
    const c = t.categoryId ? catById.get(t.categoryId) : undefined;
    const parent = c?.parentId ? catById.get(c.parentId) : undefined;
    const signed = t.type === 'expense' ? -t.amount : t.amount;
    lines.push(
      [
        t.date,
        typeLabel[t.type],
        (signed / 100).toFixed(2).replace('.', ','),
        parent ? parent.name : (c?.name ?? ''),
        parent ? c!.name : '',
        t.description,
        t.merchant ?? '',
        t.accountId ? (accById.get(t.accountId) ?? '') : '',
        t.source
      ]
        .map(csvCell)
        .join(';')
    );
  }
  return '﻿' + lines.join('\n');
}

/** Salva un file: su iPhone apre il foglio di condivisione ("Salva su File" → iCloud Drive), altrimenti scarica. */
export async function saveFile(name: string, content: string, mime: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([content], name, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
