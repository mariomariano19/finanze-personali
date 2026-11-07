import { useMemo, useState } from 'react';
import { useData } from '../state/store';
import { useNav } from '../ui/nav';
import { Header, IconButton, Empty } from '../ui/common';
import { Icon } from '../ui/Icon';
import { Chart, AXIS, TOOLTIP, INVEST_SCALE } from '../ui/Chart';
import { allocation, portfolioHistory, portfolioTotals, positions, positionAt, type Position } from '../analytics/investments';
import { formatEUR, formatPct } from '../core/money';
import { dayLabel, lastMonths, monthShort, today } from '../core/dates';
import { ASSET_CLASS_LABEL, NON_LISTED, OP_KIND_LABEL, TAX_CLASS_LABEL, defaultTaxClass, type AssetClass } from '../core/types';

const ABBR: Record<AssetClass, string> = { etf: 'ETF', stock: 'AZ', bond: 'OB', fund: 'FC', crypto: 'CR', cash: 'CD', real_estate: 'IM', pension: 'FP', other: '…' };
const qtyFmt = (q: number) => q.toLocaleString('it-IT', { maximumFractionDigits: 6 });

function PositionRow({ p, onClick }: { p: Position; onClick: () => void }) {
  const nonListed = NON_LISTED.includes(p.holding.assetClass);
  return (
    <button className="row" onClick={onClick}>
      <span className="ic inv">{ABBR[p.holding.assetClass]}</span>
      <span className="main">
        <span className="title">{p.holding.name}</span>
        <span className="sub">
          {nonListed ? ASSET_CLASS_LABEL[p.holding.assetClass] : p.quantity > 0 ? `${qtyFmt(p.quantity)} quote` : 'Nessuna quota'}
          {' · aggiornato '}
          {dayLabel(p.holding.priceDate).toLowerCase()}
        </span>
      </span>
      <span className="amt num">
        {formatEUR(p.value, { short: true })}
        {p.pnlPct !== null && <small className={p.pnl >= 0 ? 'good' : 'danger'}>{formatPct(p.pnlPct, { sign: true, decimals: 1 })}</small>}
      </span>
    </button>
  );
}

