// Import dei pagamenti Apple Pay registrati dall'automazione "Transazione" di Comandi.
// Ogni pagamento è una riga di un file di testo in iCloud Drive, in uno di questi formati:
//   <data>;<importo>;<esercente>;<carta>        (consigliato: la data come la scrive l'iPhone)
//   FP1|<data ISO 8601>|<importo>|<esercente>|<carta>
// L'import è idempotente: l'id del movimento deriva dal contenuto della riga.
import type { Settings, Transaction } from '../core/types';
import { daysBetween } from '../core/dates';

export interface ApEntry {
  id: string;
  raw: string;
  date: string; // YYYY-MM-DD
  amount: number; // centesimi, positivo
  refund: boolean;
  merchant: string;
  card: string;
}

/** FNV-1a a 64 bit, in esadecimale: impronta stabile della riga */
export function lineHash(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(s)) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/** "12,50 €", "€12.50", "1.234,56 EUR", "-3,20", "12.5" → centesimi (null se non è un importo) */
export function parseAmount(s: string): number | null {
  let t = s.replace(/[^\d,.\-−]/g, '').replace('−', '-');
  if (!/\d/.test(t)) return null;
  const neg = t.startsWith('-');
  t = t.replace(/-/g, '');
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  let intPart = t;
  let dec = '';
  const sep = Math.max(lastComma, lastDot);
  // separatore decimale = l'ultimo seguito da 1 o 2 cifre
  if (sep >= 0 && t.length - sep - 1 <= 2) {
    intPart = t.slice(0, sep);
    dec = t.slice(sep + 1);
  }
  intPart = intPart.replace(/[.,]/g, '');
  const cents = Number(intPart || '0') * 100 + Number((dec + '00').slice(0, 2));
  if (!isFinite(cents)) return null;
  return neg ? -cents : cents;
}

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Data ISO, "gg/mm/aaaa", "8 nov 2026 alle 11:15", "8 novembre 2026", "Nov 8, 2026" → YYYY-MM-DD */
export function parseDate(s: string): string | null {
  const t = s.trim();
  const named = t.toLowerCase().match(/(\d{1,2})\s+([a-zà-ù]{3,})\.?\s+(\d{4})/);
  if (named) {
    const k = named[2].slice(0, 3);
    const m = MESI.indexOf(k) >= 0 ? MESI.indexOf(k) : MONTHS.indexOf(k);
    if (m >= 0) return `${named[3]}-${String(m + 1).padStart(2, '0')}-${named[1].padStart(2, '0')}`;
  }
  const en = t.toLowerCase().match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (en && MONTHS.indexOf(en[1]) >= 0) return `${en[3]}-${String(MONTHS.indexOf(en[1]) + 1).padStart(2, '0')}-${en[2].padStart(2, '0')}`;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const it = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (it) {
    const y = it[3].length === 2 ? `20${it[3]}` : it[3];
    return `${y}-${it[2].padStart(2, '0')}-${it[1].padStart(2, '0')}`;
  }
  return null;
}

export function parseApplePay(text: string): { entries: ApEntry[]; skipped: string[] } {
  const entries: ApEntry[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    let parts = raw.split(raw.includes('|') ? '|' : ';').map((x) => x.trim());
    if (parts[0] === 'FP1') parts = parts.slice(1);
    if (parts.length < 3) {
      skipped.push(raw);
      continue;
    }
    const date = parseDate(parts[0]);
    const amt = parseAmount(parts[1]);
    if (!date || amt === null || amt === 0) {
      skipped.push(raw);
      continue;
    }
    const id = 'ap-' + lineHash(raw);
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, raw, date, amount: Math.abs(amt), refund: amt < 0, merchant: parts[2] || 'Pagamento Apple Pay', card: parts[3] ?? '' });
  }
  return { entries, skipped };
}

