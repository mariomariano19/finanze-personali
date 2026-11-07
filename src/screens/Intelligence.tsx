import { useEffect, useMemo, useState } from 'react';
import { useNav } from '../ui/nav';
import { Header, IconButton, Segmented, Empty, useToast } from '../ui/common';
import { Icon } from '../ui/Icon';
import { useIntel } from '../intel/useIntel';
import { BASELINE_BRIER, WATCH_CATEGORIES, safeUrl, trackerMetrics, type Briefing, type InvestorProfile, type Opportunity, type WatchItem } from '../intel/model';
import { newId } from '../core/id';

type Section = 'oggi' | 'previsioni' | 'watchlist' | 'profilo';

const num = (n?: number, d = 2) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const pct = (n?: number) => (typeof n === 'number' && isFinite(n) ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '—');
const ratio = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);
const tone = (n?: number) => (typeof n === 'number' ? (n > 0 ? 'good' : n < 0 ? 'danger' : '') : '');
const when = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const dayName = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

function Ext({ href, children, className }: { href?: string; children: React.ReactNode; className?: string }) {
  const u = safeUrl(href);
  return u ? (
    <a href={u} target="_blank" rel="noopener noreferrer" className={className} style={{ color: 'var(--income)' }}>
      {children}
    </a>
  ) : (
    <span className={className}>{children}</span>
  );
}

function Src({ source, url, asOf, status }: { source?: string; url?: string; asOf?: string; status?: string }) {
  if (!source && !asOf && !status) return null;
  return (
    <span className="tiny muted" style={{ display: 'block' }}>
      {source && <Ext href={url}>{source}</Ext>}
      {asOf && ` · ${when(asOf)}`}
      {status && ` · ${status}`}
    </span>
  );
}

export function Intelligence() {
  const nav = useNav();
  const intel = useIntel();
  const [section, setSection] = useState<Section>('oggi');

  if (!intel.configured) {
    return (
      <div className="screen">
        <Header eyebrow="Mercati e previsioni" title="Intelligence" />
        <div className="card">
          <Empty action={<button className="btn small" onClick={() => nav.push({ name: 'intelSetup' })}>Collega l’Intelligence</button>}>
            Qui trovi ogni mattina il Morning Briefing, il registro delle previsioni, la watchlist e il profilo d’investitore. Per vederli serve la chiave Intelligence.
          </Empty>
        </div>
      </div>
    );
  }

  const latest = intel.cache.index?.latest;
  return (
    <div className="screen">
      <Header
        eyebrow={latest ? `Ultimo briefing: ${dayName(latest)}` : 'Mercati e previsioni'}
        title="Intelligence"
        actions={
          <>
            <IconButton icon="repeat" label="Aggiorna" onClick={intel.refresh} />
            <IconButton icon="gear" label="Collegamento Intelligence" onClick={() => nav.push({ name: 'intelSetup' })} />
          </>
        }
      />
      <Segmented<Section>
        label="Sezione"
        value={section}
        onChange={setSection}
        options={[
          { value: 'oggi', label: 'Oggi' },
          { value: 'previsioni', label: 'Previsioni' },
          { value: 'watchlist', label: 'Watchlist' },
          { value: 'profilo', label: 'Profilo' }
        ]}
      />
      {intel.loading && <span className="small muted">Aggiornamento in corso…</span>}
      {intel.error && (
        <div className="notice err" role="alert">
          <Icon name="info" size={18} /> {intel.error}
          {intel.cache.fetchedAt && <> Mostro i dati salvati il {when(intel.cache.fetchedAt)}.</>}
        </div>
      )}
      {section === 'oggi' && <Today intel={intel} />}
      {section === 'previsioni' && <Tracker intel={intel} />}
      {section === 'watchlist' && <Watchlist intel={intel} />}
      {section === 'profilo' && <Profile intel={intel} />}
      <p className="tiny muted" style={{ margin: '4px 4px 0', lineHeight: 1.5 }}>
        Analisi per uso personale, non consulenza finanziaria. Le previsioni sono stime probabilistiche, mai certezze. Ogni dato riporta fonte e orario.
      </p>
    </div>
  );
}

