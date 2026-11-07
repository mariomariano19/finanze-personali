// Tipi dei dati Intelligence (prodotti dal motore) e metriche del registro delle previsioni.

export interface Sourced {
  source?: string;
  url?: string;
  asOf?: string;
  status?: string;
}

export interface MarketItem extends Sourced {
  name: string;
  value?: number;
  decimals?: number;
  unit?: string;
  changePct?: number;
}

export interface Scenario {
  p: number;
  text?: string;
}

export interface Opportunity {
  name: string;
  ticker?: string;
  category?: string;
  price?: number;
  currency?: string;
  priceSource?: string;
  priceUrl?: string;
  priceAsOf?: string;
  priceStatus?: string;
  reason?: string;
  potential?: string;
  risks?: string;
  horizon?: string;
  scenarios?: { up?: Scenario; neutral?: Scenario; down?: Scenario };
  news?: { title: string; url: string }[];
  predictionId?: string;
  predictionSeq?: number;
}

export interface NewsItem {
  title: string;
  source?: string;
  url?: string;
  publishedAt?: string;
  summary?: string;
  impact?: string;
  affected?: string;
  horizon?: string;
  relevance?: string;
  confirmed?: boolean;
}

export interface Briefing {
  date: string;
  createdAt?: string;
  headline?: string;
  dataNote?: string;
  markets?: MarketItem[];
  opportunities?: Opportunity[];
  news?: NewsItem[];
  day?: { favored?: string[]; penalized?: string[]; watch?: string[]; calendar?: ({ time?: string; event: string } | string)[]; volatility?: string[] };
  alerts?: { title: string; text?: string; url?: string }[];
  watchlist?: {
    highlights?: { name: string; ticker?: string; itemId?: string; text: string; changePct?: number; source?: string; url?: string; asOf?: string }[];
    quiet?: string[];
    note?: string;
  };
}

export interface IntelIndex {
  latest: string | null;
  briefings: { date: string; headline?: string }[];
  updatedAt?: string;
}

export type Cls = 'up' | 'neutral' | 'down';

export interface Prediction {
  id: string;
  seq: number;
  createdAt: string;
  briefingDate?: string;
  instrument: string;
  ticker?: string;
  category?: string;
  horizonLabel?: string;
  horizonDays?: number;
  neutralBandPct?: number;
  refPrice: number;
  currency?: string;
  refPriceSource?: string;
  refPriceUrl?: string;
  refPriceAsOf?: string;
  probs: Record<Cls, number>;
  expectedReturnPct?: number;
  rationale?: string;
  sources?: string[];
  method?: string;
  prevHash: string;
  hash: string;
}

export interface Outcome {
  predictionId: string;
  checkedAt: string;
  expiryDate?: string;
  finalPrice?: number;
  finalPriceAsOf?: string;
  finalPriceSource?: string;
  finalPriceUrl?: string;
  dividends?: { exDate: string; amount: number; source?: string; url?: string }[];
  dividendsChecked?: boolean;
  priceReturnPct?: number;
  totalReturnPct?: number;
  /** rendimento usato per l'esito (totale, dividendi inclusi) */
  actualReturnPct?: number;
  realized?: Cls;
  result: 'correct' | 'wrong' | 'inconclusive';
  brier?: number;
  rule?: string;
  note?: string;
  seq?: number;
  prevHash?: string;
  hash?: string;
}

export const CLS_LABEL: Record<Cls, string> = { up: 'rialzo', neutral: 'neutrale', down: 'ribasso' };

// ---------- schede aziendali ----------
export interface DossierSource {
  name: string;
  url?: string;
}

export interface DossierSection {
  key: string;
  title: string;
  asOf?: string;
  text?: string;
  facts?: { label: string; value: string; note?: string }[];
  table?: { unit?: string; columns: string[]; rows: { label: string; values: string[] }[] };
  bullets?: string[];
  sources?: DossierSource[];
  missing?: string;
}

