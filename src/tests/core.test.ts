import { describe, expect, it } from 'vitest';
import { formatEUR, parseEUR, formatPct } from '../core/money';
import { addMonths, lastMonths, periodFor, shiftPeriod } from '../core/dates';
import { generateDue, monthlyEquivalent, occurrences } from '../ledger/recurring';
import { defaultCategories } from '../core/categories';
import { catMapOf, junkCosts, totals, byCategory, incomeSplit } from '../analytics/stats';
import { positionAt, positions, portfolioTotals, netInvested } from '../analytics/investments';
import { buildMonthlyReport } from '../analytics/report';
import type { Holding, InvestmentOp, RecurringRule, Transaction } from '../core/types';

const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36),
  type: 'expense',
  amount: 1000,
  date: '2026-11-05',
  categoryId: null,
  description: '',
  accountId: null,
  source: 'manual',
  createdAt: '',
  updatedAt: '',
  ...p
});

describe('importi', () => {
  it('formatta in euro italiano', () => {
    expect(formatEUR(123456)).toBe('1.234,56 €');
    expect(formatEUR(-150)).toBe('−1,50 €');
    expect(formatEUR(88600, { sign: true, short: true })).toBe('+886 €');
  });
  it('interpreta input diversi', () => {
    expect(parseEUR('12,50')).toBe(1250);
    expect(parseEUR('12.50')).toBe(1250);
    expect(parseEUR('1.234,56')).toBe(123456);
    expect(parseEUR('1.234')).toBe(123400);
    expect(parseEUR('1,234.56')).toBe(123456);
    expect(parseEUR('7')).toBe(700);
    expect(parseEUR('abc')).toBeNull();
    expect(parseEUR('')).toBeNull();
  });
  it('evita errori di arrotondamento', () => {
    expect(parseEUR('0,1')! + parseEUR('0,2')!).toBe(30);
  });
  it('percentuali', () => {
    expect(formatPct(0.3123)).toBe('31%');
    expect(formatPct(-0.04, { sign: true })).toBe('−4%');
  });
});

