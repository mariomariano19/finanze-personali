// Date gestite come stringhe 'YYYY-MM-DD' nel fuso locale: niente sorprese con l'ora legale.

export type PeriodKind = 'week' | 'month' | 'quarter' | 'year' | 'custom';
export interface Period {
  kind: PeriodKind;
  start: string;
  end: string; // inclusiva
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(): string {
  return toISO(new Date());
}

export function addDays(s: string, n: number): string {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Aggiunge mesi mantenendo il giorno; se il mese è più corto usa l'ultimo giorno disponibile */
export function addMonths(s: string, n: number, anchorDay?: number): string {
  const [y, m, d] = s.split('-').map(Number);
  const day = anchorDay ?? d;
  const target = new Date(y, m - 1 + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return toISO(target);
}

export function monthKey(s: string): string {
  return s.slice(0, 7);
}

export function monthStart(s: string): string {
  return `${s.slice(0, 7)}-01`;
}

export function monthEnd(s: string): string {
  const [y, m] = s.split('-').map(Number);
  return toISO(new Date(y, m, 0));
}

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MONTHS_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

export function monthName(key: string, capital = true): string {
  const m = Number(key.slice(5, 7)) - 1;
  const name = MONTHS[m];
  return capital ? name[0].toUpperCase() + name.slice(1) : name;
}

export function monthLabel(key: string): string {
  return `${monthName(key)} ${key.slice(0, 4)}`;
}

export function monthShort(key: string): string {
  return MONTHS_SHORT[Number(key.slice(5, 7)) - 1];
}

export function dayLabel(s: string, ref = today()): string {
  if (s === ref) return 'Oggi';
  if (s === addDays(ref, -1)) return 'Ieri';
  const d = fromISO(s);
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()].toLowerCase()}`;
  return s.slice(0, 4) === ref.slice(0, 4) ? base : `${base} ${s.slice(0, 4)}`;
}

/** Ultimi n mesi fino a quello di riferimento incluso, dal più vecchio */
export function lastMonths(n: number, ref = today()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(addMonths(monthStart(ref), -i, 1)));
  return out;
}

export function periodFor(kind: Exclude<PeriodKind, 'custom'>, ref = today()): Period {
  const d = fromISO(ref);
  if (kind === 'week') {
    const dow = (d.getDay() + 6) % 7; // lunedì = 0
    const start = addDays(ref, -dow);
    return { kind, start, end: addDays(start, 6) };
  }
  if (kind === 'month') return { kind, start: monthStart(ref), end: monthEnd(ref) };
  if (kind === 'quarter') {
    const q = Math.floor(d.getMonth() / 3);
    const start = toISO(new Date(d.getFullYear(), q * 3, 1));
    return { kind, start, end: monthEnd(addMonths(start, 2, 1)) };
  }
  return { kind, start: `${d.getFullYear()}-01-01`, end: `${d.getFullYear()}-12-31` };
}

/** Periodo precedente di pari tipo (per i confronti) */
export function shiftPeriod(p: Period, dir: -1 | 1): Period {
  if (p.kind === 'week') return { ...p, start: addDays(p.start, 7 * dir), end: addDays(p.end, 7 * dir) };
  if (p.kind === 'month') return periodFor('month', addMonths(p.start, dir, 1));
  if (p.kind === 'quarter') return periodFor('quarter', addMonths(p.start, 3 * dir, 1));
  if (p.kind === 'year') return periodFor('year', addMonths(p.start, 12 * dir, 1));
  const len = daysBetween(p.start, p.end) + 1;
  return { ...p, start: addDays(p.start, len * dir), end: addDays(p.end, len * dir) };
}

export function daysBetween(a: string, b: string): number {
  return Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86400000);
}

export function periodLabel(p: Period): string {
  if (p.kind === 'month') return monthLabel(monthKey(p.start));
  if (p.kind === 'year') return p.start.slice(0, 4);
  if (p.kind === 'quarter') return `${Math.floor((Number(p.start.slice(5, 7)) - 1) / 3) + 1}° trimestre ${p.start.slice(0, 4)}`;
  return `${dayLabel(p.start)} – ${dayLabel(p.end)}`;
}

export const inPeriod = (date: string, p: { start: string; end: string }) => date >= p.start && date <= p.end;
