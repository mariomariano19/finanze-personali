import { useState } from 'react';
import { useData, saveSettings } from '../state/store';
import { useNav } from '../ui/nav';
import { Header, useToast } from '../ui/common';
import { IntelClient, repoFromLocation } from '../intel/client';

export function IntelSetup() {
  const data = useData();
  const nav = useNav();
  const toast = useToast();
  const cur = data.settings.intel ?? {};
  const [key, setKey] = useState(cur.key ?? '');
  const [token, setToken] = useState(cur.token ?? '');
  const [repo, setRepo] = useState(cur.repo ?? repoFromLocation() ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function test() {
    setBusy(true);
    setResult(await new IntelClient({ key: key.trim(), token: token.trim() || undefined, repo: repo.trim() || undefined }).test());
    setBusy(false);
  }
  function save() {
    saveSettings({ intel: { key: key.trim(), token: token.trim() || undefined, repo: repo.trim() || undefined, branch: cur.branch } });
    toast('Collegamento salvato');
    nav.pop();
  }
  function disconnect() {
    if (!window.confirm('Scollegare l’Intelligence da questo dispositivo? La chiave e il token verranno cancellati dall’app.')) return;
    saveSettings({ intel: undefined });
    nav.pop();
  }

  return (
    <div className="screen no-tab">
      <Header onBack={nav.pop} title="Collegamento Intelligence" />
      <span className="small muted">
        Briefing, previsioni, watchlist e profilo sono pubblicati sul sito dell’app in file cifrati. Solo questa chiave li apre. Chiave e token restano nell’app, cifrati con il tuo PIN.
      </span>
      <div className="fields">
        <div className="field">
          <label htmlFor="ik">Chiave Intelligence</label>
          <input id="ik" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} value={key} placeholder="43 caratteri" onChange={(e) => setKey(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="it">Token GitHub</label>
          <input id="it" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} value={token} placeholder="per modificare watchlist e profilo" onChange={(e) => setToken(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ir">Deposito</label>
          <input id="ir" autoCapitalize="off" spellCheck={false} value={repo} placeholder="utente/finanze-personali" onChange={(e) => setRepo(e.target.value)} />
        </div>
      </div>
      <span className="tiny muted">
        Il token serve solo per salvare watchlist e profilo. Crealo su GitHub › Settings › Developer settings › Fine-grained tokens, con accesso al solo deposito dell’app e il permesso “Contents: Read and write”.
      </span>
      {result && (
        <div className={`notice ${result.ok ? 'info' : 'err'}`} role="status">
          {result.message}
        </div>
      )}
      <div className="btn-row">
        <button className="btn secondary" disabled={busy || !key.trim()} onClick={test}>{busy ? 'Verifica…' : 'Verifica'}</button>
        <button className="btn" disabled={!key.trim()} onClick={save}>Salva</button>
      </div>
      {cur.key && <button className="btn danger" onClick={disconnect}>Scollega</button>}
    </div>
  );
}