describe('date', () => {
  it('fine mese corretta per i mesi corti', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 2, 31)).toBe('2026-03-31');
  });
  it('periodi', () => {
    expect(periodFor('month', '2026-11-07')).toEqual({ kind: 'month', start: '2026-11-01', end: '2026-11-30' });
    expect(periodFor('week', '2026-11-07')).toEqual({ kind: 'week', start: '2026-11-02', end: '2026-11-08' });
    expect(periodFor('quarter', '2026-11-07')).toEqual({ kind: 'quarter', start: '2026-10-01', end: '2026-12-31' });
    expect(shiftPeriod(periodFor('month', '2026-03-15'), -1).start).toBe('2026-02-01');
    expect(lastMonths(3, '2026-01-10')).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('ricorrenze', () => {
  const rule: RecurringRule = {
    id: 'r1', type: 'expense', amount: 65000, categoryId: 'exp-casa-affitto-o-mutuo', description: 'Affitto',
    accountId: null, frequency: 'monthly', startDate: '2026-08-31', active: true
  };
  it('rispetta il giorno di ancoraggio', () => {
    expect(occurrences(rule, '2026-12-31')).toEqual(['2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31']);
  });
  it('genera solo le occorrenze mancanti e senza duplicati', () => {
    const first = generateDue([rule], new Set(), '2026-10-31');
    expect(first.txs.map((t) => t.date)).toEqual(['2026-08-31', '2026-09-30', '2026-10-31']);
    const again = generateDue(first.updated, new Set(first.txs.map((t) => t.id)), '2026-11-30');
    expect(again.txs.map((t) => t.date)).toEqual(['2026-11-30']);
    const none = generateDue(again.updated, new Set(), '2026-11-30');
    expect(none.txs).toHaveLength(0);
  });
  it('equivalente mensile', () => {
    expect(monthlyEquivalent({ amount: 12000, frequency: 'yearly' })).toBe(1000);
  });
});

describe('statistiche', () => {
  const cats = catMapOf(defaultCategories());
  const p = periodFor('month', '2026-11-07');
  const data = [
    tx({ type: 'income', amount: 240000, categoryId: 'inc-stipendio' }),
    tx({ type: 'income', amount: 25000, categoryId: 'inc-consulenze' }),
    tx({ amount: 65000, categoryId: 'exp-casa-affitto-o-mutuo' }),
    tx({ amount: 6320, categoryId: 'exp-alimentazione-supermercato' }),
    tx({ type: 'transfer', amount: 50000 }),
    tx({ amount: 9999, date: '2026-10-30', categoryId: 'exp-shopping-abbigliamento' })
  ];
  it('totali del periodo escludono giroconti e altri mesi', () => {
    const t = totals(data, p);
    expect(t.income).toBe(265000);
    expect(t.expense).toBe(71320);
    expect(t.savingsRate).toBeCloseTo((265000 - 71320) / 265000);
  });
  it('raggruppa per macro-categoria', () => {
    const s = byCategory(data, 'expense', p, cats);
    expect(s.map((x) => x.name)).toEqual(['Casa e utenze', 'Alimentazione']);
  });
  it('separa ricavi ricorrenti e occasionali', () => {
    expect(incomeSplit(data, p, cats)).toEqual({ recurring: 240000, other: 25000 });
  });
  it('individua junk costs ripetuti', () => {
    const coffees = Array.from({ length: 22 }, (_, i) =>
      tx({ amount: 150, merchant: 'Bar Centrale', categoryId: 'exp-alimentazione-bar-e-caffetterie', date: `2026-11-${String((i % 28) + 1).padStart(2, '0')}` })
    );
    const groups = junkCosts([...data, ...coffees], p, cats, 30);
    expect(groups).toHaveLength(1);
    expect(groups[0].total).toBe(3300);
    expect(groups[0].annual).toBe(Math.round((3300 / 30) * 365));
  });
  it('report mensile con variazioni', () => {
    const hist = [
      ...['2026-08', '2026-09', '2026-10'].map((m) => tx({ amount: 20000, date: `${m}-10`, categoryId: 'exp-alimentazione-ristoranti' })),
      tx({ amount: 31200, date: '2026-11-10', categoryId: 'exp-alimentazione-ristoranti' })
    ];
    const r = buildMonthlyReport('2026-11', [...data, ...hist], [], cats);
    expect(r.income).toBe(265000);
    expect(r.variations[0].name).toBe('Ristoranti');
    expect(r.variations[0].change).toBeCloseTo(0.56);
    expect(r.recurring[0].label).toBe('Affitto o mutuo');
  });
});

describe('investimenti', () => {
  const h: Holding = { id: 'h1', name: 'ETF', assetClass: 'etf', price: 11000, priceDate: '2026-11-01' };
  const ops: InvestmentOp[] = [
    { id: 'o1', holdingId: 'h1', kind: 'buy', date: '2026-01-10', quantity: 10, amount: 100000, fees: 200 },
    { id: 'o2', holdingId: 'h1', kind: 'buy', date: '2026-02-10', quantity: 10, amount: 120000, fees: 200 },
    { id: 'o3', holdingId: 'h1', kind: 'sell', date: '2026-03-10', quantity: 5, amount: 60000, fees: 100 }
  ];
  it('costo medio e plusvalenze realizzate', () => {
    const p = positionAt(ops);
    expect(p.quantity).toBe(15);
    expect(p.costBasis).toBe(165300); // 220400 * 15/20
    expect(p.realized).toBe(60000 - 100 - 55100);
  });
  it('valore e rendimento', () => {
    const [pos] = positions([h], ops);
    expect(pos.value).toBe(165000);
    expect(portfolioTotals([pos]).pnl).toBe(-300);
    expect(netInvested(ops, '2026-01-01', '2026-02-28')).toBe(220400);
  });
});
