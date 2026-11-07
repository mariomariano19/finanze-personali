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
    const base = { instrument: 'Leonardo', ticker: 'LDO.MI', category: 'Difesa', horizonLabel: '1 mese', horizonDays: 30, neutralBandPct: 3, refPrice: 45.12, currency: 'EUR', probs: { up: 0.45, neutral: 0.3, down: 0.25 }, expectedReturnPct: 1.2, rationale: 'test', sources: ['https://example.org'] };
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
});
