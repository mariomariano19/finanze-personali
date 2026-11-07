import type { InvestmentOp, Transaction } from '../core/types';
import { addMonths, daysBetween, monthEnd, monthKey } from '../core/dates';
import { byCategory, junkCosts, natureOf, needOf, previousMonthsAverage, totals, type CatMap, type JunkGroup } from './stats';
import { netInvested } from './investments';

export interface CategoryChange {
  id: string;
  name: string;
  amount: number;
  average: number; // media dei 3 mesi precedenti
  change: number; // relativo
}

export interface MonthlyReport {
  month: string; // YYYY-MM
  income: number;
  expense: number;
  invested: number;
  balance: number;
  savingsRate: number | null;
  prev: { income: number; expense: number; balance: number } | null;
  expenseAvg3: number | null;
  topCategories: { id: string; name: string; icon: string; amount: number; share: number }[];
  variations: CategoryChange[];
  recurring: { label: string; amount: number; count: number }[];
  recurringTotal: number;
  discretionary: { id: string; name: string; amount: number }[];
  discretionaryTotal: number;
  junk: JunkGroup[];
  txCount: number;
}

const VARIATION_MIN_CHANGE = 0.25; // ±25%
const VARIATION_MIN_DIFF = 2000; // almeno 20 € di differenza

export function buildMonthlyReport(month: string, txs: Transaction[], ops: InvestmentOp[], cats: CatMap): MonthlyReport {
  const start = `${month}-01`;
  const end = monthEnd(start);
  const p = { start, end };
  const inMonth = txs.filter((t) => monthKey(t.date) === month);
  const t = totals(inMonth, p);

  const prevKey = monthKey(addMonths(start, -1, 1));
  const prevTx = txs.filter((x) => monthKey(x.date) === prevKey);
  const prevT = prevTx.length ? totals(prevTx, { start: `${prevKey}-01`, end: monthEnd(`${prevKey}-01`) }) : null;

  const macros = byCategory(inMonth, 'expense', p, cats);
  const topCategories = macros.slice(0, 5).map((s) => ({ id: s.id, name: s.name, icon: s.icon, amount: s.amount, share: t.expense > 0 ? s.amount / t.expense : 0 }));

  // Variazioni significative per sottocategoria rispetto alla media dei 3 mesi precedenti
  const leaves = byCategory(inMonth, 'expense', p, cats, true);
  const leafIds = new Set(leaves.map((l) => l.id));
  // considera anche categorie spese in passato e non questo mese
  for (const x of txs) if (x.type === 'expense' && x.categoryId && x.date < start && x.date >= addMonths(start, -3, 1)) leafIds.add(x.categoryId);
  const variations: CategoryChange[] = [];
  for (const id of leafIds) {
    const amount = leaves.find((l) => l.id === id)?.amount ?? 0;
    const avg = previousMonthsAverage(txs, month, 3, 'expense', (x) => (x.categoryId ?? 'none') === id);
    if (avg === null || avg === 0) continue;
    const ch = (amount - avg) / avg;
    if (Math.abs(ch) >= VARIATION_MIN_CHANGE && Math.abs(amount - avg) >= VARIATION_MIN_DIFF) {
      variations.push({ id, name: cats.get(id)?.name ?? 'Senza categoria', amount, average: avg, change: ch });
    }
  }
  variations.sort((a, b) => Math.abs(b.amount - b.average) - Math.abs(a.amount - a.average));

  // Spese ricorrenti (da regole o di natura fissa)
  const recMap = new Map<string, { label: string; amount: number; count: number }>();
  for (const x of inMonth) {
    if (x.type !== 'expense' || natureOf(x, cats) !== 'fixed') continue;
    const label = x.description || (x.categoryId ? cats.get(x.categoryId)?.name : '') || 'Spesa fissa';
    const r = recMap.get(label) ?? { label, amount: 0, count: 0 };
    r.amount += x.amount;
    r.count++;
    recMap.set(label, r);
  }
  const recurring = [...recMap.values()].sort((a, b) => b.amount - a.amount);

  // Spese discrezionali (potenzialmente superflue) per categoria
  const discMap = new Map<string, { id: string; name: string; amount: number }>();
  for (const x of inMonth) {
    if (x.type !== 'expense' || needOf(x, cats) !== 'discretionary') continue;
    const id = x.categoryId ?? 'none';
    const d = discMap.get(id) ?? { id, name: cats.get(id)?.name ?? 'Senza categoria', amount: 0 };
    d.amount += x.amount;
    discMap.set(id, d);
  }
  const discretionary = [...discMap.values()].sort((a, b) => b.amount - a.amount);

  return {
    month,
    income: t.income,
    expense: t.expense,
    invested: netInvested(ops, start, end),
    balance: t.balance,
    savingsRate: t.savingsRate,
    prev: prevT ? { income: prevT.income, expense: prevT.expense, balance: prevT.balance } : null,
    expenseAvg3: previousMonthsAverage(txs, month, 3, 'expense'),
    topCategories,
    variations: variations.slice(0, 6),
    recurring,
    recurringTotal: recurring.reduce((s, r) => s + r.amount, 0),
    discretionary: discretionary.slice(0, 6),
    discretionaryTotal: discretionary.reduce((s, d) => s + d.amount, 0),
    junk: junkCosts(inMonth, p, cats, daysBetween(start, end) + 1),
    txCount: inMonth.length
  };
}
