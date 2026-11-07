import { useState } from 'react';
import { Sheet, Segmented, useToast } from '../ui/common';
import { useData } from '../state/store';
import { useNav } from '../ui/nav';
import { vault } from '../persistence/vault';
import { newId } from '../core/id';
import { parseEUR, formatEUR } from '../core/money';
import { today } from '../core/dates';
import { slug } from '../core/categories';
import { ASSET_CLASS_LABEL, NATURE_LABEL, NEED_LABEL, NON_LISTED, OP_KIND_LABEL, TAX_CLASS_LABEL, defaultTaxClass, type Account, type AssetClass, type Broker, type Frequency, type Nature, type Need, type OpKind, type TaxClass } from '../core/types';
import { FREQUENCY_LABEL } from '../ledger/recurring';

const centsToInput = (c: number) => (c / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
const qtyNum = (s: string) => Number(s.replace(',', '.'));

// ---------------- Strumento o bene (anagrafica) ----------------
export function HoldingSheet({ id }: { id?: string }) {
  const nav = useNav();
  const toast = useToast();
  const data = useData();
  const h = id ? vault.get('hold', id) : undefined;
  const [name, setName] = useState(h?.name ?? '');
  const [cls, setCls] = useState<AssetClass>(h?.assetClass ?? 'etf');
  const [isin, setIsin] = useState(h?.isin ?? '');
  const [symbol, setSymbol] = useState(h?.symbol ?? '');
  const [taxClass, setTaxClass] = useState<TaxClass | ''>(h?.taxClass ?? '');
  const [distribution, setDistribution] = useState<'' | 'acc' | 'dist'>(h?.distribution ?? '');
  const [rate, setRate] = useState(h?.details?.rate !== undefined ? String(h.details.rate).replace('.', ',') : '');
  const [maturity, setMaturity] = useState(h?.details?.maturity ?? '');
  const [locked, setLocked] = useState(h?.details?.locked ?? false);
  const [debt, setDebt] = useState(h?.details?.debt ? centsToInput(h.details.debt) : '');
  const [fundLine, setFundLine] = useState(h?.details?.fundLine ?? '');
  const [notes, setNotes] = useState(h?.notes ?? '');
  // solo per un nuovo bene non quotato: valore iniziale
  const [value, setValue] = useState('');
  const [paid, setPaid] = useState('');
  const [date, setDate] = useState(today());
  const [brokerId, setBrokerId] = useState(data.brokers[0]?.id ?? '');
  const nonListed = NON_LISTED.includes(cls);
  const isinOk = !isin || /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin.trim().toUpperCase());

  function save() {
    if (!name.trim() || !isinOk) return;
    const nid = h?.id ?? newId();
    const details = {
      ...(cls === 'cash' && rate ? { rate: Number(rate.replace(',', '.')) } : {}),
      ...(cls === 'cash' && maturity ? { maturity } : {}),
      ...(cls === 'cash' && locked ? { locked } : {}),
      ...(cls === 'real_estate' && parseEUR(debt) ? { debt: parseEUR(debt)! } : {}),
      ...(cls === 'pension' && fundLine.trim() ? { fundLine: fundLine.trim() } : {})
    };
    const isNewNonListed = !h && nonListed && (parseEUR(value) ?? 0) > 0;
    vault.put('hold', {
      ...(h ?? { price: 0, priceDate: today() }),
      ...(isNewNonListed ? { price: parseEUR(value)!, priceDate: date, priceSource: 'manual' as const } : {}),
      id: nid,
      name: name.trim(),
      assetClass: cls,
      isin: isin.trim().toUpperCase() || undefined,
      symbol: symbol.trim().toUpperCase() || undefined,
      taxClass: taxClass || defaultTaxClass(cls),
      distribution: distribution || undefined,
      details: Object.keys(details).length ? details : undefined,
      notes: notes.trim() || undefined
    });
    if (isNewNonListed) {
      // il capitale versato diventa il primo movimento: quantità 1, valutato al valore indicato
      const capital = parseEUR(paid) ?? parseEUR(value)!;
      vault.put('op', { id: newId(), holdingId: nid, brokerId: brokerId || null, kind: 'buy', date, quantity: 1, amount: capital, fees: 0, taxes: 0, source: 'manual' });
    }
    toast(h ? 'Aggiornato' : nonListed ? 'Bene aggiunto' : 'Strumento creato: ora registra un acquisto');
    nav.closeSheet();
    if (!h) nav.push({ name: 'holding', id: nid });
  }
  function remove() {
    if (!h) return;
    const ops = vault.list('op').filter((o) => o.holdingId === h.id);
    if (!window.confirm(ops.length ? `Eliminare "${h.name}" e le sue ${ops.length} operazioni?` : `Eliminare "${h.name}"?`)) return;
    vault.remove('op', ops.map((o) => o.id));
    vault.remove('price', vault.list('price').filter((p) => p.holdingId === h.id).map((p) => p.id));
    vault.remove('hold', h.id);
    nav.closeSheet();
    nav.pop();
  }
  return (
    <Sheet title={h ? 'Modifica' : 'Nuovo strumento o bene'} onClose={nav.closeSheet} right={h && <button className="link danger" style={{ fontSize: 15 }} onClick={remove}>Elimina</button>}>
      <div className="fields">
        <div className="field">
          <label htmlFor="hc">Tipo</label>
          <select id="hc" value={cls} onChange={(e) => setCls(e.target.value as AssetClass)}>
            {Object.entries(ASSET_CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="hn">Nome</label><input id="hn" value={name} placeholder={nonListed ? 'es. Conto deposito Banca X' : 'es. ETF azionario globale'} onChange={(e) => setName(e.target.value)} /></div>
        {!nonListed && (
          <>
            <div className="field"><label htmlFor="hi">ISIN</label><input id="hi" value={isin} placeholder="es. IE00BK5BQT80" autoCapitalize="characters" onChange={(e) => setIsin(e.target.value)} /></div>
            <div className="field"><label htmlFor="hs">Ticker e borsa</label><input id="hs" value={symbol} placeholder="es. VWCE.XETRA" autoCapitalize="characters" onChange={(e) => setSymbol(e.target.value)} /></div>
            {(cls === 'etf' || cls === 'fund' || cls === 'stock') && (
              <div className="field">
                <label htmlFor="hd">Proventi</label>
                <select id="hd" value={distribution} onChange={(e) => setDistribution(e.target.value as '' | 'acc' | 'dist')}>
                  <option value="">Non indicato</option>
                  <option value="acc">Ad accumulo</option>
                  <option value="dist">A distribuzione</option>
                </select>
              </div>
            )}
          </>
        )}
        {cls === 'cash' && (
          <>
            <div className="field"><label htmlFor="hr">Tasso lordo annuo (%)</label><input id="hr" inputMode="decimal" value={rate} placeholder="es. 3,25" onChange={(e) => setRate(e.target.value)} /></div>
            <div className="field"><label htmlFor="hm">Scadenza</label><input id="hm" type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} /></div>
            <div className="field"><label htmlFor="hl">Vincolato</label><input id="hl" type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} style={{ flex: 'none', width: 22, height: 22 }} /></div>
          </>
        )}
        {cls === 'real_estate' && <div className="field"><label htmlFor="hdb">Mutuo residuo (€)</label><input id="hdb" inputMode="decimal" value={debt} placeholder="0" onChange={(e) => setDebt(e.target.value)} /></div>}
        {cls === 'pension' && <div className="field"><label htmlFor="hf">Comparto</label><input id="hf" value={fundLine} placeholder="es. Bilanciato" onChange={(e) => setFundLine(e.target.value)} /></div>}
        <div className="field">
          <label htmlFor="ht">Classe fiscale</label>
          <select id="ht" value={taxClass} onChange={(e) => setTaxClass(e.target.value as TaxClass | '')}>
            <option value="">Automatica ({TAX_CLASS_LABEL[defaultTaxClass(cls)].split(' (')[0]})</option>
            {Object.entries(TAX_CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="hno">Note</label><input id="hno" value={notes} placeholder="Facoltative" onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      {!isinOk && <span className="small danger">L’ISIN ha 12 caratteri: 2 lettere del paese, 9 lettere o cifre, 1 cifra finale.</span>}
      {!h && nonListed && (
        <>
          <span className="label-caps">Valore di partenza</span>
          <div className="fields">
            <div className="field"><label htmlFor="hv">Valore attuale (€)</label><input id="hv" inputMode="decimal" value={value} placeholder="0" onChange={(e) => setValue(e.target.value)} /></div>
            <div className="field"><label htmlFor="hp">Capitale versato (€)</label><input id="hp" inputMode="decimal" value={paid} placeholder="uguale al valore" onChange={(e) => setPaid(e.target.value)} /></div>
            <div className="field"><label htmlFor="hdt">Data</label><input id="hdt" type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
            {data.brokers.length > 0 && (
              <div className="field">
                <label htmlFor="hb">Presso</label>
                <select id="hb" value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
                  <option value="">Nessun intermediario</option>
                  {data.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
          </div>
        </>
      )}
      {!nonListed && <span className="tiny muted">Il ticker nel formato TICKER.BORSA (es. VWCE.XETRA, ENI.MI) servirà per i prezzi automatici.</span>}
      <button className="btn" disabled={!name.trim() || !isinOk} onClick={save}>{h ? 'Salva' : 'Aggiungi'}</button>
    </Sheet>
  );
}

// ---------------- Operazione su uno strumento ----------------
const OP_HELP: Record<OpKind, string> = {
  buy: 'Controvalore pagato, commissioni escluse.',
  sell: 'Controvalore incassato, prima di commissioni e tasse.',
  dividend: 'Importo lordo; indica a parte le ritenute.',
  coupon: 'Importo lordo; indica a parte le ritenute.',
  fee: 'Costi di gestione, commissioni di custodia o simili.',
  tax: 'Imposta di bollo, imposte o tasse non legate a una vendita.',
  split: 'Quote aggiunte con il frazionamento (negative se raggruppamento).'
};

export function OpSheet({ holdingId, id }: { holdingId?: string; id?: string }) {
  const nav = useNav();
  const toast = useToast();
  const data = useData();
  const op = id ? vault.get('op', id) : undefined;
  const [hid, setHid] = useState(op?.holdingId ?? holdingId ?? data.holdings[0]?.id ?? '');
  const holding = data.holdings.find((h) => h.id === hid);
  const nonListed = holding ? NON_LISTED.includes(holding.assetClass) : false;
  const [kind, setKind] = useState<OpKind>(op?.kind ?? 'buy');
  const [brokerId, setBrokerId] = useState(op?.brokerId ?? data.brokers[0]?.id ?? '');
  const [date, setDate] = useState(op?.date ?? today());
  const [qty, setQty] = useState(op ? String(op.quantity).replace('.', ',') : '');
  const [amount, setAmount] = useState(op ? centsToInput(op.amount) : '');
  const [fees, setFees] = useState(op ? centsToInput(op.fees) : '');
  const [taxes, setTaxes] = useState(op?.taxes ? centsToInput(op.taxes) : '');
  const [note, setNote] = useState(op?.note ?? '');
  const hasQty = (kind === 'buy' || kind === 'sell' || kind === 'split') && !nonListed;
  const cents = parseEUR(amount) ?? 0;
  const q = nonListed && (kind === 'buy' || kind === 'sell') ? 1 : hasQty ? qtyNum(qty) : 0;
  const valid = hid && (kind === 'split' ? q !== 0 : cents > 0) && (!hasQty || kind === 'split' || q > 0);
  const kinds: OpKind[] = nonListed ? ['buy', 'sell', 'dividend', 'fee', 'tax'] : ['buy', 'sell', 'dividend', 'coupon', 'fee', 'tax', 'split'];
  const label = (k: OpKind) => (nonListed && k === 'buy' ? 'Versamento' : nonListed && k === 'sell' ? 'Prelievo' : nonListed && k === 'dividend' ? 'Interessi o rendita' : OP_KIND_LABEL[k]);

  function save() {
    if (!valid) return;
    vault.put('op', {
      id: op?.id ?? newId(), holdingId: hid, brokerId: brokerId || null, kind, date,
      quantity: q, amount: kind === 'split' ? 0 : cents, fees: parseEUR(fees) ?? 0, taxes: parseEUR(taxes) ?? 0,
      source: op?.source ?? 'manual', externalId: op?.externalId, note: note.trim() || undefined
    });
    const h = vault.get('hold', hid);
    if (h && !nonListed && (kind === 'buy' || kind === 'sell') && q > 0 && date >= h.priceDate) vault.put('hold', { ...h, price: cents / q, priceDate: date, priceSource: 'operation' });
    toast(op ? 'Operazione aggiornata' : 'Operazione registrata');
    nav.closeSheet();
  }
  function remove() {
    if (!op || !window.confirm('Eliminare questa operazione?')) return;
    vault.remove('op', op.id);
    nav.closeSheet();
  }
  return (
    <Sheet title={op ? 'Modifica operazione' : 'Nuova operazione'} onClose={nav.closeSheet} right={op && <button className="link danger" style={{ fontSize: 15 }} onClick={remove}>Elimina</button>}>
      <div className="fields">
        <div className="field">
          <label htmlFor="oh">Strumento</label>
          <select id="oh" value={hid} onChange={(e) => setHid(e.target.value)}>
            {data.holdings.filter((h) => !h.archived).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ok">Operazione</label>
          <select id="ok" value={kind} onChange={(e) => setKind(e.target.value as OpKind)}>
            {kinds.map((k) => <option key={k} value={k}>{label(k)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ob">Intermediario</label>
          <select id="ob" value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
            <option value="">Nessuno</option>
            {data.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="od">Data</label><input id="od" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
        {hasQty && <div className="field"><label htmlFor="oq">Quote</label><input id="oq" inputMode="decimal" value={qty} placeholder="es. 3,5" onChange={(e) => setQty(e.target.value)} /></div>}
        {kind !== 'split' && <div className="field"><label htmlFor="oa">Importo (€)</label><input id="oa" inputMode="decimal" value={amount} placeholder="0,00" onChange={(e) => setAmount(e.target.value)} /></div>}
        {(kind === 'buy' || kind === 'sell' || kind === 'dividend' || kind === 'coupon') && <div className="field"><label htmlFor="of">Commissioni (€)</label><input id="of" inputMode="decimal" value={fees} placeholder="0" onChange={(e) => setFees(e.target.value)} /></div>}
        {(kind === 'sell' || kind === 'dividend' || kind === 'coupon') && <div className="field"><label htmlFor="ot">Tasse trattenute (€)</label><input id="ot" inputMode="decimal" value={taxes} placeholder="0" onChange={(e) => setTaxes(e.target.value)} /></div>}
        <div className="field"><label htmlFor="on">Nota</label><input id="on" value={note} placeholder="Facoltativa" onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <span className="tiny muted">{nonListed && kind === 'buy' ? 'Somma versata.' : nonListed && kind === 'sell' ? 'Somma prelevata.' : OP_HELP[kind]}</span>
      {hasQty && kind !== 'split' && q > 0 && cents > 0 && <span className="small muted">Prezzo per quota: {formatEUR(Math.round(cents / q))}</span>}
      <button className="btn" disabled={!valid} onClick={save}>{op ? 'Salva' : 'Registra'}</button>
    </Sheet>
  );
}

// ---------------- Aggiornamento prezzo o valore ----------------
export function PriceSheet({ holdingId }: { holdingId: string }) {
  const nav = useNav();
  const toast = useToast();
  const h = vault.get('hold', holdingId);
  const [price, setPrice] = useState(h ? centsToInput(Math.round(h.price)) : '');
  const [date, setDate] = useState(today());
  if (!h) return null;
  const nonListed = NON_LISTED.includes(h.assetClass);
  const cents = parseEUR(price) ?? 0;
  function save() {
    if (!h || cents <= 0) return;
    vault.put('price', { id: `${h.id}-${date}`, holdingId: h.id, date, price: cents });
    if (date >= h.priceDate) vault.put('hold', { ...h, price: cents, priceDate: date, priceSource: 'manual' });
    toast(nonListed ? 'Valore aggiornato' : 'Prezzo aggiornato');
    nav.closeSheet();
  }
  return (
    <Sheet title={nonListed ? 'Aggiorna valore' : 'Aggiorna prezzo'} onClose={nav.closeSheet}>
      <span className="small muted">{h.name}: {nonListed ? 'valore complessivo stimato oggi.' : 'prezzo di una quota.'} Ogni aggiornamento resta nello storico e alimenta il grafico.</span>
      <div className="fields">
        <div className="field"><label htmlFor="pp">{nonListed ? 'Valore (€)' : 'Prezzo per quota (€)'}</label><input id="pp" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus /></div>
        <div className="field"><label htmlFor="pd">Data</label><input id="pd" type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
      </div>
      <button className="btn" disabled={cents <= 0} onClick={save}>Salva</button>
    </Sheet>
  );
}

// ---------------- Intermediario ----------------
export function BrokerSheet({ id }: { id?: string }) {
  const nav = useNav();
  const data = useData();
  const b = id ? vault.get('brk', id) : undefined;
  const [name, setName] = useState(b?.name ?? '');
  const [kind, setKind] = useState<Broker['kind']>(b?.kind ?? 'broker');
  const [country, setCountry] = useState(b?.country ?? 'IT');
  const [taxRegime, setTaxRegime] = useState<Broker['taxRegime']>(b?.taxRegime ?? 'administered');
  const [hidden, setHidden] = useState(b?.hidden ?? false);
  const used = id ? data.ops.filter((o) => o.brokerId === id).length : 0;
  function save() {
    if (!name.trim()) return;
    vault.put('brk', { id: b?.id ?? newId(), name: name.trim(), kind, country: country.trim().toUpperCase().slice(0, 2) || 'IT', taxRegime, hidden, notes: b?.notes });
    nav.closeSheet();
  }
  function remove() {
    if (!b) return;
    if (used) { window.alert(`L’intermediario ha ${used} operazioni: puoi nasconderlo.`); return; }
    if (!window.confirm(`Eliminare "${b.name}"?`)) return;
    vault.remove('brk', b.id);
    nav.closeSheet();
  }
  return (
    <Sheet title={b ? 'Modifica intermediario' : 'Nuovo intermediario'} onClose={nav.closeSheet} right={b && <button className="link danger" style={{ fontSize: 15 }} onClick={remove}>Elimina</button>}>
      <div className="fields">
        <div className="field"><label htmlFor="bn">Nome</label><input id="bn" value={name} placeholder="es. Broker X" onChange={(e) => setName(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="bk">Tipo</label>
          <select id="bk" value={kind} onChange={(e) => setKind(e.target.value as Broker['kind'])}>
            <option value="broker">Broker</option>
            <option value="bank">Banca</option>
            <option value="pension">Fondo pensione</option>
            <option value="exchange">Exchange</option>
            <option value="other">Altro</option>
          </select>
        </div>
        <div className="field"><label htmlFor="bc">Paese (sigla)</label><input id="bc" value={country} maxLength={2} autoCapitalize="characters" onChange={(e) => setCountry(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="br">Regime fiscale</label>
          <select id="br" value={taxRegime} onChange={(e) => setTaxRegime(e.target.value as Broker['taxRegime'])}>
            <option value="administered">Amministrato</option>
            <option value="declared">Dichiarativo</option>
          </select>
        </div>
        {b && <div className="field"><label htmlFor="bh">Nascondi</label><input id="bh" type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} style={{ flex: 'none', width: 22, height: 22 }} /></div>}
      </div>
      <span className="tiny muted">{taxRegime === 'administered' ? 'Amministrato: l’intermediario calcola e paga le tasse per te. L’app registra quelle trattenute.' : 'Dichiarativo: le plusvalenze vanno dichiarate da te. I calcoli arrivano nella tappa I3.'}</span>
      <button className="btn" disabled={!name.trim()} onClick={save}>Salva</button>
    </Sheet>
  );
}

// ---------------- Regola ricorrente ----------------
export function RuleSheet({ id }: { id?: string }) {
  const nav = useNav();
  const toast = useToast();
  const data = useData();
  const r = id ? vault.get('rec', id) : undefined;
  const [type, setType] = useState<'income' | 'expense'>(r?.type ?? 'expense');
  const [description, setDescription] = useState(r?.description ?? '');
  const [amount, setAmount] = useState(r ? centsToInput(r.amount) : '');
  const [categoryId, setCategoryId] = useState(r?.categoryId ?? '');
  const [frequency, setFrequency] = useState<Frequency>(r?.frequency ?? 'monthly');
  const [startDate, setStartDate] = useState(r?.startDate ?? today());
  const [endDate, setEndDate] = useState(r?.endDate ?? '');
  const [accountId, setAccountId] = useState(r?.accountId ?? data.accs[0]?.id ?? '');
  const [active, setActive] = useState(r?.active ?? true);
  const cents = parseEUR(amount) ?? 0;
  const cats = data.cats.filter((c) => c.kind === type && !c.hidden);

  function save() {
    if (cents <= 0) return;
    const changedSchedule = r && (r.startDate !== startDate || r.frequency !== frequency);
    vault.put('rec', {
      id: r?.id ?? newId(),
      type, description: description.trim(), amount: cents, categoryId: categoryId || null, frequency, startDate,
      endDate: endDate || null, accountId: accountId || null, active,
      // una nuova regola parte dalla data scelta: le occorrenze passate vengono create subito
      lastGenerated: changedSchedule ? null : (r?.lastGenerated ?? null)
    });
    toast(r ? 'Ricorrenza aggiornata (vale per le prossime occorrenze)' : 'Ricorrenza creata');
    nav.closeSheet();
  }
  function remove() {
    if (!r || !window.confirm('Eliminare la ricorrenza? I movimenti già creati restano.')) return;
    vault.remove('rec', r.id);
    nav.closeSheet();
  }
  return (
    <Sheet title={r ? 'Modifica ricorrenza' : 'Nuova ricorrenza'} onClose={nav.closeSheet} right={r && <button className="link danger" style={{ fontSize: 15 }} onClick={remove}>Elimina</button>}>
      {!r && <Segmented label="Tipo" value={type} onChange={(v) => { setType(v); setCategoryId(''); }} options={[{ value: 'expense', label: 'Spesa' }, { value: 'income', label: 'Ricavo' }]} />}
      <div className="fields">
        <div className="field"><label htmlFor="rd">Descrizione</label><input id="rd" value={description} placeholder="es. Affitto, Netflix" onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="field"><label htmlFor="ra">Importo (€)</label><input id="ra" inputMode="decimal" value={amount} placeholder="0,00" onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="rc">Categoria</label>
          <select id="rc" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Nessuna</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.parentId ? `  ${c.name}` : c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rf">Frequenza</label>
          <select id="rf" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            {Object.entries(FREQUENCY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="rs">Prima scadenza</label><input id="rs" type="date" value={startDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} /></div>
        <div className="field"><label htmlFor="re">Fine (facoltativa)</label><input id="re" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="rac">Conto</label>
          <select id="rac" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Nessuno</option>
            {data.accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ract">Attiva</label>
          <input id="ract" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ flex: 'none', width: 22, height: 22 }} />
        </div>
      </div>
      {!r && startDate < today() && <span className="small muted">Le occorrenze già passate dalla prima scadenza a oggi verranno registrate subito.</span>}
      <button className="btn" disabled={cents <= 0} onClick={save}>Salva ricorrenza</button>
    </Sheet>
  );
}

// ---------------- Categoria ----------------
export function CategorySheet({ id, kind, parentId }: { id?: string; kind: 'income' | 'expense'; parentId?: string | null }) {
  const nav = useNav();
  const toast = useToast();
  const data = useData();
  const c = id ? vault.get('cat', id) : undefined;
  const parent = (c?.parentId ?? parentId) ? data.catMap.get((c?.parentId ?? parentId)!) : undefined;
  const [name, setName] = useState(c?.name ?? '');
  const [nature, setNature] = useState<Nature>(c?.nature ?? parent?.nature ?? (kind === 'income' ? 'occasional' : 'variable'));
  const [need, setNeed] = useState<Need>(c?.need ?? parent?.need ?? 'necessary');
  const [hidden, setHidden] = useState(c?.hidden ?? false);
  const used = id ? data.txs.filter((t) => t.categoryId === id).length : 0;
  const children = id ? data.cats.filter((x) => x.parentId === id) : [];

  function save() {
    if (!name.trim()) return;
    const siblings = data.cats.filter((x) => x.kind === kind && x.parentId === (parent?.id ?? null));
    vault.put('cat', {
      id: c?.id ?? `${kind === 'income' ? 'inc' : 'exp'}-u-${slug(name)}-${newId().slice(0, 6)}`,
      name: name.trim(), kind, parentId: parent?.id ?? null, icon: c?.icon ?? parent?.icon ?? (kind === 'income' ? 'income' : 'dots'),
      nature, need, hidden, order: c?.order ?? siblings.length
    });
    toast(c ? 'Categoria aggiornata' : 'Categoria creata');
    nav.closeSheet();
  }
  function remove() {
    if (!c) return;
    if (used > 0 || children.some((ch) => data.txs.some((t) => t.categoryId === ch.id))) {
      window.alert('La categoria è usata da alcuni movimenti: puoi nasconderla invece di eliminarla.');
      return;
    }
    if (!window.confirm(`Eliminare "${c.name}"${children.length ? ' e le sue sottocategorie' : ''}?`)) return;
    vault.remove('cat', [c.id, ...children.map((x) => x.id)]);
    nav.closeSheet();
  }
  return (
    <Sheet title={c ? 'Modifica categoria' : parent ? 'Nuova sottocategoria' : 'Nuova categoria'} onClose={nav.closeSheet} right={c && <button className="link danger" style={{ fontSize: 15 }} onClick={remove}>Elimina</button>}>
      {parent && <span className="small muted">In: {parent.name}</span>}
      <div className="fields">
        <div className="field"><label htmlFor="cn">Nome</label><input id="cn" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="cna">Tipo</label>
          <select id="cna" value={nature} onChange={(e) => setNature(e.target.value as Nature)}>
            {Object.entries(NATURE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {kind === 'expense' && (
          <div className="field">
            <label htmlFor="cne">Necessità</label>
            <select id="cne" value={need} onChange={(e) => setNeed(e.target.value as Need)}>
              {Object.entries(NEED_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        )}
        {c && (
          <div className="field">
            <label htmlFor="ch">Nascondi dalle scelte</label>
            <input id="ch" type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} style={{ flex: 'none', width: 22, height: 22 }} />
          </div>
        )}
      </div>
      {used > 0 && <span className="small muted">Usata da {used} movimenti. La classificazione si applica a tutti quelli senza una classificazione propria.</span>}
      <button className="btn" disabled={!name.trim()} onClick={save}>Salva</button>
    </Sheet>
  );
}

// ---------------- Conto ----------------
export function AccountSheet({ id }: { id?: string }) {
  const nav = useNav();
  const data = useData();
  const a = id ? vault.get('acc', id) : undefined;
  const [name, setName] = useState(a?.name ?? '');
  const [kind, setKind] = useState<Account['kind']>(a?.kind ?? 'checking');
  const [hidden, setHidden] = useState(a?.hidden ?? false);
  const used = id ? data.txs.some((t) => t.accountId === id || t.toAccountId === id) : false;
  function save() {
    if (!name.trim()) return;
    vault.put('acc', { id: a?.id ?? newId(), name: name.trim(), kind, hidden });
    nav.closeSheet();
  }
  function remove() {
    if (!a) return;
    if (used) { window.alert('Il conto è usato da alcuni movimenti: puoi nasconderlo.'); return; }
    if (!window.confirm(`Eliminare "${a.name}"?`)) return;
    vault.remove('acc', a.id);
    nav.closeSheet();
  }
  return (
    <Sheet title={a ? 'Modifica conto' : 'Nuovo conto'} onClose={nav.closeSheet} right={a && <button className="link danger" style={{ fontSize: 15 }} onClick={remove}>Elimina</button>}>
      <div className="fields">
        <div className="field"><label htmlFor="an">Nome</label><input id="an" value={name} placeholder="es. Conto Banca X" onChange={(e) => setName(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="ak">Tipo</label>
          <select id="ak" value={kind} onChange={(e) => setKind(e.target.value as Account['kind'])}>
            <option value="checking">Conto corrente</option>
            <option value="card">Carta</option>
            <option value="cash">Contanti</option>
            <option value="savings">Conto deposito</option>
            <option value="other">Altro</option>
          </select>
        </div>
        {a && (
          <div className="field">
            <label htmlFor="ah">Nascondi</label>
            <input id="ah" type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} style={{ flex: 'none', width: 22, height: 22 }} />
          </div>
        )}
      </div>
      <button className="btn" disabled={!name.trim()} onClick={save}>Salva</button>
    </Sheet>
  );
}
