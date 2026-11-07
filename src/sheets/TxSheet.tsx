import { useEffect, useMemo, useState } from 'react';
import { Sheet, Segmented, useToast } from '../ui/common';
import { Icon } from '../ui/Icon';
import { useData, saveTransaction, deleteTransaction } from '../state/store';
import { vault } from '../persistence/vault';
import { formatEUR } from '../core/money';
import { today } from '../core/dates';
import { newId } from '../core/id';
import { NATURE_LABEL, NEED_LABEL, ASSET_CLASS_LABEL, NON_LISTED, defaultTaxClass, type AssetClass, type Frequency, type Nature, type Need, type Transaction, type TxType } from '../core/types';
import { FREQUENCY_LABEL } from '../ledger/recurring';
import { useNav } from '../ui/nav';

type Mode = TxType | 'investment';

/** Importo come stringa digitata dal tastierino: "12,5" */
function keypadInput(cur: string, key: string): string {
  if (key === 'del') return cur.slice(0, -1);
  if (key === ',') return cur.includes(',') ? cur : (cur || '0') + ',';
  const [int, dec] = cur.split(',');
  if (dec !== undefined && dec.length >= 2) return cur;
  if (dec === undefined && int.length >= 7) return cur;
  if (cur === '0') return key;
  return cur + key;
}
const toCents = (s: string) => {
  if (!s) return 0;
  const [int, dec = ''] = s.split(',');
  return Number(int || '0') * 100 + Number((dec + '00').slice(0, 2));
};
const fromCents = (c: number) => {
  const int = Math.floor(c / 100);
  const dec = c % 100;
  return dec ? `${int},${String(dec).padStart(2, '0').replace(/0$/, '')}` : String(int);
};
const displayAmount = (s: string) => {
  if (!s) return '0';
  const [int, dec] = s.split(',');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec !== undefined ? `${grouped},${dec}` : grouped;
};

