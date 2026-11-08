import { useRef, useState } from 'react';
import { vault } from '../persistence/vault';
import { saveSettings, useData } from '../state/store';
import { useNav } from '../ui/nav';
import { Header, useToast } from '../ui/common';
import { Icon } from '../ui/Icon';
import { planImport, type ImportPlan } from '../ledger/applepay';
import { newId, nowISO } from '../core/id';
import { formatEUR } from '../core/money';

export const LINE_TEMPLATE = '[Data attuale];[Importo];[Esercente];[Carta]';

/** Importa il file scritto dall'automazione di Comandi; restituisce il riepilogo */
export async function importApplePayFile(file: File): Promise<ImportPlan> {
  const text = await file.text();
  const settings = vault.get('settings', 'settings')!;
  const plan = planImport(text, vault.list('tx'), settings, vault.list('acc'), nowISO());
  if (plan.add.length) vault.putMany('tx', plan.add);
  saveSettings({ lastApplePayImport: nowISO() });
  return plan;
}

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

export function summary(p: ImportPlan): string {
  if (!p.add.length) return p.already ? `Nessun pagamento nuovo (${p.already} già importati).` : 'Nessun pagamento trovato nel file.';
  const toReview = p.add.length - p.autoConfirmed;
  return [
    n(p.add.length, 'pagamento importato', 'pagamenti importati'),
    toReview ? `${toReview} da confermare` : '',
    p.autoConfirmed ? n(p.autoConfirmed, 'confermato in automatico', 'confermati in automatico') : '',
    p.duplicates ? n(p.duplicates, 'possibile doppione', 'possibili doppioni') : '',
    p.skipped.length ? n(p.skipped.length, 'riga non riconosciuta', 'righe non riconosciute') : ''
  ]
    .filter(Boolean)
    .join(' · ');
}

