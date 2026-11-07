import type { Category, Nature, Need, Transaction } from '../core/types';
import { inPeriod, lastMonths, monthKey, type Period } from '../core/dates';

export type CatMap = Map<string, Category>;

export const catMapOf = (cats: Category[]): CatMap => new Map(cats.map((c) => [c.id, c]));

export function macroOf(catId: string | null, cats: CatMap): Category | undefined {
  if (!catId) return undefined;
  const c = cats.get(catId);
  if (!c) return undefined;
  return c.parentId ? (cats.get(c.parentId) ?? c) : c;
}

export function natureOf(t: Transaction, cats: CatMap): Nature {
  if (t.nature) return t.nature;
  if (t.recurringId) return 'fixed';
  return (t.categoryId && cats.get(t.categoryId)?.nature) || 'variable';
}

export function needOf(t: Transaction, cats: CatMap): Need {
  return t.need ?? ((t.categoryId && cats.get(t.categoryId)?.need) || 'necessary');
}

export interface Totals {
  income: number;
  expense: number;
  balance: number;
  savingsRate: number | null; // (ricavi - costi) / ricavi
}

export function totals(txs: Transaction[], p: Pick<Period, 'start' | 'end'>): Totals {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (!inPeriod(t.date, p)) continue;
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
  }
  return { income, expense, balance: income - expense, savingsRate: income > 0 ? (income - expense) / income : null };
}

export interface Slice {
  id: string;
  name: string;
  icon: string;
  amount: number;
  count: number;
}

/** Totali per macro-categoria (o per categoria, con byLeaf) ordinati per importo */
export function byCategory(txs: Transaction[], kind: 'income' | 'expense', p: Pick<Period, 'start' | 'end'>, cats: CatMap, byLeaf = false): Slice[] {
  const acc = new Map<string, Slice>();
  for (const t of txs) {
    if (t.type !== kind || !inPeriod(t.date, p)) continue;
    const c = byLeaf ? (t.categoryId ? cats.get(t.categoryId) : undefined) : macroOf(t.categoryId, cats);
    const id = c?.id ?? 'none';
    const s = acc.get(id) ?? { id, name: c?.name ?? 'Senza categoria', icon: c?.icon ?? 'dots', amount: 0, count: 0 };
    s.amount += t.amount;
    s.count++;
    acc.set(id, s);
  }
  return [...acc.values()].sort((a, b) => b.amount - a.amount);
}

export interface MonthPoint {
  key: string;
  income: number;
  expense: number;
}

export function monthlySeries(txs: Transaction[], months: string[]): MonthPoint[] {
  const map = new Map(months.map((k) => [k, { key: k, income: 0, expense: 0 }]));
  for (const t of txs) {
    const m = map.get(monthKey(t.date));
    if (!m) continue;
    if (t.type === 'income') m.income += t.amount;
    else if (t.type === 'expense') m.expense += t.amount;
  }
  return months.map((k) => map.get(k)!);
}

/** Ricavi ricorrenti (regola ricorrente o categoria "fissa") vs occasionali */
export function incomeSplit(txs: Transaction[], p: Pick<Period, 'start' | 'end'>, cats: CatMap) {
  let recurring = 0;
  let other = 0;
  for (const t of txs) {
    if (t.type !== 'income' || !inPeriod(t.date, p)) continue;
    if (natureOf(t, cats) === 'fixed') recurring += t.amount;
    else other += t.amount;
  }
  return { recurring, other };
}

export interface JunkGroup {
  key: string;
  label: string;
  count: number;
  total: number;
  avg: number;
  annual: number; // proiezione su 12 mesi alla frequenza osservata
  txIds: string[];
}

export const JUNK_MAX_AMOUNT = 1000; // 10 €
export const JUNK_MIN_COUNT = 4;

/**
 * Junk costs (versione base, affinata nella Fase 5): piccole spese discrezionali (≤ 10 €)
 * ripetute almeno 4 volte nel periodo presso lo stesso esercente o nella stessa categoria.
 */
export function junkCosts(txs: Transaction[], p: Pick<Period, 'start' | 'end'>, cats: CatMap, periodDays: number): JunkGroup[] {
  const groups = new Map<string, JunkGroup>();
  for (const t of txs) {
    if (t.type !== 'expense' || !inPeriod(t.date, p) || t.amount > JUNK_MAX_AMOUNT) continue;
    if (needOf(t, cats) !== 'discretionary') continue;
    const merchant = (t.merchant || '').trim().toLowerCase();
    const key = merchant ? `m:${merchant}` : `c:${t.categoryId ?? 'none'}`;
    const label = merchant ? t.merchant!.trim() : (t.categoryId ? cats.get(t.categoryId)?.name : undefined) ?? 'Senza categoria';
    const g = groups.get(key) ?? { key, label, count: 0, total: 0, avg: 0, annual: 0, txIds: [] };
    g.count++;
    g.total += t.amount;
    g.txIds.push(t.id);
    groups.set(key, g);
  }
  const days = Math.max(periodDays, 7);
  return [...groups.values()]
    .filter((g) => g.count >= JUNK_MIN_COUNT)
    .map((g) => ({ ...g, avg: Math.round(g.total / g.count), annual: Math.round((g.total / days) * 365) }))
    .sort((a, b) => b.annual - a.annual);
}

/** Media mensile delle spese negli n mesi precedenti al mese indicato (esclusi i mesi senza dati) */
export function previousMonthsAverage(txs: Transaction[], month: string, n: number, kind: 'income' | 'expense', filter?: (t: Transaction) => boolean): number | null {
  const months = lastMonths(n + 1, `${month}-01`).slice(0, n);
  const series = new Map(months.map((m) => [m, 0]));
  const withData = new Set<string>();
  for (const t of txs) {
    const k = monthKey(t.date);
    if (!series.has(k)) continue;
    withData.add(k);
    if (t.type !== kind || (filter && !filter(t))) continue;
    series.set(k, series.get(k)! + t.amount);
  }
  if (withData.size === 0) return null;
  let sum = 0;
  for (const k of withData) sum += series.get(k)!;
  return Math.round(sum / withData.size);
}
