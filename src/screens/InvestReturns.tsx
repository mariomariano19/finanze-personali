import { useMemo, useState } from 'react';
import type { Holding, InvestmentOp, PricePoint } from '../core/types';
import { defaultTaxClass } from '../core/types';
import { formatEUR, formatPct } from '../core/money';
import { daysBetween, today } from '../core/dates';
import { positions } from '../analytics/investments';
import { PERIOD_LABEL, annualize, investorFlows, latentTax, movers, periodReturn, periodStart, priceBook, pricesAsOf, seriesReturn, staleAfterDays, xirr, type PeriodKey } from '../analytics/returns';
import { getPriceState, resolveRejected, syncPrices } from '../intel/prices';
import { useData } from '../state/store';
import { useToast } from '../ui/common';

const KEYS: PeriodKey[] = ['1G', '1S', '1M', 'YTD', '1A', 'ALL'];
const SHORT: Record<PeriodKey, string> = { '1G': '1G', '1S': '1S', '1M': '1M', YTD: 'Anno', '1A': '1A', ALL: 'Inizio' };
const pctOrDash = (r: number | null | undefined, d = 1) => (r === null || r === undefined || !isFinite(r) ? '—' : formatPct(r, { sign: true, decimals: d }));
const tone = (n: number | null | undefined) => (n === null || n === undefined ? '' : n > 0 ? 'good' : n < 0 ? 'danger' : '');
const dmy = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

/** Tutti i numeri della sezione rendimenti, calcolati una volta */
export function useReturns(holdings: Holding[], ops: InvestmentOp[], prices: PricePoint[], period: PeriodKey) {
  return useMemo(() => {
    const t = today();
    const book = priceBook(holdings.filter((h) => !h.archived), ops, prices);
    const asOf = pricesAsOf(book, t);
    const start = periodStart(period, asOf, book);
    const r = periodReturn(book, start, asOf);
    const firstOp = ops.reduce<string | null>((m, o) => (!m || o.date < m ? o.date : m), null);
    const flows = investorFlows(book, asOf);
    const span = firstOp ? daysBetween(firstOp, asOf) : 0;
    const irrA = span >= 30 ? xirr(flows) : null;
    // sotto l'anno l'annualizzazione gonfia i numeri: mostro il rendimento del periodo
    const irr = irrA === null ? null : span >= 365 ? irrA : Math.pow(1 + irrA, span / 365) - 1;
    const allR = periodReturn(book, periodStart('ALL', asOf, book), asOf);
    const ps = positions(holdings, ops);
    const tax = latentTax(ps.map((p) => ({ taxClass: p.holding.taxClass ?? defaultTaxClass(p.holding.assetClass), pnl: p.pnl })));
    const st = getPriceState();
    const bench = st.benchmark?.points?.map((p) => ({ date: p.date, price: p.price })) ?? [];
    const benchR = bench.length ? seriesReturn(bench, start, asOf) : null;
    const mv = movers(book, start, asOf);
    const dividends = ops.filter((o) => (o.kind === 'dividend' || o.kind === 'coupon') && o.date > start && o.date <= asOf);
    const stale = ps
      .filter((p) => p.quantity > 0 || p.value > 0)
      .map((p) => ({ p, limit: staleAfterDays(p.holding), age: daysBetween(p.holding.priceDate, t) }))
      .filter((x) => x.limit !== null && x.age > x.limit!);
    return { asOf, start, r, irr, span, allR, allAnn: annualize(allR.twr, allR.start, asOf), tax, benchR, bench: st.benchmark, mv, dividends, stale, priceState: st };
  }, [holdings, ops, prices, period]);
}

