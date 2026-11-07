import { useEffect } from 'react';
import { Header, Empty } from '../ui/common';
import { useNav } from '../ui/nav';
import { useIntel } from '../intel/useIntel';
import { CLS_LABEL, safeUrl, type DossierSection } from '../intel/model';
import { Ext, Src, num, pct, shortDate, tone, when } from '../intel/ui';

const ORDER = ['profilo', 'conti', 'solidita', 'valutazione', 'dividendo', 'eventi', 'forza_rischi'];

/** Scheda di un'azienda della watchlist, scritta dal motore serale */
export function Dossier({ itemId }: { itemId: string }) {
  const intel = useIntel();
  const nav = useNav();
  const w = intel.cache.watchlist.find((x) => x.id === itemId);
  const d = intel.cache.dossiers?.[itemId];
  const inIndex = intel.cache.dossierIndex?.items[itemId];
  useEffect(() => {
    intel.loadDossier(itemId);
  }, [itemId, inIndex?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = d?.name ?? w?.name ?? 'Scheda';
  const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const preds = intel.cache.predictions
    .filter((p) => (w?.ticker && norm(p.ticker) === norm(w.ticker)) || norm(p.instrument) === norm(w?.name))
    .sort((a, b) => b.seq - a.seq);
  const outById = new Map(intel.cache.outcomes.map((o) => [o.predictionId, o]));
  const sections = [...(d?.sections ?? [])].sort((a, b) => (ORDER.indexOf(a.key) + 99) % 99 - (ORDER.indexOf(b.key) + 99) % 99);

  return (
    <div className="screen no-tab">
      <Header eyebrow="Scheda azienda" title={name} onBack={nav.pop} />
      {!d ? (
        <div className="card">
          <Empty>
            {inIndex ? 'Caricamento della scheda…' : 'Scheda in preparazione. Il motore serale (ore 23:00, lunedì–venerdì) ne completa circa sette a sera: entro una settimana ci sono tutte le aziende della watchlist.'}
          </Empty>
        </div>
      ) : (
        <>
          <div className="card" style={{ gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <span className="small muted">{[d.ticker, w?.category, w?.region].filter(Boolean).join(' · ')}</span>
              {d.price?.value !== undefined && (
                <span className="num" style={{ fontWeight: 700 }}>
                  {num(d.price.value)} {d.price.currency} <small className={tone(d.price.changePct)}>{pct(d.price.changePct)}</small>
                </span>
              )}
            </div>
            {d.price && <Src source={d.price.source} url={d.price.url} asOf={d.price.asOf} status={d.price.status} />}
            {d.summary && <span className="small">{d.summary}</span>}
            <span className="tiny muted">
              Aggiornata {when(d.updatedAt)}
              {d.fullReviewAt ? ` · revisione completa del ${shortDate(d.fullReviewAt)}` : ''}
            </span>
          </div>
          {sections.map((s) => (
            <Section key={s.key} s={s} />
          ))}
          {!!d.news?.length && (
            <div className="card" style={{ gap: 8 }}>
              <span className="card-title">Ultime notizie</span>
              {d.news.map((n, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: i ? 8 : 0, borderTop: i ? '1px solid var(--line-soft)' : 0 }}>
                  <Ext href={n.url} className="small"><b>{n.title}</b>{safeUrl(n.url) ? ' ↗' : ''}</Ext>
                  <span className="tiny muted">{[n.source, shortDate(n.date)].filter(Boolean).join(' · ')}</span>
                  {n.summary && <span className="small">{n.summary}</span>}
                </div>
              ))}
            </div>
          )}
          {!!d.missing?.length && (
            <div className="notice warn">
              <span><b>Dati non disponibili da fonti affidabili:</b> {d.missing.join('; ')}.</span>
            </div>
          )}
        </>
      )}
      {!!preds.length && (
        <div className="card small" style={{ gap: 6 }}>
          <span className="card-title">Le nostre previsioni</span>
          {preds.map((p) => {
            const o = outById.get(p.id);
            return (
              <span key={p.id}>
                n. {p.seq} · {shortDate(p.briefingDate ?? p.createdAt)} · {p.horizonLabel} · {Math.round(p.probs.up * 100)}/{Math.round(p.probs.neutral * 100)}/{Math.round(p.probs.down * 100)}
                {' · '}
                {!o ? 'aperta' : o.result === 'inconclusive' ? 'non verificabile' : `${o.result === 'correct' ? 'corretta' : 'errata'} (${o.realized ? CLS_LABEL[o.realized] : ''} ${pct(o.totalReturnPct)})`}
              </span>
            );
          })}
        </div>
      )}
      <p className="tiny muted" style={{ margin: '4px 4px 0', lineHeight: 1.5 }}>
        Scheda informativa per uso personale, non consulenza finanziaria. Ogni dato riporta fonte e data; i dati che non si trovano da fonti affidabili sono indicati come mancanti, mai stimati.
      </p>
    </div>
  );
}

function Section({ s }: { s: DossierSection }) {
  return (
    <div className="card" style={{ gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <span className="card-title">{s.title}</span>
        {s.asOf && <span className="tiny muted">{shortDate(s.asOf)}</span>}
      </div>
      {s.text && <span className="small" style={{ whiteSpace: 'pre-line' }}>{s.text}</span>}
      {!!s.facts?.length && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {s.facts.map((f, i) => (
            <div key={i} className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderTop: i ? '1px solid var(--line-soft)' : 0, paddingTop: i ? 4 : 0 }}>
              <span>
                {f.label}
                {f.note && <span className="tiny muted" style={{ display: 'block' }}>{f.note}</span>}
              </span>
              <b className="num" style={{ textAlign: 'right' }}>{f.value}</b>
            </div>
          ))}
        </div>
      )}
      {s.table && s.table.columns.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="small num" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontWeight: 600, padding: '4px 6px 4px 0' }}>{s.table.unit ?? ''}</th>
                {s.table.columns.map((c) => (
                  <th key={c} style={{ textAlign: 'right', fontWeight: 600, padding: '4px 0 4px 8px', whiteSpace: 'nowrap' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.table.rows.map((r) => (
                <tr key={r.label} style={{ borderTop: '1px solid var(--line-soft)' }}>
                  <td style={{ padding: '4px 6px 4px 0' }}>{r.label}</td>
                  {r.values.map((v, i) => (
                    <td key={i} style={{ textAlign: 'right', padding: '4px 0 4px 8px', whiteSpace: 'nowrap' }}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!s.bullets?.length && (
        <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {s.bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      )}
      {s.missing && <span className="tiny muted">Non disponibile: {s.missing}</span>}
      {!!s.sources?.length && (
        <span className="tiny muted">
          Fonti:{' '}
          {s.sources.map((x, i) => (
            <span key={i}>
              {i ? ', ' : ''}
              <Ext href={x.url}>{x.name}</Ext>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
