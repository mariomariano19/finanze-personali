import { useRef, useState } from 'react';
import { useData, saveSettings } from '../state/store';
import { useNav } from '../ui/nav';
import { Header, Empty, useToast } from '../ui/common';
import { Icon } from '../ui/Icon';
import { vault } from '../persistence/vault';
import { createBackup, openBackup, parseBackup, backupFileName, saveFile, transactionsCSV, type BackupFile } from '../persistence/backup';
import { formatEUR } from '../core/money';
import { dayLabel, today } from '../core/dates';
import { nowISO } from '../core/id';
import { FREQUENCY_LABEL, monthlyEquivalent, nextOccurrence } from '../ledger/recurring';
import { NATURE_LABEL, NEED_LABEL } from '../core/types';

function Row({ icon, title, sub, onClick }: { icon: string; title: string; sub?: string; onClick: () => void }) {
  return (
    <button className="row" onClick={onClick}>
      <span className="ic neutral"><Icon name={icon} size={18} color="var(--ink)" /></span>
      <span className="main">
        <span className="title">{title}</span>
        {sub && <span className="sub">{sub}</span>}
      </span>
      <Icon name="chevron" size={16} color="var(--muted)" />
    </button>
  );
}

export function Settings() {
  const data = useData();
  const nav = useNav();
  return (
    <div className="screen no-tab">
      <Header onBack={nav.pop} title="Impostazioni" />
      <div className="card tight">
        <Row icon="shield" title="Backup e ripristino" sub={data.settings.lastBackupAt ? `Ultimo backup: ${dayLabel(data.settings.lastBackupAt.slice(0, 10))}` : 'Nessun backup ancora'} onClick={() => nav.push({ name: 'backup' })} />
        <Row icon="lock" title="Sicurezza" sub={`PIN · blocco dopo ${data.settings.autoLockMinutes} min`} onClick={() => nav.push({ name: 'security' })} />
      </div>
      <div className="card tight">
        <Row icon="grid" title="Categorie di spesa" onClick={() => nav.push({ name: 'categories', kind: 'expense' })} />
        <Row icon="income" title="Categorie di ricavo" onClick={() => nav.push({ name: 'categories', kind: 'income' })} />
        <Row icon="repeat" title="Ricorrenze" sub={`${data.rules.filter((r) => r.active).length} attive`} onClick={() => nav.push({ name: 'recurring' })} />
        <Row icon="radar" title="Intelligence" sub={data.settings.intel?.key ? 'Collegata' : 'Non collegata'} onClick={() => nav.push({ name: 'intelSetup' })} />
        <Row icon="card" title="Conti e carte" sub={`${data.accs.filter((a) => !a.hidden).length} conti`} onClick={() => nav.push({ name: 'accounts' })} />
      </div>
      <div className="card">
        <div className="field" style={{ borderBottom: 0 }}>
          <label htmlFor="goal">Obiettivo di risparmio</label>
          <select id="goal" value={data.settings.savingsGoal} onChange={(e) => saveSettings({ savingsGoal: Number(e.target.value) })}>
            {[5, 10, 15, 20, 25, 30, 35, 40, 50].map((v) => <option key={v} value={v}>{v}%</option>)}
          </select>
        </div>
      </div>
      <p className="tiny muted" style={{ margin: '4px 4px 0', lineHeight: 1.5 }}>
        Versione 0.4 (Fase 3 e prima parte della tappa I1 degli investimenti). I dati restano solo su questo dispositivo, cifrati con il tuo PIN. Nessun dato viene inviato a server esterni.
      </p>
    </div>
  );
}