export function TxSheet({ id, initialType, initialCategory }: { id?: string; initialType?: Mode; initialCategory?: string }) {
  const nav = useNav();
  const toast = useToast();
  const data = useData();
  const existing = id ? vault.get('tx', id) : undefined;

  const [mode, setMode] = useState<Mode>(existing?.type ?? initialType ?? 'expense');
  const [amount, setAmount] = useState(existing ? fromCents(existing.amount) : '');
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? initialCategory ?? null);
  const [date, setDate] = useState(existing?.date ?? today());
  const [description, setDescription] = useState(existing?.description ?? '');
  const [merchant, setMerchant] = useState(existing?.merchant ?? '');
  const [accountId, setAccountId] = useState<string | null>(existing?.accountId ?? data.accs.find((a) => a.kind === 'card')?.id ?? data.accs[0]?.id ?? null);
  const [toAccountId, setToAccountId] = useState<string | null>(existing?.toAccountId ?? data.accs.find((a) => a.kind === 'checking')?.id ?? null);
  const [freq, setFreq] = useState<'none' | Frequency>('none');
  const [nature, setNature] = useState<Nature | ''>(existing?.nature ?? '');
  const [need, setNeed] = useState<Need | ''>(existing?.need ?? '');
  const [showAll, setShowAll] = useState(false);
  const [showMore, setShowMore] = useState(false);

  // campi per l'investimento
  const holdings = data.holdings.filter((h) => !h.archived);
  const [holdingId, setHoldingId] = useState<string>(holdings[0]?.id ?? 'new');
  const [opKind, setOpKind] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState('');
  const [fees, setFees] = useState('');
  const [newName, setNewName] = useState('');
  const [newClass, setNewClass] = useState<AssetClass>('etf');
  const [invBroker, setInvBroker] = useState<string>(data.brokers[0]?.id ?? '');

  const cents = toCents(amount);
  const kind = mode === 'income' ? 'income' : 'expense';
  const isTx = mode === 'income' || mode === 'expense';

  // Categorie recenti per il tipo scelto (le ultime usate), con fallback sulle più comuni
  const recent = useMemo(() => {
    const seen: string[] = [];
    for (const t of data.txs) {
      if (t.type !== kind || !t.categoryId || seen.includes(t.categoryId)) continue;
      const c = data.catMap.get(t.categoryId);
      if (!c || c.hidden) continue;
      seen.push(t.categoryId);
      if (seen.length >= 5) break;
    }
    const defaults = kind === 'expense'
      ? ['exp-alimentazione-supermercato', 'exp-alimentazione-bar-e-caffetterie', 'exp-alimentazione-ristoranti', 'exp-trasporti-carburante', 'exp-shopping-acquisti-online']
      : ['inc-stipendio', 'inc-freelance', 'inc-rimborsi', 'inc-dividendi', 'inc-regali-entrate'];
    for (const d of defaults) if (seen.length < 5 && !seen.includes(d) && data.catMap.has(d)) seen.push(d);
    if (categoryId && !seen.includes(categoryId)) seen.unshift(categoryId);
    return seen.slice(0, 6);
  }, [data.txs, data.catMap, kind, categoryId]);

  // reset categoria se cambia il tipo
  useEffect(() => {
    if (categoryId && data.catMap.get(categoryId)?.kind !== kind) setCategoryId(null);
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // tastiera fisica (computer)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (/^[0-9]$/.test(e.key)) setAmount((a) => keypadInput(a, e.key));
      else if (e.key === ',' || e.key === '.') setAmount((a) => keypadInput(a, ','));
      else if (e.key === 'Backspace') setAmount((a) => keypadInput(a, 'del'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cat = categoryId ? data.catMap.get(categoryId) : undefined;
  const parentOfCat = cat?.parentId ? data.catMap.get(cat.parentId) : undefined;

  const canSave =
    cents > 0 &&
    (mode !== 'transfer' || (accountId && toAccountId && accountId !== toAccountId)) &&
    (mode !== 'investment' || (Number(quantity.replace(',', '.')) > 0 && (holdingId !== 'new' || newName.trim())));

  // Inserimento manuale: avvisa solo per un movimento identico nello stesso giorno
  // (la tolleranza di ±1 giorno servirà per le importazioni automatiche della Fase 4).
  function findDuplicate(): Transaction | undefined {
    return data.txs.find(
      (t) =>
        t.id !== id &&
        t.type === mode &&
        t.amount === cents &&
        t.date === date &&
        (t.categoryId === categoryId || (merchant && t.merchant?.toLowerCase() === merchant.toLowerCase()))
    );
  }

  function save() {
    if (!canSave) return;
    if (mode === 'investment') return saveInvestment();
    if (!existing) {
      const dup = findDuplicate();
      if (dup && !window.confirm(`Esiste già un movimento identico (${formatEUR(dup.amount)}, ${dup.date}). Registrarlo comunque?`)) return;
    }
    let recurringId = existing?.recurringId;
    if (!existing && freq !== 'none' && mode !== 'transfer') {
      recurringId = newId();
      vault.put('rec', {
        id: recurringId,
        type: mode,
        amount: cents,
        categoryId,
        description: description || merchant || cat?.name || '',
        accountId,
        frequency: freq,
        startDate: date,
        lastGenerated: date,
        active: true
      });
    }
    saveTransaction({
      id: existing?.id,
      createdAt: existing?.createdAt,
      type: mode,
      amount: cents,
      date,
      categoryId: mode === 'transfer' ? null : categoryId,
      description: description.trim(),
      merchant: merchant.trim() || undefined,
      accountId,
      toAccountId: mode === 'transfer' ? toAccountId : undefined,
      source: existing?.source ?? 'manual',
      recurringId,
      nature: nature || undefined,
      need: need || undefined,
      needsReview: false
    });
    toast(existing ? 'Movimento aggiornato' : mode === 'income' ? 'Ricavo salvato' : mode === 'expense' ? 'Spesa salvata' : 'Giroconto salvato');
    nav.closeSheet();
  }

  function saveInvestment() {
    let hid = holdingId;
    const qty = Number(quantity.replace(',', '.'));
    const unit = cents / qty;
    if (hid === 'new') {
      hid = newId();
      vault.put('hold', { id: hid, name: newName.trim(), assetClass: newClass, taxClass: defaultTaxClass(newClass), price: unit, priceDate: date, priceSource: 'operation' });
    } else {
      const h = vault.get('hold', hid);
      if (h && date >= h.priceDate) vault.put('hold', { ...h, price: unit, priceDate: date, priceSource: 'operation' });
    }
    vault.put('op', { id: newId(), holdingId: hid, brokerId: invBroker || null, kind: opKind, date, quantity: qty, amount: cents, fees: toCents(fees.replace('.', ',')), taxes: 0, source: 'manual' });
    toast(opKind === 'buy' ? 'Acquisto registrato' : 'Vendita registrata');
    nav.closeSheet();
  }

  function remove() {
    if (!existing) return;
    const msg = existing.recurringId
      ? 'Eliminare questo movimento? La regola ricorrente resta attiva (puoi gestirla in Impostazioni › Ricorrenze).'
      : 'Eliminare questo movimento?';
    if (!window.confirm(msg)) return;
    deleteTransaction(existing.id);
    toast('Movimento eliminato');
    nav.closeSheet();
  }

  const macros = data.cats.filter((c) => c.kind === kind && !c.parentId && !c.hidden);
  const accentClass = mode === 'income' ? 'income' : mode === 'expense' ? 'expense' : '';

  return (
    <Sheet
      title={existing ? 'Modifica movimento' : 'Nuovo movimento'}
      onClose={nav.closeSheet}
      right={
        existing ? (
          <button className="link danger" style={{ fontSize: 15 }} onClick={remove}>
            Elimina
          </button>
        ) : undefined
      }
    >
      {!existing && (
        <Segmented<Mode>
          label="Tipo di movimento"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'expense', label: 'Costo' },
            { value: 'income', label: 'Ricavo' },
            { value: 'investment', label: 'Investim.' },
            { value: 'transfer', label: 'Giroconto' }
          ]}
        />
      )}

      <div className="amount-display" aria-live="polite">
        <span className={`n num ${amount ? accentClass : 'placeholder'}`}>{displayAmount(amount)}</span>
        <span className="c">€</span>
      </div>

      {existing?.needsReview && (
        <div className="notice warn">
          <Icon name="info" size={18} /> Movimento importato: controlla categoria e importo, poi salva per confermarlo.
        </div>
      )}

      {isTx && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label-caps">{showAll ? 'Tutte le categorie' : 'Categorie'}</span>
          {!showAll ? (
            <div className="chip-wrap">
              {recent.map((cid) => (
                <button key={cid} type="button" className={`chip cat ${kind === 'income' ? 'inc' : ''}`} aria-pressed={categoryId === cid} onClick={() => setCategoryId(cid)}>
                  {data.catMap.get(cid)?.name}
                </button>
              ))}
              <button type="button" className="chip dashed" onClick={() => setShowAll(true)}>
                Tutte…
              </button>
            </div>
          ) : (
            <div className="card tight" style={{ maxHeight: 280, overflowY: 'auto' }}>
              {macros.map((m) => {
                const subs = data.cats.filter((c) => c.parentId === m.id && !c.hidden);
                return (
                  <div key={m.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
                    <button type="button" className="chip cat" style={{ border: 0, padding: 0, fontWeight: 700, background: 'none' }} onClick={() => { setCategoryId(m.id); setShowAll(false); }}>
                      {m.name}
                    </button>
                    {subs.length > 0 && (
                      <div className="chip-wrap" style={{ marginTop: 6 }}>
                        {subs.map((s) => (
                          <button key={s.id} type="button" className="chip cat" aria-pressed={categoryId === s.id} onClick={() => { setCategoryId(s.id); setShowAll(false); }}>
                            {s.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {cat && !showAll && <span className="tiny muted">{parentOfCat ? `${parentOfCat.name} › ${cat.name}` : cat.name} · {NATURE_LABEL[nature || cat.nature]} · {kind === 'expense' ? NEED_LABEL[need || cat.need] : ''}</span>}
        </div>
      )}

      {mode === 'investment' && (
        <div className="fields">
          <div className="field">
            <label htmlFor="f-hold">Investimento</label>
            <select id="f-hold" value={holdingId} onChange={(e) => setHoldingId(e.target.value)}>
              {holdings.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
              <option value="new">+ Nuovo investimento</option>
            </select>
          </div>
          {holdingId === 'new' && (
            <>
              <div className="field">
                <label htmlFor="f-hname">Nome</label>
                <input id="f-hname" value={newName} placeholder="es. ETF azionario globale" onChange={(e) => setNewName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="f-hclass">Tipo</label>
                <select id="f-hclass" value={newClass} onChange={(e) => setNewClass(e.target.value as AssetClass)}>
                  {Object.entries(ASSET_CLASS_LABEL).filter(([k]) => !NON_LISTED.includes(k as AssetClass)).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="field">
            <span className="lbl">Operazione</span>
            <div style={{ width: 180 }}>
              <Segmented label="Operazione" value={opKind} onChange={setOpKind} options={[{ value: 'buy', label: 'Acquisto' }, { value: 'sell', label: 'Vendita' }]} />
            </div>
          </div>
          {data.brokers.length > 0 && (
            <div className="field">
              <label htmlFor="f-brk">Intermediario</label>
              <select id="f-brk" value={invBroker} onChange={(e) => setInvBroker(e.target.value)}>
                <option value="">Nessuno</option>
                {data.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="f-qty">Quantità (quote)</label>
            <input id="f-qty" inputMode="decimal" value={quantity} placeholder="es. 3,5" onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-fees">Commissioni (€)</label>
            <input id="f-fees" inputMode="decimal" value={fees} placeholder="0" onChange={(e) => setFees(e.target.value)} />
          </div>
        </div>
      )}

      <div className="fields">
        <div className="field">
          <label htmlFor="f-date">Data</label>
          <input id="f-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        {isTx && (
          <>
            <div className="field">
              <label htmlFor="f-desc">Descrizione</label>
              <input id="f-desc" value={description} placeholder="Facoltativa" onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="f-merch">{mode === 'income' ? 'Fonte' : 'Esercente'}</label>
              <input id="f-merch" value={merchant} placeholder="Facoltativo" onChange={(e) => setMerchant(e.target.value)} />
            </div>
          </>
        )}
        {mode !== 'investment' && (
          <div className="field">
            <label htmlFor="f-acc">{mode === 'transfer' ? 'Da conto' : 'Conto'}</label>
            <select id="f-acc" value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value || null)}>
              <option value="">Nessuno</option>
              {data.accs.filter((a) => !a.hidden).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {mode === 'transfer' && (
          <div className="field">
            <label htmlFor="f-to">A conto</label>
            <select id="f-to" value={toAccountId ?? ''} onChange={(e) => setToAccountId(e.target.value || null)}>
              <option value="">Scegli</option>
              {data.accs.filter((a) => !a.hidden).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {isTx && !existing && (
          <div className="field">
            <label htmlFor="f-freq">Ricorrenza</label>
            <select id="f-freq" value={freq} onChange={(e) => setFreq(e.target.value as 'none' | Frequency)}>
              <option value="none">Nessuna</option>
              {Object.entries(FREQUENCY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}
        {isTx && existing?.recurringId && (
          <div className="field">
            <span className="lbl">Ricorrenza</span>
            <span className="small muted">Generato da una regola ricorrente</span>
          </div>
        )}
      </div>

      {isTx && (
        <>
          <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setShowMore((v) => !v)}>
            {showMore ? 'Nascondi classificazione' : 'Classificazione (fissa, variabile, necessaria…)'}
          </button>
          {showMore && (
            <div className="fields">
              <div className="field">
                <label htmlFor="f-nat">Tipo di spesa</label>
                <select id="f-nat" value={nature} onChange={(e) => setNature(e.target.value as Nature | '')}>
                  <option value="">Automatico{cat ? ` (${NATURE_LABEL[cat.nature]})` : ''}</option>
                  {Object.entries(NATURE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              {kind === 'expense' && (
                <div className="field">
                  <label htmlFor="f-need">Necessità</label>
                  <select id="f-need" value={need} onChange={(e) => setNeed(e.target.value as Need | '')}>
                    <option value="">Automatico{cat ? ` (${NEED_LABEL[cat.need]})` : ''}</option>
                    {Object.entries(NEED_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="keypad" aria-label="Tastierino importo">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0'].map((k) => (
          <button key={k} type="button" onClick={() => setAmount((a) => keypadInput(a, k))}>
            {k}
          </button>
        ))}
        <button type="button" aria-label="Cancella" onClick={() => setAmount((a) => keypadInput(a, 'del'))}>
          <Icon name="back" size={22} />
        </button>
      </div>

      <button className="btn" disabled={!canSave} onClick={save}>
        {existing ? 'Salva modifiche' : mode === 'income' ? 'Salva ricavo' : mode === 'expense' ? 'Salva spesa' : mode === 'transfer' ? 'Salva giroconto' : opKind === 'buy' ? 'Registra acquisto' : 'Registra vendita'}
      </button>
    </Sheet>
  );
}
