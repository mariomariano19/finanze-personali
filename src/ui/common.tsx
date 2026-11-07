import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { periodFor, periodLabel, shiftPeriod, type Period, type PeriodKind } from '../core/dates';

// ---------- notifiche brevi ----------
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

// ---------- intestazione ----------
export function Header({ eyebrow, title, actions, onBack }: { eyebrow?: string; title: string; actions?: ReactNode; onBack?: () => void }) {
  return (
    <>
      {onBack && (
        <button className="back" onClick={onBack} style={{ alignSelf: 'flex-start', marginBottom: -12 }}>
          <Icon name="back" size={18} /> Indietro
        </button>
      )}
      <div className="header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
        </div>
        {actions && <div className="header-actions">{actions}</div>}
      </div>
    </>
  );
}

export function IconButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button className="icon-btn" aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

// ---------- controllo segmentato ----------
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- selettore del periodo (settimana, mese, trimestre, anno, personalizzato) ----------
const PERIOD_OPTIONS: { value: PeriodKind; label: string }[] = [
  { value: 'week', label: 'Sett.' },
  { value: 'month', label: 'Mese' },
  { value: 'quarter', label: 'Trim.' },
  { value: 'year', label: 'Anno' },
  { value: 'custom', label: 'Altro' }
];

export function PeriodPicker({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const setKind = (k: PeriodKind) => {
    if (k === 'custom') onChange({ kind: 'custom', start: period.start, end: period.end });
    else onChange(periodFor(k));
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Segmented value={period.kind} options={PERIOD_OPTIONS} onChange={setKind} label="Periodo" />
      {period.kind === 'custom' ? (
        <div className="custom-range">
          <label>
            Dal
            <input type="date" value={period.start} max={period.end} onChange={(e) => e.target.value && onChange({ ...period, start: e.target.value })} />
          </label>
          <label>
            Al
            <input type="date" value={period.end} min={period.start} onChange={(e) => e.target.value && onChange({ ...period, end: e.target.value })} />
          </label>
        </div>
      ) : (
        <div className="period-nav">
          <button className="icon-btn" aria-label="Periodo precedente" onClick={() => onChange(shiftPeriod(period, -1))}>
            <Icon name="back" size={18} />
          </button>
          <span className="label">{periodLabel(period)}</span>
          <button className="icon-btn" aria-label="Periodo successivo" onClick={() => onChange(shiftPeriod(period, 1))}>
            <Icon name="chevron" size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- foglio modale dal basso ----------
export function Sheet({ title, onClose, children, right }: { title: string; onClose: () => void; children: ReactNode; right?: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grabber" />
        <div className="sheet-head">
          <div className="side">
            <button className="link" style={{ fontSize: 15 }} onClick={onClose}>
              Annulla
            </button>
          </div>
          <h2>{title}</h2>
          <div className="side">{right}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span>{children}</span>
      {action}
    </div>
  );
}

/** Anello percentuale (tasso di risparmio) */
export function Ring({ ratio, label }: { ratio: number | null; label: string }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const v = ratio === null ? 0 : Math.max(0, Math.min(1, ratio));
  return (
    <div className="ring">
      <svg width="92" height="92" viewBox="0 0 92 92" role="img" aria-label={`${label} ${ratio === null ? 'non disponibile' : Math.round(ratio * 100) + ' per cento'}`}>
        <circle cx="46" cy="46" r={r} fill="none" stroke="#2a2e33" strokeWidth="9" />
        {v > 0 && <circle cx="46" cy="46" r={r} fill="none" stroke="#3fcfa2" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${v * c} ${c}`} transform="rotate(-90 46 46)" />}
      </svg>
      <div className="center">
        <b>{ratio === null ? '–' : `${Math.round(ratio * 100)}%`}</b>
        <span>{label}</span>
      </div>
    </div>
  );
}
