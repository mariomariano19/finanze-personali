import { useMemo, useState } from 'react';
import { useData } from '../state/store';
import { useNav } from '../ui/nav';
import { Header, IconButton, Empty, useToast } from '../ui/common';
import { Icon } from '../ui/Icon';
import { buildMonthlyReport, type MonthlyReport } from '../analytics/report';
import { formatEUR, formatPct, change } from '../core/money';
import { addMonths, monthKey, monthLabel, monthName, monthStart, today } from '../core/dates';
import { vault } from '../persistence/vault';
import { nowISO } from '../core/id';

export function Reports() {
  const data = useData();
  const nav = useNav();
  const toast = useToast();
  const currentMonth = monthKey(today());
  const firstMonth = data.txs.length ? monthKey(data.txs[data.txs.length - 1].date) : currentMonth;
  // di default: l'ultimo mese chiuso (se esistono dati), altrimenti il mese in corso
  const [month, setMonth] = useState(() => {
    const prev = monthKey(addMonths(monthStart(today()), -1, 1));
    return data.txs.some((t) => monthKey(t.date) === prev) ? prev : currentMonth;
  });
  const snapshot = vault.get('report', month);
  const live = useMemo(() => buildMonthlyReport(month, data.txs, data.ops, data.catMap), [month, data.txs, data.ops, data.catMap]);
  const isClosed = month < currentMonth;
  // Si mostra sempre il report calcolato sui dati attuali; l'archivio di fine mese resta come storico
  const r: MonthlyReport = live;
  const differs = isClosed && snapshot && JSON.stringify(snapshot.data) !== JSON.stringify(live);

  const archive = useMemo(() => {
    const out: string[] = [];
    let m = currentMonth;
    while (m >= firstMonth && out.length < 36) {
      out.push(m);
      m = monthKey(addMonths(`${m}-01`, -1, 1));
    }
    return out;
  }, [currentMonth, firstMonth]);

  const prevName = monthName(monthKey(addMonths(`${month}-01`, -1, 1)), false);
  const delta = (a: number, b: number | undefined) => {
    if (b === undefined) return '';
    const c = change(a, b);
    return c === null ? '' : `${formatPct(c, { sign: true })} vs ${prevName}`;
  };

  function recompute() {
    vault.put('report', { id: month, createdAt: nowISO(), data: live });
    toast('Archivio del report aggiornato');
  }

  return (
    <div className="screen">
      <Header
        eyebrow={isClosed ? 'Report mensile' : 'Report del mese in corso'}
        title={monthLabel(month)}
        actions={
          <>
            <IconButton icon="back" label="Mese precedente" onClick={() => setMonth(monthKey(addMonths(`${month}-01`, -1, 1)))} />
            <IconButton icon="chevron" label="Mese successivo" onClick={() => month < currentMonth && setMonth(monthKey(addMonths(`${month}-01`, 1, 1)))} />
            <IconButton icon="download" label="Esporta PDF" onClick={() => window.print()} />
          </>
        }
      />

      {r.txCount === 0 ? (
        <div className="card"><Empty>Nessun movimento in {monthLabel(month).toLowerCase()}.</Empty></div>
      ) : (
        <>
          {!isClosed && <div className="notice info"><Icon name="info" size={18} /><span>Il mese non è ancora chiuso: i valori sono parziali. Il report definitivo viene archiviato automaticamente a inizio mese.</span></div>}
          {differs && (
            <div className="notice warn">
              <Icon name="info" size={18} />
              <span style={{ flex: 1 }}>Movimenti modificati dopo la chiusura del mese.</span>
              <button className="btn small secondary" onClick={recompute}>Aggiorna archivio</button>
            </div>
          )}

          <div className="kpis two">
            <div className="kpi"><span className="k">Ricavi</span><span className="v income num">{formatEUR(r.income, { short: true })}</span><span className="d">{delta(r.income, r.prev?.income)}</span></div>
            <div className="kpi"><span className="k">Costi</span><span className="v expense num">{formatEUR(r.expense, { short: true })}</span><span className="d">{delta(r.expense, r.prev?.expense)}</span></div>
            <div className="kpi"><span className="k">Investiti</span><span className="v good num">{formatEUR(r.invested, { short: true })}</span><span className="d">flusso netto del mese</span></div>
            <div className="kpi">
              <span className="k">Saldo · risparmio</span>
              <span className="v num">{formatEUR(r.balance, { sign: true, short: true })} · {r.savingsRate === null ? '–' : formatPct(r.savingsRate)}</span>
              <span className="d">obiettivo {data.settings.savingsGoal}%</span>
            </div>
          </div>
          {r.expenseAvg3 !== null && (
            <span className="small muted">
              Spese medie dei 3 mesi precedenti: <b className="num">{formatEUR(r.expenseAvg3, { short: true })}</b>
              {(() => { const c = change(r.expense, r.expenseAvg3); return c === null ? '' : ` (questo mese ${formatPct(c, { sign: true })})`; })()}
            </span>
          )}

          <div className="card">
            <span className="card-title">Principali categorie di spesa</span>
            {r.topCategories.length === 0 && <span className="small muted">Nessuna spesa nel mese.</span>}
            {r.topCategories.map((c) => (
              <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>{c.name}</span>
                  <b className="num">{formatEUR(c.amount, { short: true })} <span className="muted" style={{ fontWeight: 500 }}>· {formatPct(c.share)}</span></b>
                </div>
                <div className="bar-track"><span style={{ width: `${c.share * 100}%`, background: 'var(--expense-strong)' }} /></div>
              </div>
            ))}
          </div>

          <div className="card">
            <span className="card-title">Variazioni da tenere d’occhio</span>
            {r.variations.length === 0 ? (
              <span className="small muted">Nessuna variazione significativa rispetto alla media dei 3 mesi precedenti.</span>
            ) : (
              r.variations.map((v) => {
                const up = v.change > 0;
                return (
                  <div className="variation" key={v.id}>
                    <span className="ic" style={{ background: up ? 'var(--expense-soft)' : 'var(--good-soft)' }}>
                      <Icon name={up ? 'expense' : 'income'} size={14} stroke={2.4} color={up ? 'var(--expense)' : 'var(--good)'} />
                    </span>
                    <span style={{ flex: 1 }}>{v.name} <span className="muted num">· {formatEUR(v.amount, { short: true })}</span></span>
                    <b className={up ? 'expense' : 'good'}>{formatPct(v.change, { sign: true })} sulla media</b>
                  </div>
                );
              })
            )}
          </div>

          {r.junk.map((g) => (
            <div className="junk" key={g.key}>
              <span className="eyebrow">JUNK COST</span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{g.label}: {g.count} acquisti da circa {formatEUR(g.avg)}</span>
              <span className="small" style={{ color: '#3d4249' }}>{formatEUR(g.total)} nel mese, spese piccole che sommate pesano.</span>
              <span className="expense num" style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{formatEUR(g.annual, { short: true })} all’anno</span>
            </div>
          ))}

          <div className="card">
            <div className="card-title"><span>Spese ricorrenti</span><span className="aside num">{formatEUR(r.recurringTotal, { short: true })}</span></div>
            {r.recurring.length === 0 ? <span className="small muted">Nessuna spesa fissa registrata.</span> : r.recurring.slice(0, 8).map((x) => (
              <div key={x.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{x.label}</span><b className="num">{formatEUR(x.amount)}</b></div>
            ))}
          </div>

          <div className="card">
            <div className="card-title"><span>Spese discrezionali</span><span className="aside num">{formatEUR(r.discretionaryTotal, { short: true })}{r.expense > 0 ? ` · ${formatPct(r.discretionaryTotal / r.expense)}` : ''}</span></div>
            {r.discretionary.length === 0 ? <span className="small muted">Nessuna spesa discrezionale.</span> : r.discretionary.map((x) => (
              <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{x.name}</span><b className="num">{formatEUR(x.amount)}</b></div>
            ))}
          </div>

          <div className="notice info">
            <Icon name="info" size={18} />
            <span>I suggerimenti di risparmio personalizzati, con il risparmio mensile e annuo stimato, arrivano con la Fase 5.</span>
          </div>
        </>
      )}

      <div className="section-title"><h2>Archivio</h2></div>
      <div className="chips">
        {archive.map((m) => (
          <button key={m} className="chip" aria-pressed={m === month} onClick={() => setMonth(m)}>
            {monthLabel(m)}
          </button>
        ))}
      </div>
      <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => nav.push({ name: 'backup' })}>
        Esporta i dati
      </button>
    </div>
  );
}