type IntelState = ReturnType<typeof useIntel>;

// ---------------- Oggi: Morning Briefing ----------------
function Today({ intel }: { intel: IntelState }) {
  const dates = intel.cache.index?.briefings.map((b) => b.date) ?? [];
  const [date, setDate] = useState<string | null>(dates[0] ?? null);
  useEffect(() => {
    if (!date && dates[0]) setDate(dates[0]);
  }, [dates[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (date) intel.loadBriefing(date);
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = date ? (intel.cache.briefings[date] as Briefing | undefined) : undefined;

  if (!dates.length) {
    return (
      <div className="card">
        <Empty>Il primo Morning Briefing arriverà alle 7:30 del prossimo giorno di borsa, con una notifica sul telefono.</Empty>
      </div>
    );
  }
  return (
    <>
      {dates.length > 1 && (
        <div className="chips" role="group" aria-label="Data del briefing">
          {dates.slice(0, 30).map((d) => (
            <button key={d} className="chip" aria-pressed={d === date} onClick={() => setDate(d)}>
              {new Date(`${d}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}
            </button>
          ))}
        </div>
      )}
      {!b ? (
        <div className="card"><Empty>Caricamento del briefing…</Empty></div>
      ) : (
        <BriefingView b={b} />
      )}
    </>
  );
}

function Scenarios({ s }: { s?: Opportunity['scenarios'] }) {
  if (!s) return null;
  const cell = (label: string, sc: { p: number; text?: string } | undefined, cls: string) => (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <b className={`num ${cls}`} style={{ fontSize: 15 }}>{sc ? `${Math.round(sc.p * 100)}%` : '—'}</b>
      <span className="tiny" style={{ fontWeight: 600 }}>{label}</span>
      {sc?.text && <span className="tiny muted">{sc.text}</span>}
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
      {cell('Rialzo', s.up, 'good')}
      {cell('Neutrale', s.neutral, '')}
      {cell('Ribasso', s.down, 'danger')}
    </div>
  );
}

function BriefingView({ b }: { b: Briefing }) {
  const d = b.day ?? {};
  const list = (title: string, arr?: (string | { time?: string; event: string })[]) =>
    arr && arr.length ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="label-caps">{title}</span>
        {arr.map((x, i) => (
          <span key={i} className="small">
            {typeof x === 'string' ? x : `${x.time ? x.time + ' · ' : ''}${x.event}`}
          </span>
        ))}
      </div>
    ) : null;
  return (
    <>
      {b.dataNote && (
        <div className="notice warn">
          <Icon name="info" size={18} />
          <span>{b.dataNote}</span>
        </div>
      )}
      {!!b.markets?.length && (
        <div className="card tight">
          <div className="card-title" style={{ padding: '12px 0 4px' }}>Mercati</div>
          {b.markets.map((m, i) => (
            <div key={i} className="row" style={{ minHeight: 50, cursor: 'default' }}>
              <span className="main">
                <span className="title" style={{ fontWeight: 500 }}>{m.name}</span>
                <Src {...m} />
              </span>
              <span className="amt num">
                {num(m.value, m.decimals ?? 2)}
                {m.unit ? ` ${m.unit}` : ''}
                <small className={tone(m.changePct)}>{pct(m.changePct)}</small>
              </span>
            </div>
          ))}
        </div>
      )}
      {!!b.opportunities?.length && (
        <>
          <div className="section-title"><h2>Opportunità da approfondire</h2></div>
          {b.opportunities.map((o, i) => (
            <div key={i} className="card" style={{ gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{i + 1}. {o.name}</span>
                <span className="tag">{o.category}</span>
              </div>
              <span className="small">
                <b className="num">{num(o.price)}</b> {o.currency} {o.ticker && <span className="tag">{o.ticker}</span>}
                <Src source={o.priceSource} url={o.priceUrl} asOf={o.priceAsOf} status={o.priceStatus} />
              </span>
              {o.reason && <span className="small"><b>Perché:</b> {o.reason}</span>}
              {o.potential && <span className="small"><b>Potenziale:</b> {o.potential}</span>}
              {o.risks && <span className="small"><b>Rischi:</b> {o.risks}</span>}
              {o.horizon && <span className="small"><b>Orizzonte:</b> {o.horizon}{o.predictionSeq ? ` · previsione n. ${o.predictionSeq}` : ''}</span>}
              <Scenarios s={o.scenarios} />
              {o.news?.filter((n) => safeUrl(n.url)).map((n, j) => (
                <Ext key={j} href={n.url} className="small">{n.title} ↗</Ext>
              ))}
            </div>
          ))}
        </>
      )}
      {!!b.news?.length && (
        <div className="card">
          <span className="card-title">Le notizie che contano</span>
          {b.news.map((n, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: i ? 10 : 0, borderTop: i ? '1px solid var(--line-soft)' : 0 }}>
              <Ext href={n.url} className="small"><b>{n.title}</b>{safeUrl(n.url) ? ' ↗' : ''}</Ext>
              <span className="tiny muted">
                {n.source} · {when(n.publishedAt)} · {n.confirmed === false ? 'indiscrezione' : 'confermata'} · rilevanza {n.relevance ?? 'n.d.'}
              </span>
              {n.summary && <span className="small">{n.summary}</span>}
              {n.impact && <span className="small muted">Possibili effetti: {n.impact}{n.affected ? ` · Interessati: ${n.affected}` : ''}{n.horizon ? ` · ${n.horizon}` : ''}</span>}
            </div>
          ))}
        </div>
      )}
      {(d.favored || d.penalized || d.watch || d.calendar || d.volatility) && (
        <div className="card" style={{ gap: 12 }}>
          <span className="card-title">La giornata</span>
          {list('Settori favoriti', d.favored)}
          {list('Settori penalizzati', d.penalized)}
          {list('Da monitorare', d.watch)}
          {list('Calendario', d.calendar)}
          {list('Fattori di volatilità', d.volatility)}
        </div>
      )}
      {!!b.alerts?.length && (
        <div className="junk">
          <span className="eyebrow">ALERT</span>
          {b.alerts.map((a, i) => (
            <span key={i} className="small">
              <b>{a.title}</b> {a.text} {safeUrl(a.url) && <Ext href={a.url}>fonte ↗</Ext>}
            </span>
          ))}
        </div>
      )}
      <span className="tiny muted">Preparato {when(b.createdAt)}.</span>
    </>
  );
}

// ---------------- Previsioni ----------------
function Tracker({ intel }: { intel: IntelState }) {
  const preds = intel.cache.predictions;
  const m = useMemo(() => trackerMetrics(preds, intel.cache.outcomes), [preds, intel.cache.outcomes]);
  const outcomeById = new Map(intel.cache.outcomes.map((o) => [o.predictionId, o]));
  const integrity = intel.chain.ok ? (
    <div className="notice info"><Icon name="shield" size={18} /><span>Registro integro: {intel.chain.checked} previsioni verificate. Nessuna è stata modificata o cancellata.</span></div>
  ) : (
    <div className="notice err" role="alert"><Icon name="info" size={18} /><span>Registro alterato alla previsione n. {intel.chain.brokenAt}: una voce è stata modificata o cancellata dopo la pubblicazione.</span></div>
  );
  if (!preds.length) return <>{integrity}<div className="card"><Empty>Nessuna previsione ancora. Ogni briefing ne aggiunge cinque, verificate alla scadenza.</Empty></div></>;
  const table = (title: string, g: Record<string, { n: number; hit: number; brier: number }>) =>
    Object.keys(g).length ? (
      <div className="card small" style={{ gap: 6 }}>
        <span className="card-title">{title}</span>
        {Object.entries(g).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>{k}</span>
            <span className="num">{v.n} · {ratio(v.hit / v.n)} · Brier {num(v.brier / v.n, 3)}</span>
          </div>
        ))}
      </div>
    ) : null;
  return (
    <>
      {integrity}
      <div className="kpis two">
        <div className="kpi"><span className="k">Previsioni</span><span className="v num">{m.total}</span><span className="d">{m.n} verificate · {m.open} aperte · {m.inconclusive} non concl.</span></div>
        <div className="kpi"><span className="k">Direzione corretta</span><span className="v num">{ratio(m.dir)}</span><span className="d">sulle previsioni verificate</span></div>
        <div className="kpi"><span className="k">Brier medio</span><span className={`v num ${m.brier !== null ? (m.brier < BASELINE_BRIER ? 'good' : 'danger') : ''}`}>{m.brier === null ? '—' : num(m.brier, 3)}</span><span className="d">riferimento {num(BASELINE_BRIER, 3)} · più basso è meglio</span></div>
        <div className="kpi"><span className="k">Errore medio</span><span className="v num">{m.mae === null ? '—' : `${num(m.mae)} pt`}</span><span className="d">rendimento atteso vs effettivo</span></div>
      </div>
      {m.brier !== null && (
        <span className="small">
          {m.brier < BASELINE_BRIER ? 'Finora le previsioni fanno meglio del riferimento ingenuo (un terzo per scenario).' : 'Finora le previsioni non fanno meglio del riferimento ingenuo (un terzo per scenario).'} Servono decine di previsioni verificate perché il confronto sia significativo.
        </span>
      )}
      {table('Per categoria · casi · direzione · Brier', m.byCat)}
      {table('Per orizzonte · casi · direzione · Brier', m.byHor)}
      {m.n > 0 && (
        <div className="card small" style={{ gap: 6 }}>
          <span className="card-title">Calibrazione</span>
          <span className="tiny muted">Una previsione ben calibrata dà al 70% eventi che accadono circa 7 volte su 10.</span>
          {m.bins.filter((x) => x.n).map((x) => (
            <div key={x.lo} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{Math.round(x.lo * 100)}–{Math.round(x.hi * 100)}%</span>
              <span className="num">{x.n} casi · assegnata {ratio(x.sumP / x.n)} · osservata {ratio(x.hits / x.n)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="section-title"><h2>Storico</h2></div>
      <div className="card tight">
        {[...preds].sort((a, b) => b.seq - a.seq).slice(0, 100).map((p) => {
          const o = outcomeById.get(p.id);
          const st = !o ? 'aperta' : o.result === 'correct' ? 'corretta' : o.result === 'wrong' ? 'errata' : 'non conclusiva';
          return (
            <div key={p.id} className="row" style={{ cursor: 'default' }}>
              <span className="main">
                <span className="title">n. {p.seq} · {p.instrument}</span>
                <span className="sub">
                  {when(p.createdAt)} · {p.horizonLabel} · rif. {num(p.refPrice)} {p.currency}
                  <span className={`tag ${o?.result === 'correct' ? '' : ''}`} style={o?.result === 'correct' ? { color: 'var(--good)' } : o?.result === 'wrong' ? { color: 'var(--danger)' } : undefined}>{st}</span>
                </span>
              </span>
              <span className="amt num small" style={{ fontWeight: 600 }}>
                <span className="good">{Math.round(p.probs.up * 100)}</span> / {Math.round(p.probs.neutral * 100)} / <span className="danger">{Math.round(p.probs.down * 100)}</span>
              </span>
            </div>
          );
        })}
      </div>
      <span className="tiny muted">Probabilità rialzo / neutrale / ribasso, in %. Le regole di verifica sono nel documento di progetto e nel Metodo.</span>
    </>
  );
}

// ---------------- Watchlist ----------------
function Watchlist({ intel }: { intel: IntelState }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [category, setCategory] = useState(WATCH_CATEGORIES[1]);
  const [region, setRegion] = useState('Europa');
  const [busy, setBusy] = useState(false);
  const items = intel.cache.watchlist;
  const groups = WATCH_CATEGORIES.map((c) => ({ c, items: items.filter((w) => w.category === c).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.items.length);

  async function save(next: WatchItem[], msg: string, ok: string) {
    setBusy(true);
    try {
      await intel.saveWatchlist(next, msg);
      toast(ok);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Non salvato');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    if (!name.trim()) return;
    const item: WatchItem = { id: newId().slice(0, 8), name: name.trim(), ticker: ticker.trim().toUpperCase() || undefined, category, region, addedAt: new Date().toISOString() };
    if (await save([...items, item], `Watchlist: aggiunto ${item.name}`, 'Aggiunto alla watchlist')) {
      setName('');
      setTicker('');
    }
  }
  return (
    <>
      <span className="small muted">Gli strumenti che l’IA segue ogni giorno. Stare in watchlist non è un giudizio d’acquisto.</span>
      {!groups.length && <div className="card"><Empty>Watchlist vuota.</Empty></div>}
      {groups.map((g) => (
        <div key={g.c} className="card tight">
          <div className="card-title" style={{ padding: '12px 0 4px' }}>{g.c} <span className="aside">{g.items.length}</span></div>
          {g.items.map((w) => (
            <div key={w.id} className="row" style={{ minHeight: 48, cursor: 'default' }}>
              <span className="main">
                <span className="title" style={{ fontWeight: 500 }}>{w.name}</span>
                <span className="sub">{w.region}{w.ticker && <span className="tag">{w.ticker}</span>}</span>
              </span>
              {intel.canWrite && (
                <button className="link" disabled={busy} aria-label={`Togli ${w.name}`} onClick={() => save(items.filter((x) => x.id !== w.id), `Watchlist: tolto ${w.name}`, 'Tolto dalla watchlist')}>
                  Togli
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      {intel.canWrite ? (
        <div className="card">
          <span className="card-title">Aggiungi</span>
          <div className="fields">
            <div className="field"><label htmlFor="wn">Nome</label><input id="wn" value={name} placeholder="es. Leonardo" onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor="wt">Ticker</label><input id="wt" value={ticker} placeholder="es. LDO.MI" autoCapitalize="characters" onChange={(e) => setTicker(e.target.value)} /></div>
            <div className="field">
              <label htmlFor="wc">Categoria</label>
              <select id="wc" value={category} onChange={(e) => setCategory(e.target.value)}>{WATCH_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            </div>
            <div className="field">
              <label htmlFor="wr">Area</label>
              <select id="wr" value={region} onChange={(e) => setRegion(e.target.value)}>{['Italia', 'Europa', 'USA', 'Globale'].map((c) => <option key={c}>{c}</option>)}</select>
            </div>
          </div>
          <button className="btn" disabled={busy || !name.trim()} onClick={add}>Aggiungi alla watchlist</button>
        </div>
      ) : (
        <span className="small muted">Per modificare la watchlist aggiungi il token GitHub in Impostazioni › Intelligence.</span>
      )}
    </>
  );
}

// ---------------- Profilo d'investitore ----------------
const P_OBJ = ['Crescita del capitale', 'Rendita periodica', 'Protezione dall’inflazione', 'Pensione', 'Acquisto casa', 'Riserva di emergenza'];
const P_SECT = ['Tecnologia', 'Banche', 'Energia', 'Difesa', 'Infrastrutture', 'Titoli di Stato', 'Materie prime', 'Metalli preziosi'];
const P_AREA = ['USA (S&P 500)', 'Europa', 'Italia', 'Mercati emergenti'];

function Profile({ intel }: { intel: IntelState }) {
  const toast = useToast();
  const base: InvestorProfile = intel.cache.profile ?? { sectors: ['Tecnologia', 'Banche', 'Energia', 'Difesa', 'Infrastrutture'], areas: ['USA (S&P 500)', 'Europa'], risk: 'Bilanciata', horizon: '5–10 anni' };
  const [p, setP] = useState<InvestorProfile>(base);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof InvestorProfile, v: string | string[]) => setP((x) => ({ ...x, [k]: v }));
  const toggle = (k: 'objectives' | 'sectors' | 'areas', v: string) => setP((x) => ({ ...x, [k]: (x[k] ?? []).includes(v) ? (x[k] ?? []).filter((y) => y !== v) : [...(x[k] ?? []), v] }));
  const sel = (id: string, label: string, k: keyof InvestorProfile, opts: string[], hint?: string) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={(p[k] as string) ?? ''} disabled={!intel.canWrite} onChange={(e) => set(k, e.target.value)}>
        <option value="">Scegli</option>
        {opts.map((o) => <option key={o}>{o}</option>)}
      </select>
      {hint && <span className="visually-hidden">{hint}</span>}
    </div>
  );
  const chips = (label: string, k: 'objectives' | 'sectors' | 'areas', opts: string[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="label-caps">{label}</span>
      <div className="chip-wrap">
        {opts.map((o) => (
          <button key={o} type="button" className="chip cat inc" disabled={!intel.canWrite} aria-pressed={(p[k] ?? []).includes(o)} onClick={() => toggle(k, o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
  async function save() {
    setBusy(true);
    try {
      await intel.saveProfile(p);
      toast('Profilo salvato: il prossimo briefing ne terrà conto');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Non salvato');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <span className="small muted">Usato in ogni analisi per valutare se un’opportunità è coerente con i tuoi obiettivi. Non servono cifre esatte.</span>
      <div className="fields">
        {sel('pc', 'Capitale indicativo', 'capital', ['Fino a 5.000 €', '5.000–25.000 €', '25.000–100.000 €', 'Oltre 100.000 €', 'Preferisco non indicarlo'])}
        {sel('ph', 'Orizzonte principale', 'horizon', ['Meno di 1 anno', '1–3 anni', '3–5 anni', '5–10 anni', 'Oltre 10 anni'])}
        {sel('pr', 'Propensione al rischio', 'risk', ['Conservativa', 'Bilanciata', 'Dinamica'])}
        {sel('pl', 'Calo annuo sopportabile', 'maxLoss', ['5%', '10%', '20%', '30%', 'Oltre 30%'])}
        {sel('pq', 'Esigenze di liquidità', 'liquidity', ['Nessuna prevista', 'Possibili entro 1 anno', 'Certe entro 1 anno'])}
        {sel('ps', 'Stile', 'style', ['Lungo periodo, poche operazioni', 'Misto', 'Movimenti di breve periodo'])}
      </div>
      {chips('Obiettivi', 'objectives', P_OBJ)}
      {chips('Settori di interesse', 'sectors', P_SECT)}
      {chips('Aree geografiche', 'areas', P_AREA)}
      <div className="fields">
        <div className="field" style={{ flexDirection: 'column', alignItems: 'stretch', paddingTop: 10 }}>
          <label htmlFor="pe">Esclusioni o preferenze</label>
          <textarea id="pe" value={p.exclusions ?? ''} disabled={!intel.canWrite} placeholder="es. niente criptovalute, preferisco aziende con dividendo" onChange={(e) => set('exclusions', e.target.value)} />
        </div>
      </div>
      {intel.canWrite ? (
        <button className="btn" disabled={busy} onClick={save}>Salva profilo</button>
      ) : (
        <span className="small muted">Per salvare il profilo aggiungi il token GitHub in Impostazioni › Intelligence.</span>
      )}
      {intel.cache.profile?.updatedAt && <span className="tiny muted">Ultimo salvataggio: {when(intel.cache.profile.updatedAt)}</span>}
    </>
  );
}