// ---------------- Backup ----------------
export function Backup() {
  const data = useData();
  const nav = useNav();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [backupPin, setBackupPin] = useState('');
  const [bErr, setBErr] = useState<string | null>(null);

  async function doBackup() {
    setBusy(true);
    setBErr(null);
    try {
      // il backup è cifrato con il PIN attuale: lo verifico per evitare file che poi non si aprono
      if (!(await vault.verifyPin(backupPin))) { setBErr('PIN errato.'); return; }
      const file = await createBackup(vault.dump(), backupPin);
      const res = await saveFile(backupFileName(), JSON.stringify(file), 'application/json');
      if (res !== 'cancelled') {
        saveSettings({ lastBackupAt: nowISO() });
        setBackupPin('');
        toast(res === 'shared' ? 'Backup pronto: scegli “Salva su File”' : 'Backup scaricato');
      }
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    try {
      setPending(parseBackup(await f.text()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'File non valido');
    }
  }

  async function restore() {
    if (!pending) return;
    setBusy(true);
    const dump = await openBackup(pending, pin);
    setBusy(false);
    if (!dump) { setError('PIN del backup errato.'); return; }
    if (!window.confirm(`Ripristinare il backup del ${new Date(pending.createdAt).toLocaleString('it-IT')}? Tutti i dati attuali saranno sostituiti.`)) return;
    await vault.replaceAll(dump);
    setPending(null);
    setPin('');
    toast('Backup ripristinato');
  }

  async function exportCSV() {
    if (!window.confirm('Il file CSV NON è cifrato: chiunque lo apra vede i tuoi movimenti. Continuare?')) return;
    await saveFile(`movimenti-${today()}.csv`, transactionsCSV(data.txs, data.cats, data.accs), 'text/csv');
  }

  return (
    <div className="screen no-tab">
      <Header onBack={nav.pop} title="Backup e ripristino" />
      <div className="notice warn">
        <Icon name="info" size={18} />
        <span>I dati sono solo su questo iPhone. Se elimini l’app dalla schermata Home o cambi telefono, si recuperano solo da un backup. Salvalo in iCloud Drive almeno una volta a settimana.</span>
      </div>
      <div className="card">
        <span className="card-title">Backup cifrato</span>
        <span className="small muted">
          Un file con tutti i dati, cifrato con il PIN. {data.settings.lastBackupAt ? `Ultimo: ${new Date(data.settings.lastBackupAt).toLocaleString('it-IT')}.` : 'Nessun backup ancora.'}
        </span>
        <div className="fields">
          <div className="field">
            <label htmlFor="bpin">PIN attuale</label>
            <input id="bpin" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={backupPin} onChange={(e) => setBackupPin(e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>
        <button className="btn" disabled={busy || backupPin.length < 4} onClick={doBackup}><Icon name="download" size={18} /> Crea backup</button>
        {bErr && <span className="small danger" role="alert">{bErr}</span>}
        <div className="field" style={{ borderBottom: 0 }}>
          <label htmlFor="remind">Promemoria ogni</label>
          <select id="remind" value={data.settings.backupReminderDays} onChange={(e) => saveSettings({ backupReminderDays: Number(e.target.value) })}>
            {[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} giorni</option>)}
          </select>
        </div>
      </div>
      <div className="card">
        <span className="card-title">Ripristina da backup</span>
        <span className="small muted">Sostituisce tutti i dati attuali con quelli del backup.</span>
        <input ref={fileRef} type="file" accept="application/json,.json" className="visually-hidden" onChange={onFile} aria-label="Scegli file di backup" />
        {!pending ? (
          <button className="btn secondary" onClick={() => fileRef.current?.click()}><Icon name="upload" size={18} /> Scegli file di backup</button>
        ) : (
          <>
            <span className="small">Backup del {new Date(pending.createdAt).toLocaleString('it-IT')} · {pending.counts.tx ?? 0} movimenti</span>
            <div className="fields">
              <div className="field">
                <label htmlFor="rpin">PIN del backup</label>
                <input id="rpin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
              </div>
            </div>
            <div className="btn-row">
              <button className="btn secondary" onClick={() => { setPending(null); setPin(''); }}>Annulla</button>
              <button className="btn" disabled={busy || pin.length < 4} onClick={restore}>Ripristina</button>
            </div>
          </>
        )}
        {error && <span className="small danger" role="alert">{error}</span>}
      </div>
      <div className="card">
        <span className="card-title">Esporta movimenti</span>
        <span className="small muted">CSV leggibile da Excel o Numeri. Non cifrato.</span>
        <button className="btn secondary" disabled={data.txs.length === 0} onClick={exportCSV}>Esporta CSV</button>
      </div>
    </div>
  );
}

// ---------------- Sicurezza ----------------
export function Security({ onLock }: { onLock: () => void }) {
  const data = useData();
  const nav = useNav();
  const toast = useToast();
  const [oldPin, setOld] = useState('');
  const [newPin, setNew] = useState('');
  const [newPin2, setNew2] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const valid = /^\d{6}$/.test(newPin) && newPin === newPin2 && oldPin.length >= 4;

  async function change() {
    const err = await vault.changePin(oldPin, newPin);
    if (err) { setMsg(err); return; }
    setOld(''); setNew(''); setNew2(''); setMsg(null);
    toast('PIN cambiato. I vecchi backup restano apribili con il vecchio PIN.');
  }

  async function wipe() {
    if (!window.confirm('Cancellare TUTTI i dati da questo dispositivo? Senza un backup non potrai recuperarli.')) return;
    if (window.prompt('Per confermare scrivi CANCELLA') !== 'CANCELLA') return;
    await vault.wipe();
    window.location.reload();
  }

  return (
    <div className="screen no-tab">
      <Header onBack={nav.pop} title="Sicurezza" />
      <div className="card">
        <div className="field" style={{ borderBottom: 0 }}>
          <label htmlFor="al">Blocco automatico dopo</label>
          <select id="al" value={data.settings.autoLockMinutes} onChange={(e) => saveSettings({ autoLockMinutes: Number(e.target.value) })}>
            {[1, 2, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
        <button className="btn secondary" onClick={onLock}><Icon name="lock" size={18} /> Blocca ora</button>
      </div>
      <div className="card">
        <span className="card-title">Cambia PIN</span>
        <div className="fields">
          <div className="field"><label htmlFor="op">PIN attuale</label><input id="op" type="password" inputMode="numeric" autoComplete="off" value={oldPin} onChange={(e) => setOld(e.target.value)} /></div>
          <div className="field"><label htmlFor="np">Nuovo PIN (6 cifre)</label><input id="np" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={newPin} onChange={(e) => setNew(e.target.value.replace(/\D/g, ''))} /></div>
          <div className="field"><label htmlFor="np2">Ripeti nuovo PIN</label><input id="np2" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={newPin2} onChange={(e) => setNew2(e.target.value.replace(/\D/g, ''))} /></div>
        </div>
        {msg && <span className="small danger" role="alert">{msg}</span>}
        <button className="btn" disabled={!valid} onClick={change}>Cambia PIN</button>
      </div>
      <div className="card">
        <span className="card-title">Zona pericolosa</span>
        <span className="small muted">Elimina definitivamente dati e PIN da questo dispositivo.</span>
        <button className="btn danger" onClick={wipe}><Icon name="trash" size={18} /> Cancella tutti i dati</button>
      </div>
    </div>
  );
}

// ---------------- Categorie ----------------
export function Categories({ kind }: { kind: 'income' | 'expense' }) {
  const data = useData();
  const nav = useNav();
  const macros = data.cats.filter((c) => c.kind === kind && !c.parentId);
  const used = new Map<string, number>();
  for (const t of data.txs) if (t.categoryId) used.set(t.categoryId, (used.get(t.categoryId) ?? 0) + 1);
  return (
    <div className="screen no-tab">
      <Header
        onBack={nav.pop}
        title={kind === 'expense' ? 'Categorie di spesa' : 'Categorie di ricavo'}
        actions={<button className="icon-btn" aria-label="Nuova categoria" onClick={() => nav.openSheet({ name: 'category', kind, parentId: null })}><Icon name="plus" /></button>}
      />
      <span className="small muted">Tocca una categoria per rinominarla, cambiarne la classificazione o nasconderla.</span>
      {macros.map((m) => {
        const subs = data.cats.filter((c) => c.parentId === m.id);
        return (
          <div className="card tight" key={m.id} style={{ opacity: m.hidden ? 0.55 : 1 }}>
            <button className="row" onClick={() => nav.openSheet({ name: 'category', id: m.id, kind })}>
              <span className={`ic ${kind === 'income' ? 'inc' : ''}`}><Icon name={m.icon} size={18} color={kind === 'income' ? 'var(--income)' : 'var(--expense)'} /></span>
              <span className="main">
                <span className="title">{m.name}{m.hidden ? ' (nascosta)' : ''}</span>
                <span className="sub">{NATURE_LABEL[m.nature]}{kind === 'expense' ? ` · ${NEED_LABEL[m.need]}` : ''}{subs.length ? ` · ${subs.length} sottocategorie` : ''}</span>
              </span>
              <Icon name="chevron" size={16} color="var(--muted)" />
            </button>
            {subs.map((s) => (
              <button key={s.id} className="row" style={{ paddingLeft: 48, minHeight: 48, opacity: s.hidden ? 0.55 : 1 }} onClick={() => nav.openSheet({ name: 'category', id: s.id, kind })}>
                <span className="main">
                  <span className="title" style={{ fontWeight: 500 }}>{s.name}{s.hidden ? ' (nascosta)' : ''}</span>
                  <span className="sub">{NATURE_LABEL[s.nature]} · {NEED_LABEL[s.need]}{used.get(s.id) ? ` · ${used.get(s.id)} mov.` : ''}</span>
                </span>
              </button>
            ))}
            {kind === 'expense' && (
              <button className="row" style={{ paddingLeft: 48, minHeight: 44 }} onClick={() => nav.openSheet({ name: 'category', kind, parentId: m.id })}>
                <span className="small muted">+ Aggiungi sottocategoria</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Ricorrenze ----------------
export function Recurring() {
  const data = useData();
  const nav = useNav();
  const rules = [...data.rules].sort((a, b) => Number(b.active) - Number(a.active) || b.amount - a.amount);
  const monthlyOut = data.rules.filter((r) => r.active && r.type === 'expense').reduce((s, r) => s + monthlyEquivalent(r), 0);
  const monthlyIn = data.rules.filter((r) => r.active && r.type === 'income').reduce((s, r) => s + monthlyEquivalent(r), 0);
  return (
    <div className="screen no-tab">
      <Header onBack={nav.pop} title="Ricorrenze" actions={<button className="icon-btn" aria-label="Nuova ricorrenza" onClick={() => nav.openSheet({ name: 'rule' })}><Icon name="plus" /></button>} />
      <span className="small muted">Stipendio, affitto, abbonamenti: l’app crea il movimento da sola alla scadenza.</span>
      <div className="kpis two">
        <div className="kpi"><span className="k">Ricavi ricorrenti</span><span className="v income num">{formatEUR(monthlyIn, { short: true })}</span><span className="d">al mese</span></div>
        <div className="kpi"><span className="k">Spese ricorrenti</span><span className="v expense num">{formatEUR(monthlyOut, { short: true })}</span><span className="d num">{formatEUR(monthlyOut * 12, { short: true })} all’anno</span></div>
      </div>
      {rules.length === 0 ? (
        <div className="card"><Empty action={<button className="btn small" onClick={() => nav.openSheet({ name: 'rule' })}>Aggiungi ricorrenza</button>}>Nessuna ricorrenza. Puoi crearne una anche dal campo “Ricorrenza” quando registri un movimento.</Empty></div>
      ) : (
        <div className="card tight">
          {rules.map((r) => {
            const next = r.active ? nextOccurrence(r, today()) : null;
            return (
              <button key={r.id} className="row" style={{ opacity: r.active ? 1 : 0.55 }} onClick={() => nav.openSheet({ name: 'rule', id: r.id })}>
                <span className={`ic ${r.type === 'income' ? 'inc' : ''}`}><Icon name="repeat" size={18} color={r.type === 'income' ? 'var(--income)' : 'var(--expense)'} /></span>
                <span className="main">
                  <span className="title">{r.description || (r.categoryId ? data.catMap.get(r.categoryId)?.name : '') || 'Ricorrenza'}</span>
                  <span className="sub">{FREQUENCY_LABEL[r.frequency]} · {r.active ? (next ? `prossima ${dayLabel(next)}` : 'terminata') : 'in pausa'}</span>
                </span>
                <span className={`amt num ${r.type === 'income' ? 'income' : ''}`}>{formatEUR(r.amount)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- Conti ----------------
export function Accounts() {
  const data = useData();
  const nav = useNav();
  const KIND = { checking: 'Conto corrente', card: 'Carta', cash: 'Contanti', savings: 'Conto deposito', other: 'Altro' } as const;
  return (
    <div className="screen no-tab">
      <Header onBack={nav.pop} title="Conti e carte" actions={<button className="icon-btn" aria-label="Nuovo conto" onClick={() => nav.openSheet({ name: 'account' })}><Icon name="plus" /></button>} />
      <span className="small muted">Servono a sapere da dove esce o dove entra il denaro, e per i giroconti.</span>
      <div className="card tight">
        {data.accs.map((a) => (
          <button key={a.id} className="row" style={{ opacity: a.hidden ? 0.55 : 1 }} onClick={() => nav.openSheet({ name: 'account', id: a.id })}>
            <span className="ic neutral"><Icon name={a.kind === 'cash' ? 'dots' : a.kind === 'card' ? 'card' : 'bank'} size={18} color="var(--ink)" /></span>
            <span className="main"><span className="title">{a.name}{a.hidden ? ' (nascosto)' : ''}</span><span className="sub">{KIND[a.kind]}</span></span>
            <Icon name="chevron" size={16} color="var(--muted)" />
          </button>
        ))}
      </div>
    </div>
  );
}
