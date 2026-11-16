import { describe, expect, it } from 'vitest';
import type { Category, RecurringRule, Transaction } from '../core/types';
import { advice, budgets, savingsPlan, simulate, monthProgress } from '../analytics/savings';
import { catMapOf } from '../analytics/stats';

const C = (id: string, name: string, nature: Category['nature'], need: Category['need'], kind: Category['kind'] = 'expense'): Category => ({ id, name, kind, parentId: 'p', icon: 'dots', nature, need, order: 0 });
const cats = [C('rent', 'Affitto o mutuo', 'fixed', 'necessary'), C('bar', 'Bar e caffetterie', 'variable', 'discretionary'), C('rest', 'Ristoranti', 'variable', 'discretionary'), C('stream', 'Streaming', 'variable', 'discretionary'), C('fee', 'Commissioni bancarie', 'variable', 'necessary'), C('sal', 'Stipendio', 'fixed', 'necessary', 'income')];
const catMap = catMapOf(cats);
let n = 0;
const T = (type: Transaction['type'], amount: number, date: string, categoryId: string, extra: Partial<Transaction> = {}): Transaction => ({ id: `t${n++}`, type, amount, date, categoryId, description: '', accountId: null, source: 'manual', createdAt: '', updatedAt: '', ...extra });

function data() {
  const txs: Transaction[] = [];
  for (const m of ['2026-07', '2026-08', '2026-09', '2026-10']) {
    txs.push(T('income', 200000, `${m}-01`, 'sal'));
    txs.push(T('expense', 70000, `${m}-02`, 'rent', { recurringId: 'r1' }));
    for (let d = 1; d <= 20; d++) txs.push(T('expense', 150, `${m}-${String(d + 5).padStart(2, '0')}`, 'bar', { merchant: 'Bar Roma' }));
    txs.push(T('expense', 1299, `${m}-15`, 'stream', { merchant: 'NETFLIX.COM' }));
    txs.push(T('expense', 300, `${m}-28`, 'fee'));
    txs.push(T('expense', m === '2026-10' ? 18000 : 10000, `${m}-20`, 'rest'));
  }
  txs.push(T('expense', 6000, '2026-11-10', 'rest'));
  return txs;
}
const rules: RecurringRule[] = [{ id: 'r1', type: 'expense', amount: 70000, categoryId: 'rent', description: 'Affitto', accountId: null, frequency: 'monthly', startDate: '2026-07-02', active: true }];

describe('piano di risparmio', () => {
  it('media degli ultimi 3 mesi completi e distanza dall’obiettivo', () => {
    const p = savingsPlan(data(), '2026-11-16', 60);
    expect(p.months.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    // costi: 700 + 30 + 12,99 + 3 + ristoranti (100,100,180 → 126,67)
    expect(p.avgIncome).toBe(200000);
    expect(p.avgExpense).toBe(Math.round((3 * (70000 + 3000 + 1299 + 300) + 10000 + 10000 + 18000) / 3));
    expect(p.gapMonthly).toBe(120000 - p.avgSaved);
  });

  it('budget proposti: media arrotondata ai 5 €, niente budget sulle spese fisse', () => {
    const b = budgets(data(), catMap, '2026-11-16', undefined);
    expect(b.find((x) => x.categoryId === 'rent')).toBeUndefined();
    const rest = b.find((x) => x.categoryId === 'rest')!;
    expect(rest.proposed).toBe(13000); // 126,67 → 130 €
    expect(rest.spent).toBe(6000);
    const saved = budgets(data(), catMap, '2026-11-16', { rest: 10000 }).find((x) => x.categoryId === 'rest')!;
    expect(saved).toMatchObject({ active: true, limit: 10000, ratio: 0.6 });
  });

  it('consigli: piccole spese, abbonamento riconosciuto, categoria in crescita, discrezionali, costi bancari', () => {
    const a = advice({ txs: data(), cats, catMap, rules, today: '2026-11-16', goalPct: 60 });
    const kinds = a.map((x) => x.kind);
    expect(kinds).toContain('small');
    expect(kinds).toContain('subscription');
    expect(kinds).toContain('growth');
    expect(kinds).toContain('discretionary');
    expect(kinds).toContain('fees');
    expect(a.find((x) => x.id.startsWith('sub-rule'))).toBeUndefined(); // l'affitto non è un abbonamento da disdire
    // un canone bancario ricorrente compare solo tra i costi bancari, non anche tra gli abbonamenti
    const feeRule: RecurringRule = { id: 'r2', type: 'expense', amount: 300, categoryId: 'fee', description: 'Canone conto', accountId: null, frequency: 'monthly', startDate: '2026-07-28', active: true };
    const a2 = advice({ txs: data(), cats, catMap, rules: [...rules, feeRule], today: '2026-11-16', goalPct: 60 });
    expect(a2.filter((x) => x.yearly === 3600).map((x) => x.kind)).toEqual(['fees']);
    const sub = a.find((x) => x.id.startsWith('sub-detect'))!;
    expect(sub.yearly).toBe(1299 * 12);
    const small = a.find((x) => x.kind === 'small')!;
    expect(small.yearly).toBe(3000 * 12 * 0.5); // 30 € al mese, dimezzati
    const growth = a.find((x) => x.kind === 'growth')!;
    expect(growth.yearly).toBe(8000 * 12); // 180 contro 100
    expect(a.every((x, i) => i === 0 || a[i - 1].yearly >= x.yearly)).toBe(true);
    const plan = savingsPlan(data(), '2026-11-16', 60);
    const sim = simulate(plan, [sub, small]);
    expect(sim.yearly).toBe(1299 * 12 + 18000);
    expect(sim.newRate).toBeGreaterThan(plan.avgRate!);
  });

  it('con pochi dati nessun consiglio inventato', () => {
    expect(advice({ txs: [], cats, catMap, rules: [], today: '2026-11-16', goalPct: 20 })).toEqual([]);
    expect(monthProgress('2026-11-15')).toBeCloseTo(0.5);
  });
});
