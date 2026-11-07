import { useMemo } from 'react';
import { useData } from '../state/store';
import { useNav } from '../ui/nav';
import { Header, IconButton, PeriodPicker, Empty } from '../ui/common';
import { Chart, AXIS, TOOLTIP, INCOME_SCALE, donutOption, topSlices } from '../ui/Chart';
import { byCategory, incomeSplit, monthlySeries, totals } from '../analytics/stats';
import { formatEUR, formatPct, change } from '../core/money';
import { inPeriod, lastMonths, monthShort, periodLabel, shiftPeriod, today } from '../core/dates';
import { TxGroupedList } from '../ui/TxRow';

export function Income() {
  const data = useData();
  const nav = useNav();
  const p = nav.period;
  const cur = totals(data.txs, p);
  const prev = totals(data.txs, shiftPeriod(p, -1));
  const ch = change(cur.income, prev.income);
  const split = incomeSplit(data.txs, p, data.catMap);
  const slices = byCategory(data.txs, 'income', p, data.catMap);
  const donut = useMemo(() => donutOption(topSlices(slices, 6), INCOME_SCALE), [slices]);

  const months = lastMonths(12, p.end > today() ? today() : p.end);
  const series = monthlySeries(data.txs, months);
  const withData = series.filter((s) => s.income > 0);
  const avg = withData.length ? Math.round(withData.reduce((s, x) => s + x.income, 0) / withData.length) : 0;
  const yearTotal = series.reduce((s, x) => s + x.income, 0);
  const line = useMemo(
    () => ({
      animationDuration: 300,
      grid: { left: 4, right: 8, top: 10, bottom: 22 },
      tooltip: { ...TOOLTIP, valueFormatter: (v: number) => formatEUR(v * 100, { short: true }) },
      xAxis: { type: 'category', data: months.map(monthShort), boundaryGap: false, axisLine: { lineStyle: { color: '#e3e3df' } }, axisTick: { show: false }, axisLabel: { ...AXIS, interval: 2 } },
      yAxis: { type: 'value', show: false, scale: true },
      series: [{ name: 'Ricavi', type: 'line', data: series.map((s) => s.income / 100), smooth: false, symbol: 'circle', symbolSize: 5, lineStyle: { color: '#1d4ed8', width: 2.2 }, itemStyle: { color: '#1d4ed8' }, areaStyle: { color: 'rgba(29,78,216,0.06)' } }]
    }),
    [series.map((s) => s.income).join()] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const list = data.txs.filter((t) => t.type === 'income' && inPeriod(t.date, p));
  const recPct = cur.income > 0 ? split.recurring / cur.income : 0;

  return (
    <div className="screen">
      <Header eyebrow={periodLabel(p)} title="Ricavi" actions={<IconButton icon="filter" label="Tutti i ricavi" onClick={() => nav.push({ name: 'txList', filter: { type: 'income', title: 'Tutti i ricavi' } })} />} />
      <PeriodPicker period={p} onChange={nav.setPeriod} />

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span className="big-amount income num">{formatEUR(cur.income, { short: true })}</span>
          <span className="small muted">{ch === null ? 'nessun confronto' : `${formatPct(ch, { sign: true })} vs periodo prec.`}</span>
        </div>
        <div className="split-bar" aria-hidden="true">
          {cur.income > 0 && <span style={{ width: `${recPct * 100}%`, background: '#1d4ed8' }} />}
          {cur.income > 0 && <span style={{ width: `${(1 - recPct) * 100}%`, background: '#9dbcf7' }} />}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }} className="small">
          <span>
            <b>Ricorrenti</b> <span className="muted num">{formatEUR(split.recurring, { short: true })} · {formatPct(recPct)}</span>
          </span>
          <span>
            <b>Occasionali</b> <span className="muted num">{formatEUR(split.other, { short: true })} · {formatPct(cur.income > 0 ? 1 - recPct : 0)}</span>
          </span>
        </div>
      </div>

      {slices.length > 0 && (
        <div className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 110, flex: 'none' }}>
            <Chart option={donut} height={110} label="Distribuzione dei ricavi per categoria" />
          </div>
          <div className="legend">
            {topSlices(slices, 6).map((s, i) => (
              <div className="li" key={s.name}>
                <span className="sw" style={{ background: INCOME_SCALE[Math.min(i, INCOME_SCALE.length - 1)], border: i >= 3 ? '1px solid #b7c9f3' : undefined }} />
                <span>{s.name}</span>
                <b className="num">{formatEUR(s.amount, { short: true })}</b>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">
          <span>Andamento 12 mesi</span>
          <span className="aside num">
            media {formatEUR(avg, { short: true })} · totale {formatEUR(yearTotal, { short: true })}
          </span>
        </div>
        <Chart option={line} height={110} label="Andamento dei ricavi negli ultimi 12 mesi" />
      </div>

      <div className="section-title">
        <h2>Movimenti</h2>
      </div>
      {list.length === 0 ? (
        <div className="card">
          <Empty action={<button className="btn small" onClick={() => nav.openSheet({ name: 'tx', type: 'income' })}>Aggiungi un ricavo</button>}>Nessun ricavo in questo periodo.</Empty>
        </div>
      ) : (
        <TxGroupedList txs={list} catMap={data.catMap} accs={data.accs} limit={40} />
      )}
    </div>
  );
}