export interface Dossier {
  itemId: string;
  name: string;
  ticker?: string;
  updatedAt?: string;
  fullReviewAt?: string | null;
  summary?: string;
  price?: { value?: number; currency?: string; changePct?: number; asOf?: string; source?: string; url?: string; status?: string };
  sections?: DossierSection[];
  news?: { title: string; url?: string; source?: string; date?: string; summary?: string }[];
  missing?: string[];
}

export interface DossierIndex {
  items: Record<string, { name: string; updatedAt?: string; fullReviewAt?: string | null; summary?: string }>;
  updatedAt?: string;
}

/** Categorie della watchlist che non sono aziende (niente scheda) */
export const NOT_COMPANY = ['Indici', 'Titoli di Stato', 'ETF', 'Materie prime'];

export interface WatchItem {
  id: string;
  name: string;
  ticker?: string;
  category: string;
  region?: string;
  addedAt?: string;
}

export interface InvestorProfile {
  capital?: string;
  horizon?: string;
  risk?: string;
  maxLoss?: string;
  liquidity?: string;
  style?: string;
  objectives?: string[];
  sectors?: string[];
  areas?: string[];
  exclusions?: string;
  updatedAt?: string;
}

export const WATCH_CATEGORIES = ['Indici', 'Tecnologia', 'Banche', 'Energia', 'Difesa', 'Infrastrutture', 'Titoli di Stato', 'ETF', 'Materie prime', 'Altro'];

const CLASSES: Cls[] = ['up', 'neutral', 'down'];
const topClass = (p: Record<Cls, number>) => [...CLASSES].sort((a, b) => (p[b] || 0) - (p[a] || 0))[0];
export const brier = (p: Record<Cls, number>, realized: Cls) => CLASSES.reduce((s, c) => s + Math.pow((p[c] || 0) - (c === realized ? 1 : 0), 2), 0);
export const BASELINE_BRIER = brier({ up: 1 / 3, neutral: 1 / 3, down: 1 / 3 }, 'up');

export interface Group {
  n: number;
  hit: number;
  brier: number;
}

export function trackerMetrics(preds: Prediction[], outcomes: Outcome[]) {
  const byId = new Map(outcomes.map((o) => [o.predictionId, o]));
  const closed = preds.map((p) => ({ p, o: byId.get(p.id) })).filter((x): x is { p: Prediction; o: Outcome & { realized: Cls } } => !!x.o && x.o.result !== 'inconclusive' && !!x.o.realized);
  const inconclusive = preds.filter((p) => byId.get(p.id)?.result === 'inconclusive').length;
  const open = preds.filter((p) => !byId.has(p.id)).length;
  let b = 0;
  let dir = 0;
  let mae = 0;
  let maeN = 0;
  const byCat: Record<string, Group> = {};
  const byHor: Record<string, Group> = {};
  const bins = [0, 0.2, 0.4, 0.6, 0.8].map((lo) => ({ lo, hi: lo + 0.2, n: 0, sumP: 0, hits: 0 }));
  for (const { p, o } of closed) {
    const bs = brier(p.probs, o.realized);
    const hit = topClass(p.probs) === o.realized ? 1 : 0;
    b += bs;
    dir += hit;
    if (typeof p.expectedReturnPct === 'number' && typeof o.actualReturnPct === 'number') {
      mae += Math.abs(p.expectedReturnPct - o.actualReturnPct);
      maeN++;
    }
    for (const [map, k] of [[byCat, p.category || 'n.d.'], [byHor, p.horizonLabel || 'n.d.']] as const) {
      const g = (map[k] ??= { n: 0, hit: 0, brier: 0 });
      g.n++;
      g.hit += hit;
      g.brier += bs;
    }
    for (const c of CLASSES) {
      const pr = p.probs[c] || 0;
      const bin = bins.find((x) => pr >= x.lo && (pr < x.hi || x.hi >= 1));
      if (!bin) continue;
      bin.n++;
      bin.sumP += pr;
      if (o.realized === c) bin.hits++;
    }
  }
  const n = closed.length;
  return { total: preds.length, open, inconclusive, n, brier: n ? b / n : null, dir: n ? dir / n : null, mae: maeN ? mae / maeN : null, byCat, byHor, bins };
}

export const safeUrl = (u?: string) => (u && /^https:\/\//i.test(u) ? u : undefined);
