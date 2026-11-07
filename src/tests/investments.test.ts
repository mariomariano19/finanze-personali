import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { positionAt, positions, portfolioTotals } from '../analytics/investments';
import { migrate, DEFAULT_BROKER_ID, CURRENT_DATA_VERSION } from '../persistence/migrations';
import { FinanceDB } from '../persistence/db';
import { Vault } from '../persistence/vault';
import { createBackup, openBackup } from '../persistence/backup';
import { deriveKey, randomBytes, seal, toBase64, PBKDF2_ITERATIONS } from '../persistence/crypto';
import { STORE_NAMES, type Holding, type InvestmentOp } from '../core/types';

const op = (p: Partial<InvestmentOp>): InvestmentOp => ({ id: Math.random().toString(36), holdingId: 'h1', kind: 'buy', date: '2026-01-01', quantity: 0, amount: 0, fees: 0, ...p });

describe('posizioni v2', () => {
  it('dividendi, tasse, costi e frazionamento', () => {
    const ops = [
      op({ kind: 'buy', quantity: 10, amount: 100000, fees: 500 }),
      op({ kind: 'dividend', date: '2026-03-01', amount: 2000, taxes: 520 }),
      op({ kind: 'split', date: '2026-04-01', quantity: 10 }),
      op({ kind: 'fee', date: '2026-05-01', amount: 300 }),
      op({ kind: 'sell', date: '2026-06-01', quantity: 5, amount: 30000, fees: 200, taxes: 650 })
    ];
    const p = positionAt(ops);
    expect(p.quantity).toBe(15);
    // dopo lo split: 20 quote, costo 100.500 → costo medio 5.025; vendita di 5 = 25.125
    expect(p.costBasis).toBe(75375);
    expect(p.realized).toBe(30000 - 200 - 25125);
    expect(p.income).toBe(2000);
    expect(p.costs).toBe(300);
    expect(p.taxes).toBe(520 + 650);
  });

  it('risultato complessivo e filtro per intermediario', () => {
    const h: Holding = { id: 'h1', name: 'ETF', assetClass: 'etf', price: 12000, priceDate: '2026-11-01' };
    const ops = [
      op({ brokerId: 'a', quantity: 10, amount: 100000 }),
      op({ brokerId: 'b', quantity: 5, amount: 55000 }),
      op({ brokerId: 'a', kind: 'dividend', amount: 1000, taxes: 260 })
    ];
    const all = positions([h], ops);
    expect(all[0].quantity).toBe(15);
    expect(all[0].totalReturn).toBe(180000 - 155000 + 1000 - 260);
    const onlyA = positions([h], ops, 'a');
    expect(onlyA[0].quantity).toBe(10);
    expect(portfolioTotals(onlyA).income).toBe(1000);
    expect(positions([h], ops, 'c')).toHaveLength(0);
  });
});

describe('migrazione v1 → v2', () => {
  const v1 = {
    hold: [{ id: 'h1', name: 'ETF', assetClass: 'etf', price: 100, priceDate: '2026-01-01' }, { id: 'h2', name: 'BTC', assetClass: 'crypto', price: 1, priceDate: '2026-01-01' }],
    op: [{ id: 'o1', holdingId: 'h1', kind: 'buy', date: '2026-01-01', quantity: 1, amount: 100, fees: 0 }]
  };

  it('aggiunge intermediario e classi fiscali', () => {
    const d = migrate(v1 as never, 1);
    expect(d.brk.map((b) => b.id)).toEqual([DEFAULT_BROKER_ID]);
    expect(d.brk[0].taxRegime).toBe('administered');
    expect(d.op[0].brokerId).toBe(DEFAULT_BROKER_ID);
    expect(d.hold.find((h) => h.id === 'h2')!.taxClass).toBe('crypto');
    expect(d.tx).toEqual([]);
  });

  it('senza investimenti non crea intermediari', () => {
    expect(migrate({ tx: [] }, 1).brk).toEqual([]);
  });

  it('converte un archivio v1 al primo sblocco', async () => {
    const name = 'mig-' + Math.random();
    const db = new FinanceDB(name);
    const salt = randomBytes(16);
    const key = await deriveKey('123456', salt);
    const verifier = await seal(key, 'finanze-personali:ok');
    await db.meta.bulkPut([{ key: 'auth', value: { salt, iterations: PBKDF2_ITERATIONS, verifier } }, { key: 'dataVersion', value: 1 }]);
    for (const [store, rows] of Object.entries(v1)) {
      for (const r of rows) {
        const s = await seal(key, r);
        await db.records.put({ store, id: r.id, iv: s.iv, data: s.data });
      }
    }
    const v = new Vault(name);
    expect(await v.unlock('123456')).toBeNull();
    expect(v.get('op', 'o1')?.brokerId).toBe(DEFAULT_BROKER_ID);
    expect(v.list('brk')).toHaveLength(1);
    expect((await db.meta.get('dataVersion'))?.value).toBe(CURRENT_DATA_VERSION);
    // riapertura: nessuna seconda migrazione, dati invariati
    const v2 = new Vault(name);
    expect(await v2.unlock('123456')).toBeNull();
    expect(v2.list('brk')).toHaveLength(1);
  });

  it('converte un backup v1 al ripristino', async () => {
    const fullV1 = { ...Object.fromEntries(STORE_NAMES.map((n) => [n, []])), ...v1 };
    delete (fullV1 as Record<string, unknown>).brk; // nei backup v1 gli intermediari non esistono
    const file = await createBackup({ ...fullV1, brk: [] } as never, '123456');
    file.dataVersion = 1;
    const dump = await openBackup(file, '123456');
    expect(dump!.op[0].brokerId).toBe(DEFAULT_BROKER_ID);
    expect(toBase64(new Uint8Array([1]))).toBe('AQ==');
  });
});
