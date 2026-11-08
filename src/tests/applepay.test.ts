import { describe, expect, it } from 'vitest';
import { categorize, findDup, learn, normMerchant, parseAmount, parseApplePay, parseDate, planImport } from '../ledger/applepay';
import type { Settings, Transaction } from '../core/types';

const S: Settings = { id: 'settings', savingsGoal: 20, autoLockMinutes: 5, lastBackupAt: null, backupReminderDays: 7, createdAt: '2026-01-01' };
const accs = [{ id: 'acc-carta', name: 'Carta Intesa', kind: 'card' }, { id: 'acc-cc', name: 'Conto corrente', kind: 'checking' }];
const tx = (p: Partial<Transaction>): Transaction => ({ id: 'x', type: 'expense', amount: 0, date: '2026-11-01', categoryId: null, description: '', accountId: null, source: 'manual', createdAt: '', updatedAt: '', ...p });

describe('import Apple Pay', () => {
  it('importi e date nei formati che Comandi può produrre', () => {
    expect(parseAmount('12,50 €')).toBe(1250);
    expect(parseAmount('€12.50')).toBe(1250);
    expect(parseAmount('1.234,56 EUR')).toBe(123456);
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount('€ 3')).toBe(300);
    expect(parseAmount('-3,2')).toBe(-320);
    expect(parseAmount('abc')).toBeNull();
    expect(parseDate('2026-11-08T10:57:00+01:00')).toBe('2026-11-08');
    expect(parseDate('8/11/2026, 10:57')).toBe('2026-11-08');
  });

  it('righe valide, righe sporche, doppie identiche', () => {
    const text = 'FP1|2026-11-08T10:57:00+01:00|12,50 €|ESSELUNGA S.P.A.|Carta Intesa\nriga sbagliata\nFP1|2026-11-08T10:57:00+01:00|12,50 €|ESSELUNGA S.P.A.|Carta Intesa\n\nFP1|2026-11-09|-5,00 €|Zara|Carta Intesa';
    const r = parseApplePay(text);
    expect(r.entries).toHaveLength(2);
    expect(r.skipped).toEqual(['riga sbagliata']);
    expect(r.entries[1]).toMatchObject({ amount: 500, refund: true, merchant: 'Zara' });
    expect(r.entries[0].id).toMatch(/^ap-[0-9a-f]{16}$/);
  });

  it('categorie imparate e regole a mano', () => {
    expect(normMerchant('ESSELUNGA S.P.A. 1234')).toBe('esselunga');
    const s = { merchantRules: { esselunga: 'cat-spesa' }, keywordRules: [{ id: 'k', contains: 'amazon', categoryId: 'cat-online' }] };
    expect(categorize('Esselunga spa', s)).toEqual({ categoryId: 'cat-spesa', known: true });
    expect(categorize('AMAZON EU SARL', s)).toEqual({ categoryId: 'cat-online', known: true });
    expect(categorize('Bar Roma', s)).toEqual({ categoryId: null, known: false });
    expect(learn(S, { type: 'expense', merchant: 'Bar Roma 2', categoryId: 'cat-bar', card: 'Carta Intesa', accountId: 'acc-carta' })).toEqual({ merchantRules: { 'bar roma': 'cat-bar' }, cardRules: { 'Carta Intesa': 'acc-carta' } });
  });

  it('piano di import: nuovi da confermare, già importati saltati, doppioni segnalati, conto dalla carta', () => {
    const text = 'FP1|2026-11-08|12,50 €|Esselunga|Carta Intesa\nFP1|2026-11-08|40,00 €|Benzina Q8|Carta Intesa';
    const manual = tx({ id: 'm1', amount: 4000, date: '2026-11-07', description: 'Benzina' });
    const p1 = planImport(text, [manual], { ...S, merchantRules: { esselunga: 'cat-spesa' } }, accs, '2026-11-08T12:00:00Z');
    expect(p1.add).toHaveLength(2);
    expect(p1.add[0]).toMatchObject({ categoryId: 'cat-spesa', accountId: 'acc-carta', needsReview: true, source: 'wallet' });
    expect(p1.add[1].dupOf).toBe('m1');
    expect(p1.duplicates).toBe(1);
    // reimportare lo stesso file non aggiunge nulla
    const p2 = planImport(text, [manual, ...p1.add], S, accs, '2026-11-09T12:00:00Z');
    expect(p2.add).toHaveLength(0);
    expect(p2.already).toBe(2);
    // un pagamento eliminato (doppione) non torna
    const p2b = planImport(text, [manual, p1.add[0]], { ...S, apIgnored: [p1.add[1].id] }, accs, '2026-11-09T12:00:00Z');
    expect(p2b.add).toHaveLength(0);
    // conferma automatica degli esercenti noti, se attivata
    const p3 = planImport('FP1|2026-11-10|9,90 €|Esselunga|Carta Intesa', [], { ...S, merchantRules: { esselunga: 'cat-spesa' }, autoConfirmKnown: true }, accs, '2026-11-10T12:00:00Z');
    expect(p3.add[0].needsReview).toBe(false);
    expect(p3.autoConfirmed).toBe(1);
  });

  it('due pagamenti Apple Pay uguali non sono doppioni tra loro', () => {
    const a = tx({ id: 'ap-1', amount: 150, date: '2026-11-08', source: 'wallet' });
    expect(findDup({ id: 'ap-2', amount: 150, date: '2026-11-08', refund: false }, [a])).toBeNull();
  });
});
