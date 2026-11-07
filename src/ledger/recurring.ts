import type { RecurringRule, Transaction } from '../core/types';
import { addDays, addMonths } from '../core/dates';
import { nowISO } from '../core/id';

/** Date delle occorrenze di una regola comprese tra after (esclusa) e upTo (inclusa) */
export function occurrences(rule: RecurringRule, upTo: string, after?: string | null): string[] {
  const out: string[] = [];
  const anchorDay = Number(rule.startDate.slice(8, 10));
  const end = rule.endDate && rule.endDate < upTo ? rule.endDate : upTo;
  let d = rule.startDate;
  let i = 0;
  while (d <= end && i < 2000) {
    if (!after || d > after) out.push(d);
    i++;
    if (rule.frequency === 'weekly') d = addDays(rule.startDate, 7 * i);
    else if (rule.frequency === 'monthly') d = addMonths(rule.startDate, i, anchorDay);
    else if (rule.frequency === 'quarterly') d = addMonths(rule.startDate, 3 * i, anchorDay);
    else d = addMonths(rule.startDate, 12 * i, anchorDay);
  }
  return out;
}

export function nextOccurrence(rule: RecurringRule, from: string): string | null {
  const list = occurrences(rule, addDays(from, 400), addDays(from, -1));
  return list[0] ?? null;
}

/**
 * Crea i movimenti mancanti per le regole attive fino a oggi.
 * L'id è deterministico (regola + data): una stessa occorrenza non può essere creata due volte.
 */
export function generateDue(rules: RecurringRule[], existingIds: Set<string>, today: string) {
  const txs: Transaction[] = [];
  const updated: RecurringRule[] = [];
  for (const r of rules) {
    if (!r.active) continue;
    const dates = occurrences(r, today, r.lastGenerated);
    if (dates.length === 0) continue;
    for (const date of dates) {
      const id = `rec-${r.id}-${date}`;
      if (existingIds.has(id)) continue;
      const now = nowISO();
      txs.push({
        id,
        type: r.type,
        amount: r.amount,
        date,
        categoryId: r.categoryId,
        description: r.description,
        accountId: r.accountId,
        source: 'recurring',
        recurringId: r.id,
        createdAt: now,
        updatedAt: now
      });
    }
    updated.push({ ...r, lastGenerated: dates[dates.length - 1] });
  }
  return { txs, updated };
}

export const FREQUENCY_LABEL = { weekly: 'Settimanale', monthly: 'Mensile', quarterly: 'Trimestrale', yearly: 'Annuale' } as const;

/** Importo equivalente mensile di una regola (per i totali abbonamenti) */
export function monthlyEquivalent(r: Pick<RecurringRule, 'amount' | 'frequency'>): number {
  if (r.frequency === 'weekly') return Math.round((r.amount * 52) / 12);
  if (r.frequency === 'quarterly') return Math.round(r.amount / 3);
  if (r.frequency === 'yearly') return Math.round(r.amount / 12);
  return r.amount;
}
