// Piccoli componenti e formati condivisi dalle schermate Intelligence.
import { safeUrl } from './model';

export const num = (n?: number, d = 2) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
export const pct = (n?: number) => (typeof n === 'number' && isFinite(n) ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '—');
export const ratio = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);
export const tone = (n?: number) => (typeof n === 'number' ? (n > 0 ? 'good' : n < 0 ? 'danger' : '') : '');
export const when = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
export const dayName = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

export function Ext({ href, children, className }: { href?: string; children: React.ReactNode; className?: string }) {
  const u = safeUrl(href);
  return u ? (
    <a href={u} target="_blank" rel="noopener noreferrer" className={className} style={{ color: 'var(--income)' }}>
      {children}
    </a>
  ) : (
    <span className={className}>{children}</span>
  );
}

export function Src({ source, url, asOf, status }: { source?: string; url?: string; asOf?: string; status?: string }) {
  if (!source && !asOf && !status) return null;
  return (
    <span className="tiny muted" style={{ display: 'block' }}>
      {source && <Ext href={url}>{source}</Ext>}
      {asOf && ` · ${when(asOf)}`}
      {status && ` · ${status}`}
    </span>
  );
}

/** Data (YYYY-MM-DD) nel fuso di Roma */
export const romeDate = (iso?: string) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(iso)) : '');
export const shortDate = (s?: string) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