/** Esercente normalizzato per riconoscerlo la volta dopo: "ESSELUNGA S.P.A. 1234" → "esselunga" */
export function normMerchant(m: string): string {
  return m
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(s\.?p\.?a\.?|s\.?r\.?l\.?s?|s\.?n\.?c\.?|s\.?a\.?s\.?|ltd|inc|gmbh|sa)\b/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function categorize(merchant: string, s: Pick<Settings, 'merchantRules' | 'keywordRules'>): { categoryId: string | null; known: boolean } {
  const n = normMerchant(merchant);
  const learned = s.merchantRules?.[n];
  if (learned) return { categoryId: learned, known: true };
  const low = merchant.toLowerCase();
  for (const r of s.keywordRules ?? []) if (r.contains.trim() && low.includes(r.contains.trim().toLowerCase())) return { categoryId: r.categoryId, known: true };
  return { categoryId: null, known: false };
}

/** Un movimento già presente con lo stesso importo, tipo e data entro 3 giorni (escluso lo stesso import) */
export function findDup(e: Pick<ApEntry, 'id' | 'date' | 'amount' | 'refund'>, txs: Transaction[]): Transaction | null {
  const type = e.refund ? 'income' : 'expense';
  let best: Transaction | null = null;
  for (const t of txs) {
    if (t.id === e.id || t.type !== type || t.amount !== e.amount) continue;
    if (Math.abs(daysBetween(t.date, e.date)) > 3) continue;
    if (t.source === 'wallet' && t.id.startsWith('ap-')) continue; // due pagamenti Apple Pay uguali sono due pagamenti
    if (!best || Math.abs(daysBetween(t.date, e.date)) < Math.abs(daysBetween(best.date, e.date))) best = t;
  }
  return best;
}

export interface ImportPlan {
  add: Transaction[];
  already: number;
  skipped: string[];
  duplicates: number;
  autoConfirmed: number;
}

/** Prepara i movimenti da aggiungere: nuovi, categorizzati, da confermare (o confermati se l'esercente è noto e l'opzione è attiva) */
export function planImport(text: string, txs: Transaction[], s: Settings, accounts: { id: string; name: string; kind: string; hidden?: boolean }[], nowISO: string): ImportPlan {
  const { entries, skipped } = parseApplePay(text);
  const have = new Set([...txs.map((t) => t.id), ...(s.apIgnored ?? [])]);
  const add: Transaction[] = [];
  let already = 0;
  let duplicates = 0;
  let autoConfirmed = 0;
  const cardAcc = (card: string) => {
    if (s.cardRules?.[card]) return s.cardRules[card];
    const c = card.toLowerCase();
    const byName = accounts.find((a) => !a.hidden && c && (a.name.toLowerCase().includes(c) || c.includes(a.name.toLowerCase())));
    return byName?.id ?? accounts.find((a) => !a.hidden && a.kind === 'card')?.id ?? null;
  };
  for (const e of entries) {
    if (have.has(e.id)) {
      already++;
      continue;
    }
    const { categoryId, known } = e.refund ? { categoryId: null, known: false } : categorize(e.merchant, s);
    const dup = findDup(e, [...txs, ...add]);
    if (dup) duplicates++;
    const confirm = Boolean(s.autoConfirmKnown && known && !dup && categoryId);
    if (confirm) autoConfirmed++;
    add.push({
      id: e.id,
      type: e.refund ? 'income' : 'expense',
      amount: e.amount,
      date: e.date,
      categoryId,
      description: e.refund ? `Rimborso ${e.merchant}` : '',
      merchant: e.merchant,
      accountId: cardAcc(e.card),
      source: 'wallet',
      card: e.card || undefined,
      needsReview: !confirm,
      ...(dup ? { dupOf: dup.id } : {}),
      createdAt: nowISO,
      updatedAt: nowISO
    });
  }
  return { add, already, skipped, duplicates, autoConfirmed };
}

/** Dopo una conferma: impara esercente → categoria e carta → conto */
export function learn(s: Settings, t: Pick<Transaction, 'merchant' | 'categoryId' | 'card' | 'accountId' | 'type'>): Partial<Settings> | null {
  const patch: Partial<Settings> = {};
  if (t.type === 'expense' && t.merchant && t.categoryId) {
    const n = normMerchant(t.merchant);
    if (n && s.merchantRules?.[n] !== t.categoryId) patch.merchantRules = { ...(s.merchantRules ?? {}), [n]: t.categoryId };
  }
  if (t.card && t.accountId && s.cardRules?.[t.card] !== t.accountId) patch.cardRules = { ...(s.cardRules ?? {}), [t.card]: t.accountId };
  return Object.keys(patch).length ? patch : null;
}
