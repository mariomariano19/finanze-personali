import { useEffect, useState } from 'react';
import { vault } from '../persistence/vault';
import { initialData } from '../persistence/seed';

type Mode = 'setup' | 'confirm' | 'unlock';
const PIN_LEN = 6;

export function Lock({ initialized, onUnlocked }: { initialized: boolean; onUnlocked: () => void }) {
  const [mode, setMode] = useState<Mode>(initialized ? 'unlock' : 'setup');
  const [pin, setPin] = useState('');
  const [first, setFirst] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const fail = (m: string) => {
    setMsg(m);
    setPin('');
    setShake(true);
    setTimeout(() => setShake(false), 400);
  };

  useEffect(() => {
    if (pin.length !== PIN_LEN || busy) return;
    (async () => {
      if (mode === 'setup') {
        setFirst(pin);
        setPin('');
        setMsg(null);
        setMode('confirm');
        return;
      }
      if (mode === 'confirm') {
        if (pin !== first) {
          setMode('setup');
          setFirst('');
          fail('I due PIN non coincidono. Riprova.');
          return;
        }
        setBusy(true);
        await vault.setup(pin, initialData());
        try {
          await navigator.storage?.persist?.();
        } catch {
          /* non supportato */
        }
        setBusy(false);
        onUnlocked();
        return;
      }
      setBusy(true);
      const err = await vault.unlock(pin);
      setBusy(false);
      if (err) fail(err);
      else onUnlocked();
    })();
  }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) setPin((p) => (p.length < PIN_LEN ? p + e.key : p));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const press = (d: string) => {
    if (busy) return;
    setMsg(null);
    setPin((p) => (p.length < PIN_LEN ? p + d : p));
  };

  const title = mode === 'unlock' ? 'Inserisci il PIN' : mode === 'setup' ? 'Crea un PIN di 6 cifre' : 'Conferma il PIN';
  const text =
    mode === 'unlock'
      ? 'I tuoi dati sono cifrati su questo dispositivo.'
      : mode === 'setup'
        ? 'Il PIN protegge e cifra i tuoi dati. Non è recuperabile: se lo dimentichi, i dati si recuperano solo da un backup.'
        : 'Inseriscilo di nuovo per sicurezza.';

  return (
    <main className="lock">
      <img className="logo" src="./icons/icon.svg" alt="" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      <div className={`dots ${shake ? 'shake' : ''}`} aria-label={`${pin.length} cifre inserite su ${PIN_LEN}`}>
        {Array.from({ length: PIN_LEN }, (_, i) => (
          <span key={i} className={i < pin.length ? 'on' : ''} />
        ))}
      </div>
      <p role="status" style={{ minHeight: 20, color: msg ? 'var(--danger)' : 'var(--muted)' }}>
        {busy ? 'Verifica…' : msg ?? ''}
      </p>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <span />
        <button type="button" onClick={() => press('0')}>
          0
        </button>
        <button type="button" className="ghost" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Cancella cifra">
          Cancella
        </button>
      </div>
      {mode !== 'unlock' && <p className="tiny">Hai un backup? Crea il PIN, poi vai in Impostazioni › Backup e ripristino.</p>}
    </main>
  );
}