export function ReturnsCard({ ops, period, setPeriod }: { ops: InvestmentOp[]; period: PeriodKey; setPeriod: (k: PeriodKey) => void }) {
  const data = useData();
  const x = useReturns(data.holdings, ops, data.prices, period);
  const value = x.r.endValue;
  return (
    <div className="card" style={{ gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="card-title">Rendimento</span>
        <span className="tiny muted">prezzi al {dmy(x.asOf)}</span>
      </div>
      <div className="chips" role="group" aria-label="Periodo" style={{ margin: 0 }}>
        {KEYS.map((k) => (
          <button key={k} className="chip" aria-pressed={period === k} onClick={() => setPeriod(k)}>{SHORT[k]}</button>
        ))}
      </div>
      <div className="kpis two">
        <div className="kpi">
          <span className="k">Guadagno · {PERIOD_LABEL[period].toLowerCase()}</span>
          <span className={`v num ${tone(x.r.gain)}`}>{formatEUR(x.r.gain, { sign: true, short: true })}</span>
          <span className="d">al netto di versamenti e prelievi</span>
        </div>
        <div className="kpi">
          <span className="k">Rendimento della gestione</span>
          <span className={`v num ${tone(x.r.twr)}`}>{pctOrDash(x.r.twr, 2)}</span>
          <span className="d">TWR{period === 'ALL' && x.allAnn !== null ? ` · ${pctOrDash(x.allAnn)} l’anno` : ''}</span>
        </div>
      </div>
      <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span className="muted">S&P 500 nello stesso periodo</span>
          <b className={`num ${tone(x.benchR)}`}>{x.benchR === null ? (x.bench ? 'storico non ancora sufficiente' : 'in arrivo') : pctOrDash(x.benchR, 2)}</b>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span className="muted">{x.span >= 365 ? 'Rendimento annuo dei tuoi soldi (XIRR)' : 'Rendimento dei tuoi soldi dall’inizio (XIRR, non annualizzato)'}</span>
          <b className={`num ${tone(x.irr)}`}>{x.irr === null ? (x.span < 30 ? 'servono 30 giorni di storia' : '—') : pctOrDash(x.irr)}</b>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span className="muted">Valore se vendessi oggi, tasse stimate</span>
          <b className="num">{formatEUR(value - x.tax.tax, { short: true })}</b>
        </div>
      </div>
      <span className="tiny muted" style={{ lineHeight: 1.5 }}>
        {x.r.partial && period !== 'ALL' ? 'Il portafoglio è più giovane del periodo scelto: il calcolo parte dal primo investimento. ' : ''}
        Il TWR misura le scelte di investimento senza l’effetto di quando hai versato; l’XIRR misura quanto rendono i tuoi soldi tenendo conto di date e importi.
        {' '}Tasse stimate {formatEUR(x.tax.tax, { short: true })}: 26% sulle plusvalenze (12,5% titoli di Stato){x.tax.losses > 0 ? `; minusvalenze per ${formatEUR(x.tax.losses, { short: true })} non compensate in questa stima` : ''}. Il confronto con l’S&P 500 usa l’ETF {x.bench?.symbol ?? 'SXR8'} in euro.
      </span>
    </div>
  );
}

export function ChangesCard({ ops, period }: { ops: InvestmentOp[]; period: PeriodKey }) {
  const data = useData();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const x = useReturns(data.holdings, ops, data.prices, period);
  const up = x.mv.filter((m) => m.changePct > 0).slice(0, 3);
  const down = x.mv.filter((m) => m.changePct < 0).reverse().slice(0, 3);
  const rejected = x.priceState.rejected ?? [];
  const name = (id: string) => data.holdings.find((h) => h.id === id)?.name ?? 'Strumento';
  const configured = Boolean(data.settings.intel?.key);
  const row = (m: (typeof x.mv)[number]) => (
    <div key={m.holding.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }} className="small">
      <span>{m.holding.name}</span>
      <span className="num"><b className={tone(m.changePct)}>{pctOrDash(m.changePct)}</b> <span className="muted">({formatEUR(m.impact, { sign: true, short: true })})</span></span>
    </div>
  );
  async function syncNow() {
    setBusy(true);
    const r = await syncPrices(data, true);
    setBusy(false);
    toast(r ? (r.added ? `${r.added} prezzi aggiornati` : 'Nessun prezzo nuovo') : getPriceState().error ?? 'Aggiornamento non riuscito');
  }
  return (
    <div className="card" style={{ gap: 10 }}>
      <span className="card-title">Cosa è cambiato · {PERIOD_LABEL[period].toLowerCase()}</span>
      {!up.length && !down.length && <span className="small muted">Nessuna variazione di prezzo nel periodo per gli strumenti posseduti.</span>}
      {!!up.length && (<><span className="label-caps">In salita</span>{up.map(row)}</>)}
      {!!down.length && (<><span className="label-caps">In discesa</span>{down.map(row)}</>)}
      {!!x.dividends.length && (
        <>
          <span className="label-caps">Proventi incassati</span>
          {x.dividends.map((o) => (
            <div key={o.id} className="small" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{name(o.holdingId)} · {dmy(o.date)}</span>
              <b className="num good">{formatEUR(o.amount - o.fees - (o.taxes ?? 0), { sign: true })}</b>
            </div>
          ))}
        </>
      )}
      {!!x.stale.length && (
        <div className="notice warn small">
          <span><b>Prezzi vecchi:</b> {x.stale.map((s) => `${s.p.holding.name} (${s.age} giorni)`).join(', ')}. I rendimenti di questi strumenti sono meno affidabili.</span>
        </div>
      )}
      {rejected.map((r) => (
        <div key={`${r.holdingId}${r.date}`} className="notice warn small" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span>
            <b>Prezzo da confermare per {r.name}:</b> {formatEUR(Math.round(r.price))} del {dmy(r.date)} contro {formatEUR(Math.round(r.previous))} di prima. Può essere uno strumento sbagliato o un’unità diversa.{' '}
            <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--income)' }}>{r.source} ↗</a>
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn small" onClick={() => { resolveRejected(r, true); toast('Prezzo accettato'); }}>Accetta</button>
            <button className="btn small secondary" onClick={() => { resolveRejected(r, false); toast('Prezzo scartato'); }}>Scarta</button>
          </span>
        </div>
      ))}
      <span className="tiny muted" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span>
          {!configured
            ? 'Prezzi automatici: collega l’Intelligence (tab Mercati) per riceverli ogni mattina.'
            : x.priceState.error
              ? `Prezzi automatici: ${x.priceState.error}`
              : x.priceState.syncedAt
                ? `Prezzi automatici dal Morning Briefing · controllati ${new Date(x.priceState.syncedAt).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                : 'Prezzi automatici: in attesa del primo aggiornamento.'}
        </span>
        {configured && <button className="link" disabled={busy} onClick={syncNow}>{busy ? 'Aggiorno…' : 'Aggiorna'}</button>}
      </span>
    </div>
  );
}
