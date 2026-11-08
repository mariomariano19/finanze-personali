// Modello dati. Tutti gli importi sono in CENTESIMI di euro (interi), mai numeri decimali.

export type TxType = 'income' | 'expense' | 'transfer';
export type Nature = 'fixed' | 'variable' | 'occasional';
export type Need = 'necessary' | 'discretionary';
export type Source = 'manual' | 'recurring' | 'wallet' | 'csv' | 'bank';

export interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  parentId: string | null; // null = macro-categoria
  icon: string;
  nature: Nature;
  need: Need;
  hidden?: boolean;
  order: number;
}

export interface Transaction {
  id: string;
  type: TxType;
  amount: number; // centesimi, sempre positivo
  date: string; // YYYY-MM-DD
  categoryId: string | null;
  description: string;
  merchant?: string;
  accountId: string | null;
  toAccountId?: string | null; // solo giroconti
  source: Source;
  recurringId?: string;
  nature?: Nature; // sovrascrive quella della categoria
  need?: Need;
  needsReview?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Account {
  id: string;
  name: string;
  kind: 'checking' | 'card' | 'cash' | 'savings' | 'other';
  hidden?: boolean;
}

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringRule {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  categoryId: string | null;
  description: string;
  accountId: string | null;
  frequency: Frequency;
  startDate: string; // prima occorrenza
  endDate?: string | null;
  lastGenerated?: string | null; // ultima data generata
  active: boolean;
}

export type AssetClass = 'stock' | 'etf' | 'bond' | 'fund' | 'crypto' | 'cash' | 'real_estate' | 'pension' | 'other';

/** Classi fiscali italiane (regole 2026). La tabella con le aliquote per anno arriva nella tappa I3. */
export type TaxClass = 'standard' | 'govt' | 'crypto' | 'pension' | 'none';

/** Intermediario: broker, banca, fondo pensione… (modello dati v2) */
export interface Broker {
  id: string;
  name: string;
  kind: 'broker' | 'bank' | 'pension' | 'exchange' | 'other';
  country: string; // codice ISO, es. IT
  taxRegime: 'administered' | 'declared';
  notes?: string;
  hidden?: boolean;
}

/** Strumento o bene (nome storico "Holding" mantenuto per compatibilità dei dati) */
export interface Holding {
  id: string;
  name: string;
  assetClass: AssetClass;
  symbol?: string; // ticker, es. VWCE.XETRA o AAPL.US
  isin?: string;
  exchange?: string; // borsa di quotazione
  taxClass?: TaxClass;
  distribution?: 'acc' | 'dist';
  price: number; // ultimo prezzo unitario in centesimi (può avere decimali)
  priceDate: string;
  priceSource?: 'manual' | 'operation' | 'api' | 'import';
  details?: {
    rate?: number; // conto deposito: tasso annuo lordo %
    maturity?: string; // conto deposito: scadenza
    locked?: boolean; // conto deposito vincolato
    debt?: number; // immobile: debito residuo collegato (centesimi)
    fundLine?: string; // fondo pensione: comparto
  };
  notes?: string;
  archived?: boolean;
}

export type OpKind = 'buy' | 'sell' | 'dividend' | 'coupon' | 'fee' | 'tax' | 'split';

export const OP_KIND_LABEL: Record<OpKind, string> = {
  buy: 'Acquisto',
  sell: 'Vendita',
  dividend: 'Dividendo',
  coupon: 'Cedola',
  fee: 'Costo o commissione',
  tax: 'Tassa o imposta',
  split: 'Frazionamento'
};

/**
 * Operazione su uno strumento, sempre in EUR (scelta I-D6).
 * - buy/sell: quantity = quote, amount = controvalore (commissioni escluse)
 * - dividend/coupon: amount = importo lordo, taxes = ritenute
 * - fee/tax: amount = importo
 * - split: quantity = quote aggiunte (negative se raggruppamento), amount = 0
 */
export interface InvestmentOp {
  id: string;
  holdingId: string;
  brokerId?: string | null;
  kind: OpKind;
  date: string;
  quantity: number;
  amount: number; // centesimi
  fees: number; // centesimi
  taxes?: number; // centesimi trattenuti dal broker (regime amministrato)
  externalId?: string; // id dell'operazione nel file del broker (deduplicazione import)
  source?: 'manual' | 'import';
  note?: string;
}

export interface PricePoint {
  id: string; // holdingId + data
  holdingId: string;
  date: string;
  price: number;
}

export interface Settings {
  id: 'settings';
  savingsGoal: number; // percentuale
  autoLockMinutes: number;
  lastBackupAt: string | null;
  backupReminderDays: number;
  createdAt: string;
  /** Collegamento all'Intelligence: chiave di cifratura, token GitHub e deposito (salvati cifrati con il PIN) */
  intel?: { key?: string; token?: string; repo?: string; branch?: string; trackedHash?: string };
}

/** Copia locale dei dati Intelligence, per consultarli anche senza rete */
export interface IntelCache {
  id: 'cache';
  fetchedAt: string;
  index: unknown;
  briefings: Record<string, unknown>;
  predictions: unknown[];
  outcomes: unknown[];
  watchlist: unknown[];
  profile: unknown;
}

export interface MonthlySnapshot {
  id: string; // YYYY-MM
  createdAt: string;
  data: unknown;
}

export interface StoreMap {
  tx: Transaction;
  cat: Category;
  acc: Account;
  rec: RecurringRule;
  hold: Holding;
  brk: Broker;
  op: InvestmentOp;
  price: PricePoint;
  report: MonthlySnapshot;
  settings: Settings;
  intel: IntelCache;
}

export type StoreName = keyof StoreMap;
export const STORE_NAMES: StoreName[] = ['tx', 'cat', 'acc', 'rec', 'hold', 'brk', 'op', 'price', 'report', 'settings', 'intel'];

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  etf: 'ETF',
  stock: 'Azioni',
  bond: 'Obbligazioni',
  fund: 'Fondi comuni',
  crypto: 'Criptovalute',
  cash: 'Conti deposito',
  real_estate: 'Immobili',
  pension: 'Fondo pensione',
  other: 'Altro'
};

/** Beni non quotati: si valutano con un valore complessivo (quantità 1) */
export const NON_LISTED: AssetClass[] = ['cash', 'real_estate', 'pension', 'other'];

export const TAX_CLASS_LABEL: Record<TaxClass, string> = {
  standard: 'Ordinaria (26%)',
  govt: 'Titoli di Stato e white list (12,5%)',
  crypto: 'Cripto-attività (33% dal 2026)',
  pension: 'Fondo pensione (tassazione propria)',
  none: 'Non tassato / non applicabile'
};

export function defaultTaxClass(c: AssetClass): TaxClass {
  if (c === 'crypto') return 'crypto';
  if (c === 'pension') return 'pension';
  if (c === 'real_estate' || c === 'other') return 'none';
  return 'standard';
}

export const NATURE_LABEL: Record<Nature, string> = { fixed: 'Fissa', variable: 'Variabile', occasional: 'Occasionale' };
export const NEED_LABEL: Record<Need, string> = { necessary: 'Necessaria', discretionary: 'Discrezionale' };
export const SOURCE_LABEL: Record<Source, string> = {
  manual: 'Manuale',
  recurring: 'Ricorrente',
  wallet: 'Wallet',
  csv: 'CSV',
  bank: 'Banca'
};
