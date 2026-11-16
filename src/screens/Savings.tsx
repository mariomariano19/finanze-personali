import { useMemo, useState } from 'react';
import { saveSettings, useData } from '../state/store';
import { useNav } from '../ui/nav';
import { Header, Ring, useToast } from '../ui/common';
import { formatEUR, formatPct, parseEUR } from '../core/money';
import { today } from '../core/dates';
import { advice, budgets, monthProgress, monthsWithData, savingsPlan, simulate, type Advice } from '../analytics/savings';
import { nowISO } from '../core/id';

const monthName = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('it-IT', { month: 'long' });
const KIND_LABEL: Record<Advice['kind'], string> = { small: 'Piccole spese', subscription: 'Abbonamenti', growth: 'In crescita', discretionary: 'Discrezionali', fees: 'Costi bancari' };

export function Savings() {
  const data = useData();
  const nav = useNav();
  const toast = useToast();
  const t = today();
  const goal = data.settings.savingsGoal;
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const plan = useMemo(() => savingsPlan(data.txs, t, goal), [data.txs, t, goal]);
  const nMonths = useMemo(() => monthsWithData(data.txs, t), [data.txs, t]);
  const lines = useMemo(() => budgets(data.txs, data.catMap, t, data.settings.budgets), [data.txs, data.catMap, t, data.settings.budgets]);
  const all = useMemo(() => advice({ txs: data.txs, cats: data.cats, catMap: data.catMap, rules: data.rules, today: t, goalPct: goal }), [data.txs, data.cats, data.catMap, data.rules, t, goal]);
  const st = data.settings.adviceState ?? {};
  const visible = all.filter((a) => !st[a.id]);
  const hidden = all.filter((a) => st[a.id]);
  const sim = simulate(plan, all.filter((a) => chosen.has(a.id)));
  const progress = monthProgress(t);
  const active = lines.filter((l) => l.active);
  const proposed = lines.filter((l) => !l.active);

  function setBudget(id: string, cents: number | null) {
    const b = { ...(data.settings.budgets ?? {}) };
    if (cents === null) delete b[id];
    else b[id] = cents;
    saveSettings({ budgets: b });
  }
  function mark(a: Advice, state: 'done' | 'dismissed' | null) {
    const s = { ...st };
    if (state) s[a.id] = { state, at: nowISO() };
    else delete s[a.id];
    saveSettings({ adviceState: s });
    setChosen((c) => {
      const n = new Set(c);
      n.delete(a.id);
      return n;
    });
    if (state) toast(state === 'done' ? 'Segnato come fatto' : 'Consiglio nascosto');
  }

  const cur = plan.current;
  return (
    <div className="screen no-tab">
      <Header onBack={nav.pop} eyebrow="Piano" title="Risparmio" />

      {nMonths < 2 && (
        <div className="notice info small">
          <span>Hai movimenti per {nMonths === 0 ? 'nessun mese completo' : 'un solo mese completo'}: medie, budget e consigli diventano affidabili con almeno 2–3 mesi. Finché i dati sono pochi, l’app non propone numeri.</span>
        </div>
      )}

      <div className="hero">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span className="label">Risparmiato a {monthName(t.slice(0, 7))}</span>
          <span className="value num">{formatEUR(cur.saved, { sign: true, short: true })}</span>
          <span className="delta">
            obiettivo{' '}
            <select aria-label="Obiettivo di risparmio" value={goal} onChange={(e) => saveSettings({ savingsGoal: Number(e.target.value) })} style={{ width: 'auto', display: 'inline', padding: '0 4px', background: 'transparent', color: 'inherit', border: 0, font: 'inherit', fontWeight: 700 }}>
              {[5, 10, 15, 20, 25, 30, 35, 40, 50].map((v) => <option key={v} value={v}>{v}%</option>)}
            </select>{' '}
            dei ricavi
          </span>
        </div>
        <Ring ratio={cur.rate} label="risparmio" />
      </div>

      {plan.months.length > 0 && (
        <div className="card" style={{ gap: 8 }}>
          <span className="card-title">Ultimi mesi</span>
          {plan.months.map((m) => (
            <div key={m.month} className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ textTransform: 'capitalize' }}>{monthName(m.month)}</span>
              <span className="num">
                <b className={m.saved >= 0 ? 'good' : 'danger'}>{formatEUR(m.saved, { sign: true, short: true })}</b>
                <span className="muted"> · {m.rate === null ? '–' : formatPct(m.rate)}</span>
              </span>
            </div>
          ))}
          <div className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
            <span>Media</span>
            <b className="num">{formatEUR(plan.avgSaved, { sign: true, short: true })} al mese · {plan.avgRate === null ? '–' : formatPct(plan.avgRate)}</b>
          </div>
          <span className="small" style={{ fontWeight: 600 }}>
            {plan.avgIncome === 0
              ? 'Servono dei ricavi registrati per calcolare la percentuale di risparmio.'
              : plan.gapMonthly > 0
                ? `Per arrivare al ${goal}% ti mancano in media ${formatEUR(plan.gapMonthly, { short: true })} al mese.`
                : `In media sei sopra l’obiettivo del ${goal}%.`}
          </span>
          <span className="tiny muted">Risparmio = ricavi − costi. I soldi che investi non sono costi: contano come risparmio.</span>
        </div>
      )}

      <div className="card" style={{ gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="card-title">Budget del mese</span>
          <span className="tiny muted">mese trascorso al {Math.round(progress * 100)}%</span>
        </div>
        {!lines.length && <span className="small muted">Ancora nessuna spesa variabile negli ultimi mesi da cui proporre un budget.</span>}
        {active.map((l) => {
          const color = l.ratio > 1 ? 'var(--danger)' : l.ratio >= 0.8 ? 'var(--warn, #c98a00)' : 'var(--good)';
          return (
            <div key={l.categoryId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{l.name}</span>
                <span className="num">
                  <b style={{ color }}>{formatEUR(l.spent, { short: true })}</b> / {formatEUR(l.limit, { short: true })}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--line-soft)', position: 'relative', overflow: 'hidden' }} role="progressbar" aria-valuenow={Math.round(l.ratio * 100)} aria-label={`${l.name}: ${Math.round(l.ratio * 100)}% del budget`}>
                <div style={{ width: `${Math.min(100, l.ratio * 100)}%`, height: '100%', background: color }} />
                <div style={{ position: 'absolute', left: `${progress * 100}%`, top: 0, bottom: 0, width: 2, background: 'var(--ink)', opacity: 0.35 }} />
              </div>
              {editing === l.categoryId ? (
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input className="search" inputMode="decimal" aria-label="Nuovo budget in euro" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
                  <button className="btn small" onClick={() => { const c = parseEUR(draft); if (c && c > 0) setBudget(l.categoryId, c); setEditing(null); }}>Salva</button>
                  <button className="link" onClick={() => setEditing(null)}>Annulla</button>
                </span>
              ) : (
                <span className="tiny muted" style={{ display: 'flex', gap: 10 }}>
                  <span>media {formatEUR(l.avg, { short: true })}</span>
                  <button className="link" onClick={() => { setEditing(l.categoryId); setDraft(String(l.limit / 100).replace('.', ',')); }}>Modifica</button>
                  <button className="link" onClick={() => setBudget(l.categoryId, null)}>Togli</button>
                </span>
              )}
            </div>
          );
        })}
        {proposed.length > 0 && (
          <>
            <span className="label-caps" style={{ marginTop: active.length ? 6 : 0 }}>Proposti dalla media degli ultimi 3 mesi</span>
            {proposed.slice(0, 8).map((l) => (
              <div key={l.categoryId} className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <span>{l.name} <span className="muted">· questo mese {formatEUR(l.spent, { short: true })}</span></span>
                <button className="btn small secondary" onClick={() => setBudget(l.categoryId, l.proposed)}>{formatEUR(l.proposed, { short: true })} · Attiva</button>
              </div>
            ))}
            {proposed.length > 1 && (
              <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => saveSettings({ budgets: { ...(data.settings.budgets ?? {}), ...Object.fromEntries(proposed.map((l) => [l.categoryId, l.proposed])) } })}>
                Attiva tutti i proposti
              </button>
            )}
          </>
        )}
        <span className="tiny muted">Le spese fisse (affitto, rate, abbonamenti registrati come ricorrenti) non hanno budget: non si decidono mese per mese.</span>
      </div>

      <div className="card" style={{ gap: 12 }}>
        <span className="card-title">Consigli</span>
        {!visible.length && <span className="small muted">{all.length ? 'Hai già gestito tutti i consigli.' : 'Nessun consiglio per ora: le tue spese non mostrano sprechi evidenti, oppure i dati sono ancora pochi.'}</span>}
        {visible.map((a) => (
          <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
            <span className="tiny muted label-caps">{KIND_LABEL[a.kind]}</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <b className="small">{a.title}</b>
              <b className="num small good" style={{ whiteSpace: 'nowrap' }}>≈ {formatEUR(a.yearly, { short: true })}/anno</b>
            </div>
            <span className="small">{a.detail}</span>
            <span className="small muted">{a.action}</span>
            <span className="tiny" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={chosen.has(a.id)} onChange={(e) => setChosen((c) => { const n = new Set(c); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n; })} />
                nella simulazione
              </label>
              {a.evidence.length > 0 && <button className="link" onClick={() => nav.push({ name: 'txList', filter: { ids: a.evidence, title: a.title } })}>Vedi i {a.evidence.length} movimenti</button>}
              <button className="link" onClick={() => mark(a, 'done')}>Fatto</button>
              <button className="link" onClick={() => mark(a, 'dismissed')}>Non mi interessa</button>
            </span>
          </div>
        ))}
        {hidden.length > 0 && (
          <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? 'Nascondi' : `Mostra i ${hidden.length} già gestiti`}
          </button>
        )}
        {showHidden && hidden.map((a) => (
          <div key={a.id} className="small muted" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>{st[a.id].state === 'done' ? '✓ ' : '– '}{a.title}</span>
            <button className="link" onClick={() => mark(a, null)}>Ripristina</button>
          </div>
        ))}
        <span className="tiny muted">Consigli calcolati sul telefono dai tuoi movimenti, con regole fisse: nessun dato lascia il dispositivo. Gli importi sono stime basate sugli ultimi mesi.</span>
      </div>

      {chosen.size > 0 && (
        <div className="card" style={{ gap: 6, borderColor: 'var(--good)' }}>
          <span className="card-title">Simulazione</span>
          <span className="small">
            Seguendo i {chosen.size === 1 ? 'consiglio scelto' : `${chosen.size} consigli scelti`} risparmieresti circa <b className="num">{formatEUR(sim.monthly, { short: true })} al mese</b>, <b className="num">{formatEUR(sim.yearly, { short: true })} l’anno</b>.
          </span>
          {sim.newRate !== null && (
            <span className="small">
              Il tuo risparmio medio passerebbe da {plan.avgRate === null ? '–' : formatPct(plan.avgRate)} a <b>{formatPct(sim.newRate)}</b>
              {sim.reachesGoal ? `: raggiungi l’obiettivo del ${goal}%.` : `: per l’obiettivo del ${goal}% mancherebbero ancora ${formatEUR(Math.max(0, plan.gapMonthly - sim.monthly), { short: true })} al mese.`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
