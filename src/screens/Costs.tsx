import { useMemo, useState } from 'react';
import { useData } from '../state/store';
import { useNav } from '../ui/nav';
import { Header, IconButton, PeriodPicker, Empty } from '../ui/common';
import { Icon } from '../ui/Icon';
import { Chart, EXPENSE_SCALE, donutOption, topSlices } from '../ui/Chart';
import { byCategory, junkCosts, natureOf, needOf, previousMonthsAverage, totals } from '../analytics/stats';
import { monthlyEquivalent } from '../ledger/recurring';
import { formatEUR, formatPct, change } from '../core/money';
import { daysBetween, inPeriod, monthKey, periodLabel, shiftPeriod } from '../core/dates';
import { TxGroupedList } from '../ui/TxRow';
import type { Transaction } from '../core/types';

type Filter = 'all' | 'fixed' | 'variable' | 'occasional' | 'necessary' | 'discretionary' | 'junk';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Tutte' },
  { value: 'fixed', label: 'Fisse' },
  { value: 'variable', label: 'Variabili' },
  { value: 'occasional', label: 'Occasionali' },
  { value: 'necessary', label: 'Necessarie' },
  { value: 'discretionary', label: 'Discrezionali' },
  { value: 'junk', label: 'Junk costs' }
];

export function Costs() {
  const data = useData();
  const nav = useNav();
  const p = nav.period;
  const [filter, setFilter] = useState<Filter>('all');

  const junk = useMemo(() => junkCosts(data.txs, p, data.catMap, daysBetween(p.start, p.end) + 1), [data.txs, data.catMap, p]);
  const junkIds = useMemo(() => new Set(junk.flatMap((g) => g.txIds)), [junk]);

  const match = (t: Transaction) => {
    if (filter === 'all') return true;
    if (filter === 'junk') return junkIds.has(t.id);
    if (filter === 'necessary' || filter === 'discretionary') return needOf(t, data.catMap) === filter;
    return natureOf(t, data.catMap) === filter;
  };
  const filtered = data.txs.filter((t) => t.type === 'expense' && match(t));
  const cur = totals(filtered, p);
  const allCur = totals(data.txs, p);
  const prev = totals(data.txs.filter((t) => t.type === 'expense' && match(t)), shiftPeriod(p, -1));

  // Per il mese: confronto con la media dei 3 mesi precedenti, come nel mockup
  const avg3 = p.kind === 'month' ? previousMonthsAverage(data.txs, monthKey(p.start), 3, 'expense', match) : null;
  const ref = avg3 ?? prev.expense;
  const ch = change(cur.expense, ref);

  const slices = byCategory(filtered, 'expense', p, data.catMap);
  const shown = topSlices(slices, 6);
  const donut = useMemo(() => donutOption(shown, EXPENSE_SCALE), [JSON.stringify(shown)]); // eslint-disable-line react-hooks/exhaustive-deps

  const subs = data.rules.filter((r) => r.active && r.type === 'expense');
  const subsMonthly = subs.reduce((s, r) => s + monthlyEquivalent(r), 0);
  const list = filtered.filter((t) => inPeriod(t.date, p));

  return (
    <div className="screen">
      <Header eyebrow={periodLabel(p)} title="Costi" actions={<IconButton icon="grid" label="Gestisci categorie" onClick={() => nav.push({ name: 'categories', kind: 'expense' })} />} />
      <PeriodPicker period={p} onChange={nav.setPeriod} />

      <div className="chips" role="group" aria-label="Tipo di spesa">
        {FILTERS.map((f) => (
          <button key={f.value} className="chip" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="card" style={{ gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span className="big-amount expense num">{formatEUR(cur.expense, { short: true })}</span>
          <span className="small muted" style={{ textAlign: 'right' }}>
            {avg3 !== null ? `media 3 mesi ${formatEUR(avg3, { short: true })}` : 'periodo precedente ' + formatEUR(prev.expense, { short: true })}
            <br />
            {ch !== null && <b className={ch > 0 ? 'expense' : 'good'}>{formatPct(ch, { sign: true })}</b>}
          </span>
        </div>
        {filter !== 'all' && allCur.expense > 0 && <span className="small muted">{formatPct(cur.expense / allCur.expense)} del totale delle spese del periodo</span>}
        {slices.length > 0 ? (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ width: 116, flex: 'none' }}>
              <Chart option={donut} height={116} label="Distribuzione dei costi per macro-categoria" />
            </div>
            <div className="legend">
              {shown.map((s, i) => {
                const slice = slices.find((x) => x.name === s.name);
                return (
                  <button
                    key={s.name}
                    className="li"
                    style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', minHeight: 24 }}
                    onClick={() => slice && slice.id !== 'none' && nav.push({ name: 'txList', filter: { type: 'expense', macroId: slice.id, period: p, title: slice.name } })}
                  >
                    <span className="sw" style={{ background: EXPENSE_SCALE[Math.min(i, EXPENSE_SCALE.length - 1)], border: i >= 4 ? '1px solid #e8b98f' : undefined }} />
                    <span>{s.name}</span>
                    <b className="num">{formatEUR(s.amount, { short: true })}</b>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <span className="small muted">Nessuna spesa {filter === 'all' ? '' : 'di questo tipo '}nel periodo.</span>
        )}
      </div>

      {filter === 'junk' && (
        <div className="notice info">
          <Icon name="info" size={18} />
          <span>Junk costs: spese discrezionali fino a 10 € ripetute almeno 4 volte nel periodo. L’analisi verrà affinata nella Fase 5.</span>
        </div>
      )}
      {filter === 'junk' &&
        junk.map((g) => (
          <div className="junk" key={g.key}>
            <span className="eyebrow">JUNK COST</span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {g.label}: {g.count} acquisti, in media {formatEUR(g.avg)}
            </span>
            <span className="small" style={{ color: '#3d4249' }}>
              {formatEUR(g.total)} nel periodo.
            </span>
            <span style={{ fontSize: 20, fontWeight: 700 }} className="expense num">
              {formatEUR(g.annual, { short: true })} all’anno
            </span>
          </div>
        ))}

      <button className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, textAlign: 'left', padding: '14px 16px' }} onClick={() => nav.push({ name: 'recurring' })}>
        <span className="row" style={{ border: 0, minHeight: 0, padding: 0, width: 'auto' }}>
          <span className="ic">
            <Icon name="repeat" size={18} color="var(--expense)" />
          </span>
        </span>
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{subs.length === 1 ? '1 spesa ricorrente attiva' : `${subs.length} spese ricorrenti attive`}</span>
          <span className="small muted num">
            {formatEUR(subsMonthly)} al mese · {formatEUR(subsMonthly * 12, { short: true })} all’anno
          </span>
        </span>
        <Icon name="chevron" size={16} color="var(--muted)" />
      </button>

      <div className="section-title">
        <h2>Movimenti</h2>
        {list.length > 0 && (
          <button className="link" onClick={() => nav.push({ name: 'txList', filter: { type: 'expense', title: 'Tutte le spese' } })}>
            Vedi tutti
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <div className="card">
          <Empty action={<button className="btn small" onClick={() => nav.openSheet({ name: 'tx', type: 'expense' })}>Aggiungi una spesa</button>}>Nessuna spesa in questo periodo.</Empty>
        </div>
      ) : (
        <TxGroupedList txs={list} catMap={data.catMap} accs={data.accs} limit={40} />
      )}
    </div>
  );
}
