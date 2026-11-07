import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { Vault } from '../persistence/vault';
import { initialData } from '../persistence/seed';
import { createBackup, openBackup, parseBackup, transactionsCSV } from '../persistence/backup';
import { FinanceDB } from '../persistence/db';
import type { Transaction } from '../core/types';

const sample: Transaction = {
  id: 't1', type: 'expense', amount: 1250, date: '2026-11-07', categoryId: 'exp-alimentazione-bar-e-caffetterie',
  description: 'Colazione', accountId: 'acc-carta', source: 'manual', createdAt: '', updatedAt: ''
};

describe('vault cifrato', () => {
  it('persiste, cifra e richiede il PIN corretto', async () => {
    const name = 'test-' + Math.random();
    const v = new Vault(name);
    expect(await v.isInitialized()).toBe(false);
    await v.setup('123456', initialData());
    v.put('tx', sample);
    await v.flush();

    // dati illeggibili nel database: nessun testo in chiaro
    const raw = await new FinanceDB(name).records.toArray();
    const txRow = raw.find((r) => r.store === 'tx')!;
    expect(new TextDecoder().decode(txRow.data)).not.toContain('Colazione');

    // "riavvio": nuova istanza sullo stesso database
    const v2 = new Vault(name);
    expect(await v2.unlock('000000')).toBe('PIN errato.');
    expect(await v2.unlock('123456')).toBeNull();
    expect(v2.get('tx', 't1')?.description).toBe('Colazione');
    expect(v2.list('cat').length).toBeGreaterThan(80);
  });

  it('cambio PIN ricifra tutto', async () => {
    const name = 'test-' + Math.random();
    const v = new Vault(name);
    await v.setup('111111', initialData());
    v.put('tx', sample);
    expect(await v.changePin('999999', '222222')).not.toBeNull();
    expect(await v.changePin('111111', '222222')).toBeNull();
    const v2 = new Vault(name);
    expect(await v2.unlock('111111')).not.toBeNull();
    expect(await v2.unlock('222222')).toBeNull();
    expect(v2.get('tx', 't1')?.amount).toBe(1250);
  });

  it('blocca dopo 5 tentativi errati', async () => {
    const name = 'test-' + Math.random();
    const v = new Vault(name);
    await v.setup('111111', {});
    v.lock();
    for (let i = 0; i < 4; i++) expect(await v.unlock('000000')).toBe('PIN errato.');
    expect(await v.unlock('000000')).toContain('bloccata');
    expect(await v.unlock('111111')).toContain('Troppi tentativi');
  });
});

describe('backup', () => {
  it('andata e ritorno con PIN', async () => {
    const v = new Vault('test-' + Math.random());
    await v.setup('123456', initialData());
    v.put('tx', sample);
    const file = await createBackup(v.dump(), '123456');
    const text = JSON.stringify(file);
    expect(text).not.toContain('Colazione');
    const parsed = parseBackup(text);
    expect(await openBackup(parsed, '000000')).toBeNull();
    const dump = await openBackup(parsed, '123456');
    expect(dump!.tx[0].description).toBe('Colazione');

    // ripristino in un archivio nuovo
    const other = new Vault('test-' + Math.random());
    await other.setup('654321', {});
    await other.replaceAll(dump!);
    expect(other.list('tx')).toHaveLength(1);
  });

  it('rifiuta file non validi', () => {
    expect(() => parseBackup('ciao')).toThrow();
    expect(() => parseBackup('{"format":"altro"}')).toThrow();
  });

  it('CSV in formato italiano', () => {
    const csv = transactionsCSV([sample], initialData().cat!, initialData().acc!);
    expect(csv).toContain('2026-11-07;Costo;-12,50;Alimentazione;Bar e caffetterie;Colazione;;Carta di debito;manual');
  });
});
