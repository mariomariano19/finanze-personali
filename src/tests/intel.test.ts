import { describe, expect, it } from 'vitest';
import nodeCrypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decryptJSON, encryptJSON, importIntelKey, verifyChain } from '../intel/crypto';

const KEY = nodeCrypto.randomBytes(32).toString('base64url');

async function engine() {
  process.env.INTEL_KEY = KEY;
  // @ts-expect-error modulo JavaScript del motore, senza tipi
  return import('../../tools/intel.mjs');
}

describe('formato condiviso app ↔ motore', () => {
  it('il motore cifra, l’app decifra (e viceversa)', async () => {
    const eng = await engine();
    const k = await importIntelKey(KEY);
    expect(k).not.toBeNull();
    const fromEngine = eng.encrypt({ ciao: 'mondo', n: 1.5, è: ['à'] });
    expect(await decryptJSON(k!, fromEngine)).toEqual({ ciao: 'mondo', n: 1.5, è: ['à'] });
    const fromApp = await encryptJSON(k!, { watchlist: [{ name: 'Leonardo' }] });
    expect(eng.decrypt(fromApp)).toEqual({ watchlist: [{ name: 'Leonardo' }] });
  });

  it('chiave sbagliata o non valida', async () => {
    const eng = await engine();
    const other = await importIntelKey(nodeCrypto.randomBytes(32).toString('base64url'));
    await expect(decryptJSON(other!, eng.encrypt({ a: 1 }))).rejects.toThrow();
    expect(await importIntelKey('troppo-corta')).toBeNull();
  });

  it('registro: le impronte del motore sono verificate dall’app e una modifica viene scoperta', async () => {
    const eng = await engine();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-'));
    const base = { instrument: 'Leonardo', ticker: 'LDO.MI', category: 'Difesa', horizonLabel: '1 mese', horizonDays: 30, neutralBandPct: 3, refPrice: 45.12, refPriceAsOf: '2026-11-06T16:35:00Z', currency: 'EUR', probs: { up: 0.45, neutral: 0.3, down: 0.25 }, expectedReturnPct: 1.2, rationale: 'test', sources: ['https://example.org'] };
    const tool = path.resolve('tools/intel.mjs');
    const input = path.join(dir, 'new.json');
    fs.writeFileSync(input, JSON.stringify([base, { ...base, instrument: 'Eni', ticker: 'ENI.MI' }]));
    const { execFileSync } = await import('node:child_process');
    execFileSync('node', [tool, 'add-predictions', input, dir], { env: { ...process.env, INTEL_KEY: KEY } });
    fs.writeFileSync(input, JSON.stringify([{ ...base, instrument: 'Terna' }]));
    execFileSync('node', [tool, 'add-predictions', input, dir], { env: { ...process.env, INTEL_KEY: KEY } });
    const reg = eng.decrypt(JSON.parse(fs.readFileSync(path.join(dir, 'predictions.enc.json'), 'utf8')));
    expect(reg.predictions.map((p: { id: string }) => p.id)).toEqual(['p000001', 'p000002', 'p000003']);
    expect(await verifyChain(reg.predictions)).toEqual({ ok: true, checked: 3, brokenAt: null });
    // alterazione: cambio una probabilità già pubblicata
    const tampered = reg.predictions.map((p: { seq: number; probs: object }) => (p.seq === 2 ? { ...p, probs: { up: 0.9, neutral: 0.05, down: 0.05 } } : p));
    expect((await verifyChain(tampered)).brokenAt).toBe(2);
    // cancellazione di una voce
    expect((await verifyChain(reg.predictions.filter((p: { seq: number }) => p.seq !== 1))).ok).toBe(false);
    // il motore si rifiuta di aggiungere a un registro alterato
    const regFile = path.join(dir, 'predictions.enc.json');
    fs.writeFileSync(regFile, JSON.stringify(eng.encrypt({ predictions: tampered })));
    expect(() => execFileSync('node', [tool, 'add-predictions', input, dir], { env: { ...process.env, INTEL_KEY: KEY }, stdio: 'pipe' })).toThrow();
  });

  it('pubblicazione del briefing e indice', async () => {
    const eng = await engine();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-'));
    const tool = path.resolve('tools/intel.mjs');
    const f = path.join(dir, 'b.json');
    const { execFileSync } = await import('node:child_process');
    for (const date of ['2026-11-09', '2026-11-10']) {
      fs.writeFileSync(f, JSON.stringify({ date, headline: 'Titolo ' + date, markets: [] }));
      execFileSync('node', [tool, 'publish-briefing', f, dir], { env: { ...process.env, INTEL_KEY: KEY } });
    }
    const idx = eng.decrypt(JSON.parse(fs.readFileSync(path.join(dir, 'index.enc.json'), 'utf8')));
    expect(idx.latest).toBe('2026-11-10');
    expect(idx.briefings.map((b: { date: string }) => b.date)).toEqual(['2026-11-10', '2026-11-09']);
  });

  it('verifica alla scadenza: rendimento totale, fasce, regole sulle date e catena degli esiti', async () => {
    const eng = await engine();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-'));
    const tool = path.resolve('tools/intel.mjs');
    const { execFileSync } = await import('node:child_process');
    const run = (args: string[], today: string) => execFileSync('node', [tool, ...args, dir], { env: { ...process.env, INTEL_KEY: KEY, INTEL_TODAY: today }, stdio: 'pipe' }).toString();
    const base = { briefingDate: '2026-11-07', category: 'Energia', horizonLabel: '1 mese', horizonDays: 30, neutralBandPct: 3, currency: 'EUR', refPriceAsOf: '2026-11-06T16:35:00Z', probs: { up: 0.5, neutral: 0.3, down: 0.2 }, expectedReturnPct: 2, rationale: 't', sources: [] };
    const nf = path.join(dir, 'new.json');
    fs.writeFileSync(nf, JSON.stringify([
      { ...base, instrument: 'Eni', refPrice: 25 },
      { ...base, instrument: 'FTSE MIB', category: 'Indici', horizonLabel: '1 settimana', horizonDays: 7, neutralBandPct: 1.5, refPrice: 50000, probs: { up: 0.3, neutral: 0.3, down: 0.4 } },
      { ...base, instrument: 'Oro', category: 'Materie prime', refPrice: 4000 }
    ]));
    run(['add-predictions', nf], '2026-11-07');
    // scadenze: Eni e Oro 06/11 + 30 = 06/12; FTSE MIB 13/11. Il 13 stesso non è ancora verificabile
    expect(JSON.parse(run(['due'], '2026-11-13'))).toEqual([]);
    const due = JSON.parse(run(['due'], '2026-11-16'));
    expect(due.map((d: { instrument: string; expiryDate: string }) => [d.instrument, d.expiryDate])).toEqual([['FTSE MIB', '2026-11-13']]);
    const of = path.join(dir, 'out.json');
    // prezzo con data successiva alla scadenza: rifiutato
    fs.writeFileSync(of, JSON.stringify([{ predictionId: 'p000002', finalPrice: 49000, finalPriceAsOf: '2026-11-16', finalPriceSource: 'Borsa Italiana', finalPriceUrl: 'https://www.borsaitaliana.it/x', dividendsChecked: true }]));
    expect(() => run(['add-outcomes', of], '2026-11-17')).toThrow();
    // non verificabile troppo presto: rifiutato
    fs.writeFileSync(of, JSON.stringify([{ predictionId: 'p000002', inconclusive: true, reason: 'prezzo non trovato' }]));
    expect(() => run(['add-outcomes', of], '2026-11-16')).toThrow();
    // FTSE MIB −2% → ribasso, la classe più probabile era ribasso → corretta
    fs.writeFileSync(of, JSON.stringify([{ predictionId: 'p000002', finalPrice: 49000, finalPriceAsOf: '2026-11-13T16:35:00Z', finalPriceSource: 'Borsa Italiana', finalPriceUrl: 'https://www.borsaitaliana.it/x', dividendsChecked: true }]));
    const r1 = JSON.parse(run(['add-outcomes', of], '2026-11-16'));
    expect(r1[0]).toMatchObject({ result: 'correct', realized: 'down', totalReturnPct: -2 });
    // Eni: prezzo −2,4% ma dividendo 0,26 → totale −1,36% → neutrale (non ribasso)
    fs.writeFileSync(of, JSON.stringify([{ predictionId: 'p000001', finalPrice: 24.4, finalPriceAsOf: '2026-12-04', finalPriceSource: 'Borsa Italiana', finalPriceUrl: 'https://www.borsaitaliana.it/eni', dividendsChecked: true, dividends: [{ exDate: '2026-11-23', amount: 0.26, source: 'Eni', url: 'https://www.eni.com/div' }] }]));
    const r2 = JSON.parse(run(['add-outcomes', of], '2026-12-07'));
    expect(r2[0]).toMatchObject({ realized: 'neutral', result: 'wrong', priceReturnPct: -2.4, totalReturnPct: -1.36 });
    // un dividendo staccato fuori dal periodo è rifiutato
    fs.writeFileSync(of, JSON.stringify([{ predictionId: 'p000003', finalPrice: 4100, finalPriceAsOf: '2026-12-04', finalPriceSource: 'LBMA', finalPriceUrl: 'https://www.lbma.org.uk/x', dividendsChecked: true, dividends: [{ exDate: '2026-11-01', amount: 1, url: 'https://x.org' }] }]));
    expect(() => run(['add-outcomes', of], '2026-12-07')).toThrow();
    // doppio inserimento: ignorato
    fs.writeFileSync(of, JSON.stringify([{ predictionId: 'p000002', inconclusive: true, reason: 'x' }]));
    expect(JSON.parse(run(['add-outcomes', of], '2026-12-30'))[0].skipped).toBeTruthy();
    // catena degli esiti verificata dall'app; una modifica viene scoperta
    const outs = eng.decrypt(JSON.parse(fs.readFileSync(path.join(dir, 'outcomes.enc.json'), 'utf8'))).outcomes;
    expect(await verifyChain(outs)).toEqual({ ok: true, checked: 2, brokenAt: null });
    expect((await verifyChain(outs.map((o: { seq: number }) => (o.seq === 1 ? { ...o, result: 'wrong' } : o)))).brokenAt).toBe(1);
    expect(JSON.parse(run(['verify'], '2026-12-07')).ok).toBe(true);
  });

  it('schede aziendali: solo aziende in watchlist, url https, indice aggiornato', async () => {
    const eng = await engine();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-'));
    const tool = path.resolve('tools/intel.mjs');
    const { execFileSync } = await import('node:child_process');
    const run = (args: string[]) => execFileSync('node', [tool, ...args, dir], { env: { ...process.env, INTEL_KEY: KEY }, stdio: 'pipe' }).toString();
    fs.writeFileSync(path.join(dir, 'watchlist.enc.json'), JSON.stringify(eng.encrypt({ items: [{ id: 'eni', name: 'Eni', ticker: 'ENI.MI', category: 'Energia' }, { id: 'ftse', name: 'FTSE MIB', category: 'Indici' }] })));
    const plan = JSON.parse(run(['dossier-plan', '7']));
    expect(plan.fullReview).toEqual(['eni']);
    const f = path.join(dir, 'd.json');
    fs.writeFileSync(f, JSON.stringify({ itemId: 'eni', fullReview: true, summary: 'Energia integrata', sections: [{ key: 'profilo', title: 'Profilo', sources: [{ name: 'Eni', url: 'http://eni.com' }] }] }));
    expect(() => run(['dossier-put', f])).toThrow();
    fs.writeFileSync(f, JSON.stringify({ itemId: 'nessuno', sections: [] }));
    expect(() => run(['dossier-put', f])).toThrow();
    fs.writeFileSync(f, JSON.stringify({ itemId: 'eni', fullReview: true, summary: 'Energia integrata', sections: [{ key: 'profilo', title: 'Profilo', sources: [{ name: 'Eni', url: 'https://www.eni.com' }] }] }));
    run(['dossier-put', f]);
    const idx = eng.decrypt(JSON.parse(fs.readFileSync(path.join(dir, 'dossiers.enc.json'), 'utf8')));
    expect(idx.items.eni.fullReviewAt).toBeTruthy();
    const d = JSON.parse(run(['dossier-get', 'eni']));
    expect(d).toMatchObject({ name: 'Eni', ticker: 'ENI.MI', summary: 'Energia integrata' });
    expect(d.fullReview).toBeUndefined();
  });
});