export function ApplePay() {
  const data = useData();
  const nav = useNav();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [res, setRes] = useState<ImportPlan | null>(null);
  const [contains, setContains] = useState('');
  const [cat, setCat] = useState('');
  const s = data.settings;
  const expCats = data.cats.filter((c) => c.kind === 'expense' && c.parentId);
  const learned = Object.keys(s.merchantRules ?? {}).length;
  const toReview = data.txs.filter((t) => t.needsReview).length;

  async function onFile(f: File | undefined) {
    if (!f) return;
    try {
      const p = await importApplePayFile(f);
      setRes(p);
      toast(summary(p));
    } catch (e) {
      toast('File non leggibile: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      if (file.current) file.current.value = '';
    }
  }

  function addRule() {
    if (!contains.trim() || !cat) return;
    saveSettings({ keywordRules: [...(s.keywordRules ?? []), { id: newId(), contains: contains.trim(), categoryId: cat }] });
    setContains('');
    setCat('');
    toast('Regola aggiunta');
  }

  return (
    <div className="screen no-tab">
      <Header onBack={nav.pop} eyebrow="Automazioni" title="Apple Pay" />

      <div className="card" style={{ gap: 10 }}>
        <span className="card-title">Importa i pagamenti</span>
        <span className="small muted">
          Scegli il file <b>movimenti.txt</b> in iCloud Drive › Shortcuts (in italiano può comparire come “Comandi”). I pagamenti già importati vengono saltati, quindi puoi importare lo stesso file tutte le volte che vuoi.
        </span>
        <input ref={file} type="file" accept=".txt,text/plain" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
        <button className="btn" onClick={() => file.current?.click()}>Scegli il file e importa</button>
        {res && (
          <div className="notice info small" role="status">
            <Icon name="info" size={18} />
            <span>
              {summary(res)}
              {res.add.length > 0 && <> · totale {formatEUR(res.add.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0))}</>}
            </span>
          </div>
        )}
        {toReview > 0 && (
          <button className="btn secondary" onClick={() => nav.push({ name: 'txList', filter: { review: true, title: 'Da confermare' } })}>
            {toReview === 1 ? 'Controlla il movimento da confermare' : `Controlla i ${toReview} movimenti da confermare`}
          </button>
        )}
        {s.lastApplePayImport && <span className="tiny muted">Ultimo import: {new Date(s.lastApplePayImport).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
      </div>

      <div className="card" style={{ gap: 10 }}>
        <span className="card-title">Categorie automatiche</span>
        <span className="small muted">
          Quando confermi un pagamento, l’app ricorda la categoria di quell’esercente e la propone la volta dopo. Esercenti imparati: <b>{learned}</b>.
        </span>
        <label className="small" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={Boolean(s.autoConfirmKnown)} onChange={(e) => saveSettings({ autoConfirmKnown: e.target.checked })} style={{ marginTop: 3 }} />
          <span>
            <b>Conferma in automatico gli esercenti già noti.</b> I pagamenti di esercenti nuovi, senza categoria o possibili doppioni restano sempre da confermare.
          </span>
        </label>
        <span className="label-caps" style={{ marginTop: 4 }}>Regole tue</span>
        {(s.keywordRules ?? []).map((r) => (
          <div key={r.id} className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <span>contiene “{r.contains}” → <b>{data.catMap.get(r.categoryId)?.name ?? 'categoria eliminata'}</b></span>
            <button className="link" style={{ color: 'var(--danger)' }} onClick={() => saveSettings({ keywordRules: (s.keywordRules ?? []).filter((x) => x.id !== r.id) })}>Togli</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input aria-label="Testo contenuto nell'esercente" placeholder="es. amazon" value={contains} onChange={(e) => setContains(e.target.value)} style={{ flex: '1 1 120px', minWidth: 0 }} className="search" />
          <select aria-label="Categoria" value={cat} onChange={(e) => setCat(e.target.value)} style={{ flex: '1 1 140px', minWidth: 0 }}>
            <option value="">Categoria…</option>
            {expCats.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className="btn small" onClick={addRule} disabled={!contains.trim() || !cat}>Aggiungi</button>
        </div>
        {learned > 0 && (
          <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => window.confirm('Dimenticare le categorie imparate dagli esercenti? Le tue regole restano.') && saveSettings({ merchantRules: {} })}>
            Dimentica gli esercenti imparati
          </button>
        )}
      </div>

      <div className="card small" style={{ gap: 8 }}>
        <span className="card-title">Come impostare l’automazione (una volta sola)</span>
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>Apri <b>Comandi</b>. Con la freccia indietro torna alla <b>Libreria</b> e tocca <b>Automazioni</b>, poi il <b>+</b> in basso.</li>
          <li>Tocca il pulsante blu <b>Automazioni</b> sotto la ricerca e scegli <b>Wallet</b> (“Quando avvicino una carta…”; nelle versioni precedenti di iOS si chiama <b>Transazione</b>). Lascia “Qualsiasi carta” e <b>Automazione</b> attivo.</li>
          <li>Cerca e aggiungi <b>Formatta data</b>: data <b>Data attuale</b>, formato <b>ISO 8601</b>.</li>
          <li>Cerca e aggiungi <b>Testo</b> e scrivi <code style={{ wordBreak: 'break-all' }}>{LINE_TEMPLATE}</code>: dopo FP1| tocca <b>Seleziona variabile</b> e poi il blocco Formatta data; per gli altri campi tocca Seleziona variabile, poi il blocco “Quando…”, tocca il bollino <b>Transazione</b> e scegli <b>Importo</b>, poi <b>Esercente</b>, poi <b>Carta o biglietto</b>. Le barre “|” separano i campi.</li>
          <li>Cerca e aggiungi <b>Aggiungi a file di testo</b>: percorso <b>movimenti.txt</b>, <b>Crea nuova riga</b> attivo.</li>
          <li>Paga qualcosa con Apple Pay, poi importa qui il file: il pagamento deve comparire tra i “da confermare”.</li>
        </ol>
        <span className="tiny muted">L’automazione vede solo i pagamenti fatti con Apple Pay (iPhone o Watch). Bonifici, addebiti diretti e carta fisica vanno aggiunti a mano; per affitto e spese fisse usa “Ripeti in automatico” sul movimento.</span>
      </div>
    </div>
  );
}
