// Rendimenti del portafoglio: TWR (rendimento della gestione), XIRR (rendimento dei tuoi soldi),
// variazioni per periodo, stima delle tasse sulle plusvalenze, confronto con un indice.
// Importi in centesimi; prezzi in centesimi per quota.
import type { Holding, InvestmentOp, PricePoint, TaxClass } from '../core/types';
import { addDays, addMonths, daysBetween } from '../core/dates';
import { positionAt } from './investments';

export interface PriceBook {
  /** prezzi storici per strumento, ordinati per data */
  by: Map<string, PricePoint[]>;
  ops: Map<string, InvestmentOp[]>;
  holdings: Holding[];
}

export function priceBook(holdings: Holding[], ops: InvestmentOp[], prices: PricePoint[]): PriceBook {
  const by = new Map<string, PricePoint[]>();
  for (const p of prices) by.set(p.holdingId, [...(by.get(p.holdingId) ?? []), p]);
  for (const arr of by.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  const o = new Map<string, InvestmentOp[]>();
  for (const x of ops) o.set(x.holdingId, [...(o.get(x.holdingId) ?? []), x]);
  for (const arr of o.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  return { by, ops: o, holdings };
}

/**
 * Prezzo noto a fine giornata `date`: il più recente tra prezzo storico e prezzo implicito di un'operazione,
 * altrimenti il prezzo attuale se è di quella data o precedente. `null` se non c'è nessun prezzo noto a quella data.
 */
export function priceOn(book: PriceBook, h: Holding, date: string): { price: number; date: string } | null {
  let best: { price: number; date: string } | null = null;
  for (const p of book.by.get(h.id) ?? []) {
    if (p.date > date) break;
    best = { price: p.price, date: p.date };
  }
  for (const o of book.ops.get(h.id) ?? []) {
    if (o.date > date) break;
    if ((o.kind === 'buy' || o.kind === 'sell') && o.quantity > 0 && (!best || o.date > best.date)) best = { price: o.amount / o.quantity, date: o.date };
  }
  if (h.price > 0 && h.priceDate <= date && (!best || h.priceDate > best.date)) best = { price: h.price, date: h.priceDate };
  return best;
}

/** Valore del portafoglio a fine giornata (dopo le operazioni del giorno) */
export function valueOn(book: PriceBook, date: string, ids?: Set<string>): number {
  let v = 0;
  for (const h of book.holdings) {
    if (ids && !ids.has(h.id)) continue;
    const q = positionAt(book.ops.get(h.id) ?? [], date).quantity;
    if (q <= 0) continue;
    const p = priceOn(book, h, date);
    if (p) v += q * p.price;
  }
  return v;
}

/** Flussi del giorno visti dal portafoglio: entrate (versamenti, costi pagati da fuori) e uscite (vendite, proventi incassati) */
function flowsOn(ops: InvestmentOp[], date: string) {
  let contrib = 0;
  let withdraw = 0;
  for (const o of ops) {
    if (o.date !== date) continue;
    const tx = o.taxes ?? 0;
    if (o.kind === 'buy') contrib += o.amount + o.fees + tx;
    else if (o.kind === 'sell') withdraw += o.amount - o.fees - tx;
    else if (o.kind === 'dividend' || o.kind === 'coupon') withdraw += o.amount - o.fees - tx;
    else if (o.kind === 'fee') contrib += o.amount + o.fees + tx;
    else if (o.kind === 'tax') contrib += o.amount + tx;
  }
  return { contrib, withdraw };
}

export interface PeriodResult {
  start: string;
  end: string;
  startValue: number;
  endValue: number;
  /** versamenti netti nel periodo (versamenti − prelievi, proventi inclusi come prelievi) */
  netFlows: number;
  /** guadagno in euro: valore finale − iniziale − flussi netti */
  gain: number;
  /** rendimento ponderato per il tempo (non dipende da quando hai versato) */
  twr: number | null;
  /** il periodo è più lungo della storia del portafoglio */
  partial: boolean;
}

/** Rendimento ponderato per il tempo tra `start` (fine giornata) e `end`, catena dei sottoperiodi tra un flusso e l'altro */
export function periodReturn(book: PriceBook, start: string, end: string, ids?: Set<string>): PeriodResult {
  const ops = [...book.ops.entries()].filter(([id]) => !ids || ids.has(id)).flatMap(([, o]) => o);
  const first = ops.reduce<string | null>((m, o) => (!m || o.date < m ? o.date : m), null);
  const dates = [...new Set(ops.map((o) => o.date).filter((d) => d > start && d <= end))].sort();
  let prev = valueOn(book, start, ids);
  const startValue = prev;
  let growth = 1;
  let any = false;
  let net = 0;
  const flowDates = new Set(dates);
  const points = dates.includes(end) ? dates : [...dates, end];
  for (const d of points) {
    const v = valueOn(book, d, ids);
    const f = flowDates.has(d) ? flowsOn(ops, d) : { contrib: 0, withdraw: 0 };
    // i flussi avvengono ai prezzi del giorno: ciò che resta dopo averli tolti è il rendimento di ciò che c'era già.
    // Al primo versamento (nulla prima) il riferimento è il versamento stesso, così le commissioni pesano.
    if (prev > 0) {
      growth *= (v - f.contrib + f.withdraw) / prev;
      any = true;
    } else if (f.contrib > 0) {
      growth *= (v + f.withdraw) / f.contrib;
      any = true;
    }
    net += f.contrib - f.withdraw;
    prev = v;
  }
  const endValue = valueOn(book, end, ids);
  return {
    start,
    end,
    startValue: Math.round(startValue),
    endValue: Math.round(endValue),
    netFlows: Math.round(net),
    gain: Math.round(endValue - startValue - net),
    twr: any ? growth - 1 : null,
    partial: !first || first > start
  };
}

/** Rendimento annuo effettivo (XIRR) dei flussi: importi negativi = soldi versati, positivi = soldi ricevuti */
export function xirr(flows: { date: string; amount: number }[]): number | null {
  if (flows.length < 2 || !flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const t0 = flows.reduce((m, f) => (f.date < m ? f.date : m), flows[0].date);
  const ts = flows.map((f) => ({ t: daysBetween(t0, f.date) / 365, a: f.amount }));
  const npv = (r: number) => ts.reduce((s, f) => s + f.a / Math.pow(1 + r, f.t), 0);
  // bisezione su un intervallo ampio: robusta anche quando Newton non converge
  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7 || hi - lo < 1e-10) return mid;
    if (fm * flo < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

/** Flussi dell'investitore fino a `end`, con il valore finale come incasso teorico */
export function investorFlows(book: PriceBook, end: string, ids?: Set<string>) {
  const flows: { date: string; amount: number }[] = [];
  for (const [id, ops] of book.ops) {
    if (ids && !ids.has(id)) continue;
    for (const o of ops) {
      if (o.date > end) continue;
      const tx = o.taxes ?? 0;
      if (o.kind === 'buy') flows.push({ date: o.date, amount: -(o.amount + o.fees + tx) });
      else if (o.kind === 'sell' || o.kind === 'dividend' || o.kind === 'coupon') flows.push({ date: o.date, amount: o.amount - o.fees - tx });
      else if (o.kind === 'fee') flows.push({ date: o.date, amount: -(o.amount + o.fees + tx) });
      else if (o.kind === 'tax') flows.push({ date: o.date, amount: -(o.amount + tx) });
    }
  }
  const v = valueOn(book, end, ids);
  if (v > 0) flows.push({ date: end, amount: v });
  return flows;
}

export type PeriodKey = '1G' | '1S' | '1M' | 'YTD' | '1A' | 'ALL';
export const PERIOD_LABEL: Record<PeriodKey, string> = { '1G': '1 giorno', '1S': '1 settimana', '1M': '1 mese', YTD: 'Da inizio anno', '1A': '1 anno', ALL: 'Dall’inizio' };

/** Data di partenza di ciascun periodo rispetto alla data dei prezzi più recenti */
export function periodStart(key: PeriodKey, asOf: string, book: PriceBook): string {
  if (key === '1G') {
    // giorno di borsa precedente: la data di prezzo più recente prima di asOf
    let found: string | null = null;
    for (const arr of book.by.values()) for (const p of arr) if (p.date < asOf && (!found || p.date > found)) found = p.date;
    return found ?? addDays(asOf, -1);
  }
  if (key === '1S') return addDays(asOf, -7);
  if (key === '1M') return addMonths(asOf, -1);
  if (key === 'YTD') return `${Number(asOf.slice(0, 4)) - 1}-12-31`;
  if (key === '1A') return addMonths(asOf, -12);
  let first = asOf;
  for (const arr of book.ops.values()) for (const o of arr) if (o.date < first) first = o.date;
  return addDays(first, -1);
}

/** Data dei prezzi più recenti tra gli strumenti posseduti oggi */
export function pricesAsOf(book: PriceBook, todayISO: string): string {
  let d: string | null = null;
  for (const h of book.holdings) {
    if (positionAt(book.ops.get(h.id) ?? [], todayISO).quantity <= 0) continue;
    const p = priceOn(book, h, todayISO);
    if (p && (!d || p.date > d)) d = p.date;
  }
  return d ?? todayISO;
}

export interface Mover {
  holding: Holding;
  changePct: number;
  /** effetto in euro sul portafoglio (quote attuali × variazione del prezzo) */
  impact: number;
  from: { price: number; date: string };
  to: { price: number; date: string };
}

/** Variazione di prezzo di ciascuno strumento posseduto tra due date (solo con prezzi distinti alle due date) */
export function movers(book: PriceBook, start: string, end: string): Mover[] {
  const out: Mover[] = [];
  for (const h of book.holdings) {
    const q = positionAt(book.ops.get(h.id) ?? [], end).quantity;
    if (q <= 0) continue;
    const a = priceOn(book, h, start);
    const b = priceOn(book, h, end);
    if (!a || !b || a.date === b.date || a.price <= 0) continue;
    out.push({ holding: h, changePct: b.price / a.price - 1, impact: Math.round(q * (b.price - a.price)), from: a, to: b });
  }
  return out.sort((x, y) => y.changePct - x.changePct);
}

export const TAX_RATE: Record<TaxClass, number> = { standard: 0.26, govt: 0.125, crypto: 0.33, pension: 0, none: 0 };

/** Stima delle tasse dovute vendendo oggi: aliquota sulle plusvalenze positive, senza compensare le minusvalenze */
export function latentTax(items: { taxClass: TaxClass; pnl: number }[]) {
  let tax = 0;
  let losses = 0;
  for (const i of items) {
    if (i.pnl > 0) tax += i.pnl * TAX_RATE[i.taxClass];
    else losses += -i.pnl;
  }
  return { tax: Math.round(tax), losses: Math.round(losses) };
}

/** Giorni dopo i quali un prezzo è considerato vecchio */
export function staleAfterDays(h: Holding): number | null {
  if (h.assetClass === 'pension') return 45;
  if (h.assetClass === 'cash' || h.assetClass === 'real_estate' || h.assetClass === 'other') return null;
  return 5;
}

/** Rendimento di una serie di prezzi (es. l'indice di confronto) tra due date; null se manca il prezzo iniziale */
export function seriesReturn(points: { date: string; price: number }[], start: string, end: string): number | null {
  let a: number | null = null;
  let b: number | null = null;
  for (const p of [...points].sort((x, y) => x.date.localeCompare(y.date))) {
    if (p.date <= start) a = p.price;
    if (p.date <= end) b = p.price;
  }
  if (a === null || b === null || a <= 0) return null;
  // il prezzo iniziale deve essere vicino alla data di partenza, altrimenti il confronto non è onesto
  const firstDate = points.reduce<string | null>((m, p) => (!m || p.date < m ? p.date : m), null);
  if (!firstDate || firstDate > start) return null;
  return b / a - 1;
}

/** TWR annualizzato quando il periodo supera un anno */
export function annualize(r: number | null, start: string, end: string): number | null {
  if (r === null) return null;
  const days = daysBetween(start, end);
  if (days < 365) return null;
  return Math.pow(1 + r, 365 / days) - 1;
}
