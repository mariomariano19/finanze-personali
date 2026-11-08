import { describe, expect, it } from 'vitest';
import type { Holding, InvestmentOp, PricePoint } from '../core/types';
import { annualize, latentTax, movers, periodReturn, priceBook, seriesReturn, xirr, investorFlows, periodStart, pricesAsOf } from '../analytics/returns';

const H = (id: string, extra: Partial<Holding> = {}): Holding => ({ id, name: id.toUpperCase(), assetClass: 'etf', price: 1000, priceDate: '2026-01-02', ...extra });
let n = 0;
const op = (holdingId: string, kind: InvestmentOp['kind'], date: string, quantity: number, amount: number, fees = 0, taxes = 0): InvestmentOp => ({ id: `o${n++}`, holdingId, kind, date, quantity, amount, fees, taxes });
const px = (holdingId: string, date: string, price: number): PricePoint => ({ id: `${holdingId}-${date}`, holdingId, date, price });

describe('rendimenti', () => {
  it('un acquisto e un rialzo del 10%', () => {
    const book = priceBook([H('a', { price: 1100, priceDate: '2026-06-30' })], [op('a', 'buy', '2026-01-02', 100, 100000)], []);
    const r = periodReturn(book, '2026-01-01', '2026-06-30');
    expect(r.twr).toBeCloseTo(0.1, 10);
    expect(r.gain).toBe(10000);
    expect(r.netFlows).toBe(100000);
    const x = xirr(investorFlows(book, '2026-06-30'))!;
    expect(x).toBeCloseTo(Math.pow(1.1, 365 / 179) - 1, 6);
  });

  it('TWR e XIRR divergono quando si versa nel momento sbagliato', () => {
    // 100 quote a 10 €, il prezzo raddoppia, altre 100 quote a 20 €, poi torna a 10 €
    const ops = [op('a', 'buy', '2026-01-02', 100, 100000), op('a', 'buy', '2026-03-02', 100, 200000)];
    const prices = [px('a', '2026-03-02', 2000), px('a', '2026-06-01', 1000)];
    const book = priceBook([H('a', { price: 1000, priceDate: '2026-06-01' })], ops, prices);
    const r = periodReturn(book, '2026-01-01', '2026-06-01');
    expect(r.twr).toBeCloseTo(0, 10); // la gestione è in pari: ×2 poi ÷2
    expect(r.gain).toBe(-100000); // ma hai perso 1.000 €
    expect(xirr(investorFlows(book, '2026-06-01'))!).toBeLessThan(-0.3);
  });

  it('dividendi e commissioni entrano nel rendimento', () => {
    const ops = [op('a', 'buy', '2026-01-02', 100, 100000, 1000), op('a', 'dividend', '2026-04-01', 0, 5000, 0, 1300)];
    const book = priceBook([H('a', { price: 1000, priceDate: '2026-06-01' })], ops, [px('a', '2026-04-01', 1000)]);
    const r = periodReturn(book, '2026-01-01', '2026-06-01');
    // commissione di 10 € su 1.010 versati, poi dividendo netto 37 € su 1.000 €
    expect(r.twr).toBeCloseTo((100000 / 101000) * (103700 / 100000) - 1, 10);
  });

  it('periodo più lungo della storia: segnalato come parziale', () => {
    const book = priceBook([H('a', { price: 1100, priceDate: '2026-06-30' })], [op('a', 'buy', '2026-05-02', 100, 100000)], []);
    expect(periodReturn(book, '2025-06-30', '2026-06-30').partial).toBe(true);
    expect(periodReturn(book, '2026-05-10', '2026-06-30').partial).toBe(false);
  });

  it('variazioni per strumento e date dei periodi', () => {
    const ops = [op('a', 'buy', '2026-01-02', 10, 10000), op('b', 'buy', '2026-01-02', 10, 10000)];
    const prices = [px('a', '2026-11-05', 1100), px('a', '2026-11-06', 1210), px('b', '2026-11-05', 1000), px('b', '2026-11-06', 900)];
    const book = priceBook([H('a', { price: 1210, priceDate: '2026-11-06' }), H('b', { price: 900, priceDate: '2026-11-06' })], ops, prices);
    const asOf = pricesAsOf(book, '2026-11-08');
    expect(asOf).toBe('2026-11-06');
    expect(periodStart('1G', asOf, book)).toBe('2026-11-05');
    expect(periodStart('YTD', asOf, book)).toBe('2025-12-31');
    const m = movers(book, '2026-11-05', asOf);
    expect(m.map((x) => [x.holding.id, Math.round(x.changePct * 1000) / 10, x.impact])).toEqual([['a', 10, 1100], ['b', -10, -1000]]);
  });

  it('tasse latenti, indice di confronto, annualizzazione', () => {
    expect(latentTax([{ taxClass: 'standard', pnl: 10000 }, { taxClass: 'govt', pnl: 10000 }, { taxClass: 'standard', pnl: -5000 }])).toEqual({ tax: 3850, losses: 5000 });
    const s = [{ date: '2026-01-02', price: 100 }, { date: '2026-06-30', price: 110 }];
    expect(seriesReturn(s, '2026-01-02', '2026-06-30')).toBeCloseTo(0.1);
    expect(seriesReturn(s, '2025-12-01', '2026-06-30')).toBeNull(); // nessun prezzo alla partenza
    expect(annualize(0.21, '2024-01-01', '2026-01-01')).toBeCloseTo(0.1, 2);
    expect(annualize(0.05, '2026-01-01', '2026-06-01')).toBeNull();
  });
});
