// Cifratura dei dati a riposo con Web Crypto: chiave AES-GCM 256 derivata dal PIN con PBKDF2-SHA256.
// La chiave non è estraibile e vive solo in memoria finché l'app è sbloccata.

export const PBKDF2_ITERATIONS = 310_000;
const VERIFIER_TEXT = 'finanze-personali:ok';

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export async function deriveKey(pin: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface Sealed {
  iv: Uint8Array;
  data: ArrayBuffer;
}

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = randomBytes(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(JSON.stringify(value)));
  return { iv, data };
}

export async function open<T = unknown>(key: CryptoKey, sealed: Sealed): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv as BufferSource }, key, sealed.data);
  return JSON.parse(dec.decode(plain)) as T;
}

export async function makeVerifier(key: CryptoKey): Promise<Sealed> {
  return seal(key, VERIFIER_TEXT);
}

/** true se la chiave (cioè il PIN) è corretta */
export async function checkVerifier(key: CryptoKey, v: Sealed): Promise<boolean> {
  try {
    return (await open<string>(key, v)) === VERIFIER_TEXT;
  } catch {
    return false;
  }
}

export function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
