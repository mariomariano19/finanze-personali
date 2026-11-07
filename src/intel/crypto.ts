// Formato cifrato condiviso tra l'app e il motore (attività pianificata di Claude).
// AES-256-GCM, chiave casuale di 32 byte in base64url, tag di autenticazione accodato al testo cifrato
// (come Web Crypto). Lo stesso formato è implementato in tools/intel.mjs per il motore.

export interface EncFile {
  v: 1;
  alg: 'AES-256-GCM';
  iv: string; // base64
  data: string; // base64 (ciphertext || tag)
}

const b64 = {
  enc(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec(s: string): Uint8Array {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
};

/** Chiave in base64url (43 caratteri) → CryptoKey; null se il formato non è valido */
export async function importIntelKey(text: string): Promise<CryptoKey | null> {
  const clean = text.trim().replace(/-/g, '+').replace(/_/g, '/');
  let raw: Uint8Array;
  try {
    raw = b64.dec(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  } catch {
    return null;
  }
  if (raw.length !== 32) return null;
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptJSON(key: CryptoKey, value: unknown): Promise<EncFile> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { v: 1, alg: 'AES-256-GCM', iv: b64.enc(iv), data: b64.enc(new Uint8Array(data)) };
}

export async function decryptJSON<T = unknown>(key: CryptoKey, file: EncFile): Promise<T> {
  if (!file || file.v !== 1 || !file.iv || !file.data) throw new Error('File cifrato non valido');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(file.iv) as BufferSource }, key, b64.dec(file.data) as BufferSource);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

export const base64 = b64;

// ---------- catena di impronte del registro delle previsioni ----------
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ChainResult {
  ok: boolean;
  checked: number;
  brokenAt: number | null;
}

/** Verifica che nessuna previsione sia stata modificata, cancellata o riordinata */
export async function verifyChain(preds: { seq: number; prevHash: string; hash: string }[]): Promise<ChainResult> {
  const sorted = [...preds].sort((a, b) => a.seq - b.seq);
  let prev = 'GENESIS';
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const body: Record<string, unknown> = { ...p };
    delete body.hash;
    if (p.seq !== i + 1 || p.prevHash !== prev) return { ok: false, checked: i, brokenAt: p.seq ?? i + 1 };
    if ((await sha256Hex(prev + '|' + canonical(body))) !== p.hash) return { ok: false, checked: i, brokenAt: p.seq };
    prev = p.hash;
  }
  return { ok: true, checked: sorted.length, brokenAt: null };
}
