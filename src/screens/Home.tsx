import { useMemo } from 'react';
import { useData } from '../state/store';
import { useNav } from '../ui/nav';
import { Header, IconButton, PeriodPicker, Ring, Empty } from '../ui/common';
import { Icon } from '../ui/Icon';
import { Chart, AXIS, TOOLTIP } from '../ui/Chart';
import { totals, monthlySeries } from '../analytics/stats';
import { netInvested } from '../analytics/investments';
import { formatEUR, formatPct, change } from '../core/money';
import { daysBetween, lastMonths, monthShort, periodLabel, shiftPeriod, today } from '../core/dates';
import { TxGroupedList } from '../ui/TxRow';

export function Home() {
  const data = useData();
  const nav = useNav();
  const p = nav.period;
  const prevP = shiftPeriod(p, -1);
  const cur = totals(data.txs, p);
  const prev = totals(data.txs, prevP);
  const invested = netInvested(data.ops, p.start, p.end);
  const toReview = data.txs.filter((t) => t.needsReview).length;
  const balanceDiff = cur.balance - prev.balance;
  const hasPrev = prev.income + prev.expense > 0;
  const prevName = p.kind === 'month' ? periodLabel(prevP).split(' ')[0].toLowerCase() : 'periodo prec.';

  const months = lastMonths(6, p.kind === 'custom' ? p.end : p.end > today() ? today() : p.end);
  const series = useMemo(() => monthlySeries(data.txs, months), [data.txs, months.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const option = useMemo(
    () => ({
      animationDuration: 300,
      grid: { left: 4, right: 4, top: 8, bottom: 22, containLabel: false },
      tooltip: { ...TOOLTIP, valueFormatter: (v: number) => formatEUR(v * 100, { short: true }) },
      xAxis: { type: 'category', data: months.map(monthShort), axisLine: { lineStyle: { color: '#e3e3df' } }, axisTick: { show: false }, axisLabel: AXIS },
      yAxis: { type: 'value', show: false },
      series: [
        { name: 'Ricavi', type: 'bar', data: series.map((s) => s.income / 100), barWidth: 12, barGap: '30%', itemStyle: { color: '#1d4ed8', borderRadius: [3, 3, 0, 0] } },
        { name: 'Costi', type: 'bar', data: series.map((s) => s.expense / 100), barWidth: 12, itemStyle: { color: '#f08a3c', borderRadius: [3, 3, 0, 0] } }
      ]
    }),
    [series] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const recent = data.txs.filter((t) => t.date <= today()).slice(0, 5);
  const showBackupReminder = (() => {
    if (data.txs.length === 0) return false;
    const last = data.settings.lastBackupAt;
    if (!last) return true;
    return daysBetween(last.slice(0, 10), today()) >= data.settings.backupReminderDays;
  })();

  const deltaPct = (a: number, b: number) => {
    const c = change(a, b);
    return c === null ? 'nessun confronto' : `${formatPct(c, { sign: true })} vs ${prevName}`;
  };

  return (
    <div className="screen">
      <Header eyebrow={periodLabel(p)} title="Panoramica" actions={<IconButton icon="gear" label="Impostazioni" onClick={() => nav.push({ name: 'settings' })} />} />
      <PeriodPicker period={p} onChange={nav.setPeriod} />

      {data.lastError && (
        <div className="notice err" role="alert">
          <Icon name="info" size={18} /> Errore di salvataggio: {data.lastError}. Esporta subito un backup.
        </div>
      )}
      {showBackupReminder && (
        <button className="review" onClick={() => nav.push({ name: 'backup' })}>
          <span className="badge" style={{ background: 'var(--ink)' }}>
            <Icon name="shield" size={16} color="#fff" />
          </span>
          <span style={{ flex: 1 }}>
            {data.settings.lastBackupAt ? 'È ora di fare il backup settimanale' : 'Fai il primo backup dei tuoi dati'}
          </span>
          <Icon name="chevron" size={16} color="var(--muted)" />
        </button>
      )}

      <div className="hero">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span className="label">Saldo del periodo</span>
          <span className="value num">{formatEUR(cur.balance, { sign: true, short: true })}</span>
          {hasPrev && (
            <span className={`delta ${balanceDiff < 0 ? 'neg' : ''}`}>
              {formatEUR(balanceDiff, { sign: true, short: true })} rispetto a {prevName}
            </span>
          )}
        </div>
        <Ring ratio={cur.savingsRate} label="risparmio" />
      </div>

      <div className="kpis">
        <button className="kpi" onClick={() => nav.setTab('income')}>
          <span className="k">Ricavi</span>
          <span className="v income num">{formatEUR(cur.income, { short: true })}</span>
          <span className="d">{deltaPct(cur.income, prev.income)}</span>
        </button>
        <button className="kpi" onClick={() => nav.setTab('costs')}>
          <span className="k">Costi</span>
          <span className="v expense num">{formatEUR(cur.expense, { short: true })}</span>
          <span className="d">{deltaPct(cur.expense, prev.expense)}</span>
        </button>
        <button className="kpi" onClick={() => nav.setTab('invest')}>
          <span className="k">Investiti</span>
          <span className="v good num">{formatEUR(invested, { short: true })}</span>
          <span className="d">nel periodo</span>
        </button>
      </div>

      {toReview > 0 && (
        <button className="review" onClick={() => nav.push({ name: 'txList', filter: { review: true, title: 'Da confermare' } })}>
          <span className="badge">{toReview}</span>
          <span style={{ flex: 1 }}>Movimenti importati da confermare</span>
          <Icon name="chevron" size={16} color="var(--muted)" />
        </button>
      )}

      <div className="card">
        <div className="card-title">
          <span>Ricavi e costi, ultimi 6 mesi</span>
          <span style={{ display: 'flex', gap: 10 }} className="tiny muted">
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="sw" style={{ width: 8, height: 8, background: '#1d4ed8' }} />
              Ricavi
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="sw" style={{ width: 8, height: 8, background: '#f08a3c' }} />
              Costi
            </span>
          </span>
        </div>
        <Chart option={option} height={140} label="Grafico a barre di ricavi e costi degli ultimi 6 mesi" />
      </div>

      <div className="section-title">
        <h2>Ultimi movimenti</h2>
        {data.txs.length > 0 && (
          <button className="link" onClick={() => nav.push({ name: 'txList', filter: { title: 'Tutti i movimenti' } })}>
            Vedi tutti
          </button>
        )}
      </div>
      {recent.length === 0 ? (
        <div className="card">
          <Empty action={<button className="btn small" onClick={() => nav.openSheet({ name: 'tx' })}>Aggiungi il primo movimento</button>}>
            Nessun movimento ancora. Inizia registrando lo stipendio o una spesa di oggi.
          </Empty>
        </div>
      ) : (
        <TxGroupedList txs={recent} catMap={data.catMap} accs={data.accs} />
      )}
    </div>
  );
}
