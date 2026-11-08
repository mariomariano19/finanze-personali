import { decryptJSON, encryptJSON, importIntelKey, base64, type EncFile } from './crypto';

// Scambio dei file Intelligence con il deposito GitHub che ospita l'app.
// Lettura: dall'API di GitHub se c'è il token (sempre aggiornata), altrimenti dal sito stesso (./intel/…).
// Scrittura (solo watchlist e profilo): API di GitHub con il token.

export interface IntelConfig {
  key: string;
  token?: string;
  repo?: string; // "proprietario/nome"
  branch?: string;
}

export const INTEL_DIR = 'docs/intel';

export type IntelFile = 'index' | 'predictions' | 'outcomes' | 'watchlist' | 'profile' | 'dossiers' | 'tracked' | 'prices' | `briefings/${string}` | `dossiers/${string}`;

/** Deduce "proprietario/deposito" dall'indirizzo di GitHub Pages (proprietario.github.io/deposito/) */
export function repoFromLocation(loc: Location = window.location): string | null {
  const m = loc.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  if (!m) return null;
  const first = loc.pathname.split('/').filter(Boolean)[0];
  return first ? `${m[1]}/${first}` : `${m[1]}/${m[1]}.github.io`;
}

const GH = 'https://api.github.com';

export class IntelClient {
  private keyPromise: Promise<CryptoKey | null>;
  constructor(private cfg: IntelConfig) {
    this.keyPromise = importIntelKey(cfg.key);
  }

  get canWrite() {
    return Boolean(this.cfg.token && this.repo);
  }
  get repo() {
    return this.cfg.repo || repoFromLocation();
  }
  private get branch() {
    return this.cfg.branch || 'main';
  }

  private async key(): Promise<CryptoKey> {
    const k = await this.keyPromise;
    if (!k) throw new Error('La chiave Intelligence non è valida.');
    return k;
  }

  private ghHeaders(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.cfg.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...extra };
  }

  /** Legge e decifra un file; null se non esiste ancora */
  async read<T>(file: IntelFile): Promise<T | null> {
    const rel = `${file}.enc.json`;
    let res: Response;
    if (this.cfg.token && this.repo) {
      res = await fetch(`${GH}/repos/${this.repo}/contents/${INTEL_DIR}/${rel}?ref=${this.branch}`, {
        headers: this.ghHeaders({ Accept: 'application/vnd.github.raw+json' }),
        cache: 'no-store'
      });
    } else {
      res = await fetch(`./intel/${rel}?t=${Date.now()}`, { cache: 'no-store' });
    }
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) throw new Error('GitHub ha rifiutato l’accesso: controlla il token.');
    if (!res.ok) throw new Error(`Errore di rete (${res.status}).`);
    const enc = (await res.json()) as EncFile;
    try {
      return await decryptJSON<T>(await this.key(), enc);
    } catch {
      throw new Error('Impossibile decifrare i dati: la chiave Intelligence non corrisponde.');
    }
  }

  /** Cifra e salva watchlist o profilo nel deposito (un commit) */
  async write(file: 'watchlist' | 'profile' | 'tracked', value: unknown, message: string): Promise<void> {
    if (!this.canWrite) throw new Error('Per modificare serve il token GitHub (Impostazioni › Intelligence).');
    const url = `${GH}/repos/${this.repo}/contents/${INTEL_DIR}/${file}.enc.json`;
    const cur = await fetch(`${url}?ref=${this.branch}`, { headers: this.ghHeaders({ Accept: 'application/vnd.github+json' }), cache: 'no-store' });
    const sha = cur.ok ? ((await cur.json()) as { sha: string }).sha : undefined;
    if (!cur.ok && cur.status !== 404) throw new Error(`GitHub non risponde (${cur.status}).`);
    const enc = await encryptJSON(await this.key(), value);
    const content = base64.enc(new TextEncoder().encode(JSON.stringify(enc) + '\n'));
    const res = await fetch(url, {
      method: 'PUT',
      headers: this.ghHeaders({ Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message, content, branch: this.branch, ...(sha ? { sha } : {}) })
    });
    if (res.status === 409 || res.status === 422) throw new Error('Il file è cambiato nel frattempo: aggiorna e riprova.');
    if (!res.ok) throw new Error(`Salvataggio non riuscito (${res.status}).`);
  }

  /** Controllo del collegamento: chiave valida, file leggibili, token con permesso di scrittura */
  async test(): Promise<{ ok: boolean; message: string }> {
    if (!(await this.keyPromise)) return { ok: false, message: 'La chiave non è valida: deve essere di 43 caratteri.' };
    try {
      const idx = await this.read<{ latest?: string }>('index');
      if (this.cfg.token) {
        const r = await fetch(`${GH}/repos/${this.repo}`, { headers: this.ghHeaders({ Accept: 'application/vnd.github+json' }) });
        if (!r.ok) return { ok: false, message: `Il token non può accedere a ${this.repo} (${r.status}).` };
        const j = (await r.json()) as { permissions?: { push?: boolean } };
        if (j.permissions && !j.permissions.push) return { ok: false, message: 'Il token può leggere ma non scrivere: abilita “Contents: Read and write”.' };
      }
      return { ok: true, message: idx?.latest ? `Collegato. Ultimo briefing: ${idx.latest}.` : 'Collegato. Nessun briefing ancora pubblicato.' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
}