export function Investments() {
  const data = useData();
  const nav = useNav();
  const brokers = data.brokers.filter((b) => !b.hidden);
  const [brokerId, setBrokerId] = useState<string | null>(null);
  const ops = useMemo(() => (brokerId ? data.ops.filter((o) => o.brokerId === brokerId) : data.ops), [data.ops, brokerId]);
  const ps = useMemo(() => positions(data.holdings, data.ops, brokerId), [data.holdings, data.ops, brokerId]);
  const tot = portfolioTotals(ps);
  const alloc = allocation(ps);
  const months = lastMonths(12, today());
  const hist = useMemo(() => portfolioHistory(data.holdings, ops, data.prices, months), [data.holdings, ops, data.prices]); // eslint-disable-line react-hooks/exhaustive-deps
  const option = useMemo(
    () => ({
      animationDuration: 300,
      grid: { left: 4, right: 8, top: 10, bottom: 22 },
      tooltip: { ...TOOLTIP, valueFormatter: (v: number) => formatEUR(v * 100, { short: true }) },
      xAxis: { type: 'category', data: months.map(monthShort), boundaryGap: false, axisLine: { lineStyle: { color: '#e3e3df' } }, axisTick: { show: false }, axisLabel: { ...AXIS, interval: 2 } },
      yAxis: { type: 'value', show: false, scale: true },
      series: [
        { name: 'Capitale investito', type: 'line', data: hist.map((h) => h.invested / 100), symbol: 'none', lineStyle: { color: '#9aa0a6', width: 1.5, type: 'dashed' } },
        { name: 'Valore', type: 'line', data: hist.map((h) => h.value / 100), symbol: 'circle', symbolSize: 5, lineStyle: { color: '#0b7a5c', width: 2.2 }, itemStyle: { color: '#0b7a5c' } }
      ]
    }),
    [hist] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const listed = ps.filter((p) => !NON_LISTED.includes(p.holding.assetClass));
  const nonListed = ps.filter((p) => NON_LISTED.includes(p.holding.assetClass));
  const extraCosts = tot.costs + tot.taxes;

  return (
    <div className="screen">
      <Header
        eyebrow="Portafoglio"
        title="Investimenti"
        actions={
          <>
            <IconButton icon="bank" label="Intermediari" onClick={() => nav.push({ name: 'brokers' })} />
            <IconButton icon="plus" label="Nuovo strumento o bene" onClick={() => nav.openSheet({ name: 'holding' })} />
          </>
        }
      />

      {brokers.length > 1 && (
        <div className="chips" role="group" aria-label="Intermediario">
          <button className="chip" aria-pressed={brokerId === null} onClick={() => setBrokerId(null)}>
            Tutti
          </button>
          {brokers.map((b) => (
            <button key={b.id} className="chip" aria-pressed={brokerId === b.id} onClick={() => setBrokerId(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
      )}

      {ps.length === 0 ? (
        <div className="card">
          <Empty action={<button className="btn small" onClick={() => nav.openSheet({ name: 'holding' })}>Aggiungi uno strumento o un bene</button>}>
            {brokerId ? 'Nessuna operazione presso questo intermediario.' : 'Registra ETF, azioni, obbligazioni, fondi, conti deposito, immobili o il fondo pensione. Poi aggiungi le operazioni.'}
          </Empty>
        </div>
      ) : (
        <>
          <div className="card" style={{ gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="small muted">Valore attuale</span>
              <span className="num" style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.8 }}>
                {formatEUR(tot.value, { short: true })}
              </span>
            </div>
            <div className="kpis two">
              <div style={{ background: 'var(--bg)', borderRadius: 12, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12 }} className="muted">Capitale investito</span>
                <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>{formatEUR(tot.invested, { short: true })}</span>
              </div>
              <div style={{ background: tot.pnl >= 0 ? 'var(--good-soft)' : '#fdecea', borderRadius: 12, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12, color: tot.pnl >= 0 ? '#2f5e50' : 'var(--danger)' }}>{tot.pnl >= 0 ? 'Guadagno non realizzato' : 'Perdita non realizzata'}</span>
                <span className={`num ${tot.pnl >= 0 ? 'good' : 'danger'}`} style={{ fontSize: 15, fontWeight: 700 }}>
                  {formatEUR(tot.pnl, { sign: true, short: true })} · {tot.pnlPct === null ? '–' : formatPct(tot.pnlPct, { sign: true, decimals: 1 })}
                </span>
              </div>
            </div>
            {(tot.income !== 0 || tot.realized !== 0 || extraCosts !== 0) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} className="small">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Vendite realizzate</span><b className="num">{formatEUR(tot.realized, { sign: true })}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Dividendi e cedole (lordi)</span><b className="num">{formatEUR(tot.income, { sign: true })}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Costi e tasse trattenute</span><b className="num">{formatEUR(-extraCosts, { sign: true })}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}>
                  <span>Risultato complessivo</span>
                  <b className={`num ${tot.totalReturn >= 0 ? 'good' : 'danger'}`}>{formatEUR(tot.totalReturn, { sign: true })}</b>
                </div>
              </div>
            )}
            <Chart option={option} height={110} label="Valore e capitale investito negli ultimi 12 mesi" />
            <div style={{ display: 'flex', gap: 14 }} className="tiny muted">
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 2, background: '#0b7a5c' }} />Valore</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, borderTop: '2px dashed #9aa0a6' }} />Capitale investito</span>
              <span style={{ marginLeft: 'auto' }}>ultimi 12 mesi</span>
            </div>
          </div>

          <div className="card" style={{ gap: 12 }}>
            <span className="card-title">Distribuzione</span>
            <div className="split-bar" style={{ height: 12, borderRadius: 6 }} aria-hidden="true">
              {alloc.map((a, i) => <span key={a.cls} style={{ width: `${a.share * 100}%`, background: INVEST_SCALE[Math.min(i, INVEST_SCALE.length - 1)] }} />)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 12px' }} className="small">
              {alloc.map((a, i) => (
                <div key={a.cls} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="sw" style={{ background: INVEST_SCALE[Math.min(i, INVEST_SCALE.length - 1)], border: i >= 4 ? '1px solid #9fd3bf' : undefined }} />
                  <span style={{ flex: 1 }}>{ASSET_CLASS_LABEL[a.cls]}</span>
                  <b className="num">{formatPct(a.share)}</b>
                </div>
              ))}
            </div>
          </div>

          {listed.length > 0 && (
            <>
              <div className="section-title"><h2>Titoli quotati</h2><span className="tiny muted">Prezzi automatici in arrivo</span></div>
              <div className="card tight">{listed.map((p) => <PositionRow key={p.holding.id} p={p} onClick={() => nav.push({ name: 'holding', id: p.holding.id })} />)}</div>
            </>
          )}
          {nonListed.length > 0 && (
            <>
              <div className="section-title"><h2>Beni non quotati</h2><span className="tiny muted">Valori aggiornati a mano</span></div>
              <div className="card tight">{nonListed.map((p) => <PositionRow key={p.holding.id} p={p} onClick={() => nav.push({ name: 'holding', id: p.holding.id })} />)}</div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------- Dettaglio strumento ----------------
export function HoldingDetail({ id }: { id: string }) {
  const data = useData();
  const nav = useNav();
  const h = data.holdings.find((x) => x.id === id);
  if (!h) return <div className="screen no-tab"><Header title="Strumento" onBack={nav.pop} /><Empty>Strumento non trovato.</Empty></div>;
  const ops = data.ops.filter((o) => o.holdingId === id);
  const [pos] = positions([h], ops);
  const nonListed = NON_LISTED.includes(h.assetClass);
  const brokerName = (bid?: string | null) => data.brokers.find((b) => b.id === bid)?.name ?? 'Senza intermediario';
  const perBroker = [...new Set(ops.map((o) => o.brokerId ?? null))].map((bid) => ({ bid, st: positionAt(ops.filter((o) => (o.brokerId ?? null) === bid)) })).filter((x) => x.st.quantity > 0);
  const links: { label: string; href: string }[] = [];
  if (h.isin || h.symbol) links.push({ label: 'Yahoo Finanza', href: `https://finance.yahoo.com/lookup/?s=${encodeURIComponent(h.isin || h.symbol!.split('.')[0])}` });
  if (h.isin && (h.assetClass === 'etf' || h.assetClass === 'fund')) links.push({ label: 'justETF', href: `https://www.justetf.com/it/etf-profile.html?isin=${encodeURIComponent(h.isin)}` });
  if (h.isin) links.push({ label: 'Cerca ISIN', href: `https://www.google.com/search?q=${encodeURIComponent(h.isin)}` });
  const d = h.details ?? {};

  return (
    <div className="screen no-tab">
      <Header
        onBack={nav.pop}
        eyebrow={[ASSET_CLASS_LABEL[h.assetClass], h.isin, h.symbol].filter(Boolean).join(' · ')}
        title={h.name}
        actions={<IconButton icon="edit" label="Modifica" onClick={() => nav.openSheet({ name: 'holding', id })} />}
      />
      <div className="kpis two">
        <div className="kpi">
          <span className="k">{nonListed ? 'Valore stimato' : 'Valore'}</span>
          <span className="v num">{formatEUR(pos.value)}</span>
          <span className="d num">{nonListed ? `aggiornato ${dayLabel(h.priceDate).toLowerCase()}` : `${qtyFmt(pos.quantity)} quote × ${formatEUR(Math.round(h.price))}`}</span>
        </div>
        <div className="kpi">
          <span className="k">Non realizzato</span>
          <span className={`v num ${pos.pnl >= 0 ? 'good' : 'danger'}`}>{formatEUR(pos.pnl, { sign: true })}</span>
          <span className="d num">investiti {formatEUR(pos.costBasis)}</span>
        </div>
      </div>
      <div className="card small" style={{ gap: 6 }}>
        {!nonListed && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Vendite realizzate</span><b className="num">{formatEUR(pos.realized, { sign: true })}</b></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">{h.assetClass === 'bond' ? 'Cedole' : h.assetClass === 'cash' ? 'Interessi' : 'Dividendi e proventi'} lordi</span><b className="num">{formatEUR(pos.income, { sign: true })}</b></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Costi e tasse trattenute</span><b className="num">{formatEUR(-(pos.costs + pos.taxes), { sign: true })}</b></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}><span>Risultato complessivo</span><b className={`num ${pos.totalReturn >= 0 ? 'good' : 'danger'}`}>{formatEUR(pos.totalReturn, { sign: true })}</b></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Classe fiscale</span><span>{TAX_CLASS_LABEL[h.taxClass ?? defaultTaxClass(h.assetClass)]}</span></div>
        {h.distribution && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Proventi</span><span>{h.distribution === 'acc' ? 'Ad accumulo' : 'A distribuzione'}</span></div>}
        {d.rate !== undefined && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Tasso lordo</span><span>{String(d.rate).replace('.', ',')}% annuo{d.locked ? ' · vincolato' : ''}</span></div>}
        {d.maturity && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Scadenza</span><span>{dayLabel(d.maturity)}</span></div>}
        {d.debt ? <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Debito residuo collegato</span><span className="num">{formatEUR(d.debt)} · netto {formatEUR(pos.value - d.debt)}</span></div> : null}
        {d.fundLine && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Comparto</span><span>{d.fundLine}</span></div>}
      </div>
      {perBroker.length > 1 && (
        <div className="card small" style={{ gap: 6 }}>
          <span className="card-title">Per intermediario</span>
          {perBroker.map((x) => (
            <div key={x.bid ?? 'none'} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{brokerName(x.bid)}</span>
              <b className="num">{qtyFmt(x.st.quantity)} quote · {formatEUR(Math.round(x.st.quantity * h.price))}</b>
            </div>
          ))}
        </div>
      )}
      <div className="btn-row">
        <button className="btn secondary" onClick={() => nav.openSheet({ name: 'price', holdingId: id })}>{nonListed ? 'Aggiorna valore' : 'Aggiorna prezzo'}</button>
        <button className="btn" onClick={() => nav.openSheet({ name: 'op', holdingId: id })}>{nonListed ? 'Nuovo movimento' : 'Nuova operazione'}</button>
      </div>
      {links.length > 0 && (
        <div className="chip-wrap">
          {links.map((l) => (
            <a key={l.label} className="chip" href={l.href} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: 'var(--ink)' }}>
              {l.label} ↗
            </a>
          ))}
        </div>
      )}
      <div className="section-title"><h2>Storico operazioni</h2></div>
      {ops.length === 0 ? (
        <div className="card"><Empty>Nessuna operazione registrata.</Empty></div>
      ) : (
        <div className="card tight">
          {ops.map((o) => {
            const inflow = o.kind === 'sell' || o.kind === 'dividend' || o.kind === 'coupon';
            const value = o.kind === 'split' ? 0 : inflow ? o.amount - o.fees - (o.taxes ?? 0) : -(o.amount + o.fees + (o.taxes ?? 0));
            return (
              <button key={o.id} className="row" onClick={() => nav.openSheet({ name: 'op', holdingId: id, id: o.id })}>
                <span className="main">
                  <span className="title">{nonListed && o.kind === 'buy' ? 'Versamento' : nonListed && o.kind === 'sell' ? 'Prelievo' : nonListed && o.kind === 'dividend' ? 'Interessi o rendita' : OP_KIND_LABEL[o.kind]}</span>
                  <span className="sub">
                    {dayLabel(o.date)}
                    {(o.kind === 'buy' || o.kind === 'sell' || o.kind === 'split') && !nonListed ? ` · ${qtyFmt(o.quantity)} quote` : ''}
                    {data.brokers.length > 1 ? ` · ${brokerName(o.brokerId)}` : ''}
                    {o.taxes ? ` · tasse ${formatEUR(o.taxes)}` : ''}
                    {o.source === 'import' && <span className="tag">Import</span>}
                  </span>
                </span>
                <span className={`amt num ${inflow ? 'good' : ''}`}>{o.kind === 'split' ? '—' : formatEUR(value, { sign: true })}</span>
              </button>
            );
          })}
        </div>
      )}
      {h.notes && <div className="card small">{h.notes}</div>}
    </div>
  );
}

// ---------------- Intermediari ----------------
export function Brokers() {
  const data = useData();
  const nav = useNav();
  const KIND = { broker: 'Broker', bank: 'Banca', pension: 'Fondo pensione', exchange: 'Exchange', other: 'Altro' } as const;
  return (
    <div className="screen no-tab">
      <Header onBack={nav.pop} title="Intermediari" actions={<IconButton icon="plus" label="Nuovo intermediario" onClick={() => nav.openSheet({ name: 'broker' })} />} />
      <span className="small muted">Broker, banche e fondi presso cui hai investimenti. Il regime fiscale decide chi calcola e paga le tasse.</span>
      {data.brokers.length === 0 ? (
        <div className="card"><Empty action={<button className="btn small" onClick={() => nav.openSheet({ name: 'broker' })}>Aggiungi intermediario</button>}>Nessun intermediario.</Empty></div>
      ) : (
        <div className="card tight">
          {data.brokers.map((b) => {
            const n = new Set(data.ops.filter((o) => o.brokerId === b.id).map((o) => o.holdingId)).size;
            return (
              <button key={b.id} className="row" style={{ opacity: b.hidden ? 0.55 : 1 }} onClick={() => nav.openSheet({ name: 'broker', id: b.id })}>
                <span className="ic neutral"><Icon name="bank" size={18} color="var(--ink)" /></span>
                <span className="main">
                  <span className="title">{b.name}</span>
                  <span className="sub">{KIND[b.kind]} · {b.country} · {b.taxRegime === 'administered' ? 'regime amministrato' : 'regime dichiarativo'} · {n} strumenti</span>
                </span>
                <Icon name="chevron" size={16} color="var(--muted)" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
