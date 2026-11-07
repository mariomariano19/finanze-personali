#!/usr/bin/env node
// Strumento del motore Intelligence (attività pianificata di Claude).
// Cifra e decifra i file in docs/intel/ con la chiave in INTEL_KEY (base64url, 32 byte)
// e aggiunge previsioni al registro calcolando la catena di impronte.
//
//   INTEL_KEY=... node tools/intel.mjs decrypt <file.enc.json>            → JSON in chiaro su stdout
//   INTEL_KEY=... node tools/intel.mjs encrypt <in.json> <out.enc.json>
//   INTEL_KEY=... node tools/intel.mjs add-predictions <nuove.json> [dir] → aggiunge al registro (docs/intel/predictions.enc.json)
//   INTEL_KEY=... node tools/intel.mjs publish-briefing <briefing.json> [dir] → scrive il briefing e aggiorna l'indice
//   INTEL_KEY=... node tools/intel.mjs verify [dir]                        → verifica la catena del registro
//   node tools/intel.mjs newkey                                              → genera una chiave nuova
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DIR = 'docs/intel';

function key() {
  const t = (process.env.INTEL_KEY || '').trim();
  const raw = Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (raw.length !== 32) throw new Error('INTEL_KEY mancante o non valida (servono 32 byte in base64url)');
  return raw;
}

export function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final(), c.getAuthTag()]);
  return { v: 1, alg: 'AES-256-GCM', iv: iv.toString('base64'), data: ct.toString('base64') };
}

export function decrypt(file) {
  const buf = Buffer.from(file.data, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(file.iv, 'base64'));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8'));
}

export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const readEnc = (f, fallback) => (fs.existsSync(f) ? decrypt(JSON.parse(fs.readFileSync(f, 'utf8'))) : fallback);
const writeEnc = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(encrypt(v)) + '\n');
};

function verify(preds) {
  let prev = 'GENESIS';
  const sorted = [...preds].sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const body = { ...p };
    delete body.hash;
    if (p.seq !== i + 1 || p.prevHash !== prev || sha(prev + '|' + canonical(body)) !== p.hash) return { ok: false, brokenAt: p.seq };
    prev = p.hash;
  }
  return { ok: true, count: sorted.length, last: prev };
}

const FIELDS = ['id', 'seq', 'createdAt', 'briefingDate', 'instrument', 'ticker', 'category', 'horizonLabel', 'horizonDays', 'neutralBandPct', 'refPrice', 'currency', 'refPriceSource', 'refPriceUrl', 'refPriceAsOf', 'probs', 'expectedReturnPct', 'rationale', 'sources', 'method'];

function addPredictions(newOnes, dir) {
  const file = path.join(dir, 'predictions.enc.json');
  const reg = readEnc(file, { predictions: [] });
  const check = verify(reg.predictions);
  if (!check.ok) throw new Error(`Registro già alterato alla voce ${check.brokenAt}: nessuna scrittura`);
  let prev = check.last ?? 'GENESIS';
  let seq = reg.predictions.length;
  const added = [];
  // idempotente: una previsione con stessa data del briefing, strumento e orizzonte non viene registrata due volte
  const sig = (p) => `${p.briefingDate}|${p.instrument}|${p.horizonLabel}`;
  const existing = new Map(reg.predictions.map((p) => [sig(p), p]));
  for (const raw of newOnes) {
    const dup = existing.get(sig(raw));
    if (dup) {
      added.push({ id: dup.id, seq: dup.seq, instrument: dup.instrument, duplicate: true });
      continue;
    }
    const s = raw.probs || {};
    const tot = (s.up || 0) + (s.neutral || 0) + (s.down || 0);
    if (Math.abs(tot - 1) > 0.011) throw new Error(`Probabilità che non sommano a 1 per ${raw.instrument}`);
    if (typeof raw.refPrice !== 'number' || !isFinite(raw.refPrice)) throw new Error(`refPrice mancante per ${raw.instrument}`);
    seq++;
    const p = {};
    for (const f of FIELDS) if (raw[f] !== undefined) p[f] = raw[f];
    p.seq = seq;
    p.id = 'p' + String(seq).padStart(6, '0');
    p.createdAt = p.createdAt || new Date().toISOString();
    p.prevHash = prev;
    p.hash = sha(prev + '|' + canonical(p));
    prev = p.hash;
    reg.predictions.push(p);
    added.push({ id: p.id, seq: p.seq, instrument: p.instrument });
  }
  reg.updatedAt = new Date().toISOString();
  writeEnc(file, reg);
  return added;
}

function publishBriefing(b, dir) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) throw new Error('Il briefing deve avere date YYYY-MM-DD');
  writeEnc(path.join(dir, 'briefings', `${b.date}.enc.json`), b);
  const idxFile = path.join(dir, 'index.enc.json');
  const idx = readEnc(idxFile, { briefings: [] });
  const set = new Set(idx.briefings.map((x) => x.date));
  if (!set.has(b.date)) idx.briefings.push({ date: b.date, headline: b.headline || '' });
  else idx.briefings = idx.briefings.map((x) => (x.date === b.date ? { date: b.date, headline: b.headline || x.headline } : x));
  idx.briefings.sort((a, c) => c.date.localeCompare(a.date));
  idx.latest = idx.briefings[0]?.date ?? null;
  idx.updatedAt = new Date().toISOString();
  writeEnc(idxFile, idx);
  return idx.latest;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === 'newkey') console.log(crypto.randomBytes(32).toString('base64url'));
    else if (cmd === 'decrypt') console.log(JSON.stringify(decrypt(JSON.parse(fs.readFileSync(a, 'utf8'))), null, 2));
    else if (cmd === 'encrypt') writeEnc(b, JSON.parse(fs.readFileSync(a, 'utf8')));
    else if (cmd === 'add-predictions') console.log(JSON.stringify(addPredictions(JSON.parse(fs.readFileSync(a, 'utf8')), b || DEFAULT_DIR)));
    else if (cmd === 'publish-briefing') console.log('Briefing pubblicato:', publishBriefing(JSON.parse(fs.readFileSync(a, 'utf8')), b || DEFAULT_DIR));
    else if (cmd === 'verify') console.log(JSON.stringify(verify(readEnc(path.join(a || DEFAULT_DIR, 'predictions.enc.json'), { predictions: [] }).predictions)));
    else {
      console.error('Comandi: newkey | decrypt | encrypt | add-predictions | publish-briefing | verify');
      process.exit(2);
    }
  } catch (e) {
    console.error('ERRORE:', e.message);
    process.exit(1);
  }
}
