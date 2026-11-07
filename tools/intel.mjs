#!/usr/bin/env node
// Strumento del motore Intelligence (attività pianificata di Claude).
// Cifra e decifra i file in docs/intel/ con la chiave in INTEL_KEY (base64url, 32 byte)
// e aggiunge previsioni al registro calcolando la catena di impronte.
//
//   INTEL_KEY=... node tools/intel.mjs decrypt <file.enc.json>            → JSON in chiaro su stdout
//   INTEL_KEY=... node tools/intel.mjs encrypt <in.json> <out.enc.json>
//   INTEL_KEY=... node tools/intel.mjs add-predictions <nuove.json> [dir] → aggiunge al registro (docs/intel/predictions.enc.json)
//   INTEL_KEY=... node tools/intel.mjs publish-briefing <briefing.json> [dir] → scrive il briefing e aggiorna l'indice
//   INTEL_KEY=... node tools/intel.mjs verify [dir]                        → verifica le catene di previsioni ed esiti
//   INTEL_KEY=... node tools/intel.mjs due [dir]                           → previsioni scadute ancora da verificare
//   INTEL_KEY=... node tools/intel.mjs add-outcomes <esiti.json> [dir]     → registra gli esiti (calcolo fatto qui, non dall'IA)
//   INTEL_KEY=... node tools/intel.mjs chain-outcomes [dir]                → una tantum: lega con impronte gli esiti già presenti
//   INTEL_KEY=... node tools/intel.mjs dossier-plan [n] [dir]              → quali schede aziendali rifare stasera
//   INTEL_KEY=... node tools/intel.mjs dossier-get <id> [dir]              → scheda in chiaro su stdout ({} se manca)
//   INTEL_KEY=... node tools/intel.mjs dossier-put <scheda.json> [dir]     → pubblica una scheda e aggiorna l'indice
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

function verify(items) {
  let prev = 'GENESIS';
  const sorted = [...items].sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const body = { ...p };
    delete body.hash;
    if (p.seq !== i + 1 || p.prevHash !== prev || sha(prev + '|' + canonical(body)) !== p.hash) return { ok: false, brokenAt: p.seq ?? i + 1 };
    prev = p.hash;
  }
  return { ok: true, count: sorted.length, last: prev };
}

function verifyAll(dir) {
  const preds = readEnc(path.join(dir, 'predictions.enc.json'), { predictions: [] }).predictions;
  const outs = readEnc(path.join(dir, 'outcomes.enc.json'), { outcomes: [] }).outcomes;
  const p = verify(preds);
  const o = verify(outs);
  return { ok: p.ok && o.ok, count: p.count, last: p.last, brokenAt: p.brokenAt, outcomes: o };
}

// ---------- date ----------
const romeToday = () => process.env.INTEL_TODAY || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
const dateOf = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export const refDateOf = (p) => dateOf(p.refPriceAsOf) || dateOf(p.briefingDate) || dateOf(p.createdAt);
export const expiryOf = (p) => addDays(refDateOf(p), p.horizonDays || 0);
const isHttps = (u) => typeof u === 'string' && /^https:\/\//i.test(u);

const CLASSES = ['up', 'neutral', 'down'];
const topClass = (probs) => [...CLASSES].sort((a, b) => (probs[b] || 0) - (probs[a] || 0))[0];
const brier = (probs, r) => CLASSES.reduce((s, c) => s + Math.pow((probs[c] || 0) - (c === r ? 1 : 0), 2), 0);
const r4 = (n) => Math.round(n * 10000) / 10000;
const MISSING_PRICE_GRACE_DAYS = 7; // ~5 giorni di borsa

function due(dir) {
  const preds = readEnc(path.join(dir, 'predictions.enc.json'), { predictions: [] }).predictions;
  const outs = readEnc(path.join(dir, 'outcomes.enc.json'), { outcomes: [] }).outcomes;
  const done = new Set(outs.map((o) => o.predictionId));
  const today = romeToday();
  return preds
    .filter((p) => !done.has(p.id) && expiryOf(p) < today)
    .map((p) => ({
      predictionId: p.id,
      seq: p.seq,
      instrument: p.instrument,
      ticker: p.ticker,
      category: p.category,
      refPrice: p.refPrice,
      currency: p.currency,
      refDate: refDateOf(p),
      expiryDate: expiryOf(p),
      daysOverdue: daysBetween(expiryOf(p), today),
      canBeInconclusive: daysBetween(expiryOf(p), today) >= MISSING_PRICE_GRACE_DAYS,
      requirement: `Ultima chiusura disponibile tra ${[addDays(expiryOf(p), -7), addDays(refDateOf(p), 1)].sort()[1]} e ${expiryOf(p)} (inclusi); dividendi con data di stacco tra ${addDays(refDateOf(p), 1)} e ${expiryOf(p)}`
    }));
}

function chainOutcomes(dir) {
  const file = path.join(dir, 'outcomes.enc.json');
  const reg = readEnc(file, { outcomes: [] });
  if (reg.outcomes.some((o) => o.hash)) throw new Error('Gli esiti sono già legati da impronte');
  let prev = 'GENESIS';
  reg.outcomes = reg.outcomes.map((o, i) => {
    const x = { ...o, seq: i + 1, prevHash: prev };
    x.hash = sha(prev + '|' + canonical(x));
    prev = x.hash;
    return x;
  });
  reg.updatedAt = new Date().toISOString();
  writeEnc(file, reg);
  return verify(reg.outcomes);
}

export function computeOutcome(p, raw, today = romeToday()) {
  const refDate = refDateOf(p);
  const expiry = expiryOf(p);
  if (!(expiry < today)) throw new Error(`${p.id}: non ancora scaduta (scadenza ${expiry})`);
  const base = { predictionId: p.id, checkedAt: new Date().toISOString(), expiryDate: expiry, rule: 'v1: ultima chiusura alla scadenza, rendimento totale (prezzo + dividendi staccati nel periodo)' };
  if (raw.inconclusive) {
    if (!raw.reason) throw new Error(`${p.id}: un esito non verificabile richiede il motivo`);
    if (daysBetween(expiry, today) < MISSING_PRICE_GRACE_DAYS) throw new Error(`${p.id}: si può dichiarare non verificabile solo dal ${addDays(expiry, MISSING_PRICE_GRACE_DAYS)}`);
    return { ...base, result: 'inconclusive', note: String(raw.reason) };
  }
  const fp = raw.finalPrice;
  if (typeof fp !== 'number' || !isFinite(fp) || fp <= 0) throw new Error(`${p.id}: finalPrice mancante o non valido`);
  const fd = dateOf(raw.finalPriceAsOf);
  if (!fd || fd > expiry || fd < addDays(expiry, -7) || fd <= refDate) throw new Error(`${p.id}: la data del prezzo finale (${raw.finalPriceAsOf}) deve essere l'ultima chiusura entro la scadenza ${expiry}`);
  if (!raw.finalPriceSource || !isHttps(raw.finalPriceUrl)) throw new Error(`${p.id}: servono fonte e url https del prezzo finale`);
  if (typeof raw.dividendsChecked !== 'boolean') throw new Error(`${p.id}: indica dividendsChecked (true se hai controllato i dividendi)`);
  const dividends = (raw.dividends || []).map((d) => {
    const ex = dateOf(d.exDate);
    if (!ex || ex <= refDate || ex > expiry) throw new Error(`${p.id}: dividendo con data di stacco ${d.exDate} fuori dal periodo ${refDate} → ${expiry}`);
    if (typeof d.amount !== 'number' || !(d.amount > 0)) throw new Error(`${p.id}: importo del dividendo non valido`);
    if (!isHttps(d.url)) throw new Error(`${p.id}: serve l'url https della fonte del dividendo`);
    return { exDate: ex, amount: d.amount, source: d.source || '', url: d.url };
  });
  const divSum = dividends.reduce((s, d) => s + d.amount, 0);
  const priceReturnPct = r4((fp / p.refPrice - 1) * 100);
  const totalReturnPct = r4(((fp + divSum) / p.refPrice - 1) * 100);
  const band = p.neutralBandPct ?? 0;
  const realized = totalReturnPct > band ? 'up' : totalReturnPct < -band ? 'down' : 'neutral';
  const notes = [];
  if (raw.basisNote) notes.push(String(raw.basisNote));
  if (!raw.dividendsChecked) notes.push('Dividendi non verificati: esito calcolato sul solo prezzo.');
  return {
    ...base,
    finalPrice: fp,
    finalPriceAsOf: raw.finalPriceAsOf,
    finalPriceSource: raw.finalPriceSource,
    finalPriceUrl: raw.finalPriceUrl,
    dividends,
    dividendsChecked: raw.dividendsChecked,
    priceReturnPct,
    totalReturnPct,
    actualReturnPct: totalReturnPct,
    realized,
    result: topClass(p.probs) === realized ? 'correct' : 'wrong',
    brier: r4(brier(p.probs, realized)),
    ...(notes.length ? { note: notes.join(' ') } : {})
  };
}

function addOutcomes(list, dir) {
  const v = verifyAll(dir);
  if (!v.ok) throw new Error('Registro o esiti alterati: nessuna scrittura');
  const preds = readEnc(path.join(dir, 'predictions.enc.json'), { predictions: [] }).predictions;
  const file = path.join(dir, 'outcomes.enc.json');
  const reg = readEnc(file, { outcomes: [] });
  const byId = new Map(preds.map((p) => [p.id, p]));
  const done = new Set(reg.outcomes.map((o) => o.predictionId));
  let prev = v.outcomes.last ?? 'GENESIS';
  const res = [];
  for (const raw of list) {
    const p = byId.get(raw.predictionId);
    if (!p) throw new Error(`Previsione ${raw.predictionId} inesistente`);
    if (done.has(p.id)) {
      res.push({ predictionId: p.id, skipped: 'esito già registrato' });
      continue;
    }
    const o = computeOutcome(p, raw);
    o.seq = reg.outcomes.length + 1;
    o.prevHash = prev;
    o.hash = sha(prev + '|' + canonical(o));
    prev = o.hash;
    reg.outcomes.push(o);
    done.add(p.id);
    res.push({ predictionId: p.id, seq: p.seq, instrument: p.instrument, result: o.result, realized: o.realized, totalReturnPct: o.totalReturnPct, priceReturnPct: o.priceReturnPct, brier: o.brier });
  }
  reg.updatedAt = new Date().toISOString();
  writeEnc(file, reg);
  return res;
}

// ---------- schede aziendali ----------
function readWatch(dir) {
  return readEnc(path.join(dir, 'watchlist.enc.json'), { items: [] }).items;
}

function dossierPlan(n, dir) {
  const items = readWatch(dir);
  const idx = readEnc(path.join(dir, 'dossiers.enc.json'), { items: {} });
  const NOT_COMPANY = new Set(['Indici', 'Titoli di Stato', 'ETF', 'Materie prime']);
  const rows = items.filter((w) => !NOT_COMPANY.has(w.category)).map((w) => ({ id: w.id, name: w.name, ticker: w.ticker, category: w.category, region: w.region, updatedAt: idx.items[w.id]?.updatedAt ?? null, fullReviewAt: idx.items[w.id]?.fullReviewAt ?? null }));
  const order = [...rows].sort((a, b) => (a.fullReviewAt ?? '').localeCompare(b.fullReviewAt ?? '') || a.name.localeCompare(b.name));
  return { fullReview: order.slice(0, n).map((r) => r.id), items: rows };
}

function collectUrls(v, out = []) {
  if (Array.isArray(v)) v.forEach((x) => collectUrls(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (k === 'url' ? out.push(x) : collectUrls(x, out));
  return out;
}

function dossierPut(d, dir) {
  const items = readWatch(dir);
  const w = items.find((x) => x.id === d.itemId);
  if (!w) throw new Error(`itemId ${d.itemId} non è nella watchlist`);
  if (!Array.isArray(d.sections)) throw new Error('La scheda deve avere sections (array)');
  const bad = collectUrls(d).filter((u) => u !== undefined && u !== null && u !== '' && !isHttps(u));
  if (bad.length) throw new Error('Url non https nella scheda: ' + bad.slice(0, 3).join(', '));
  const now = new Date().toISOString();
  const out = { ...d, name: d.name || w.name, ticker: d.ticker ?? w.ticker, updatedAt: now };
  if (d.fullReview) out.fullReviewAt = now;
  delete out.fullReview;
  const idxFile = path.join(dir, 'dossiers.enc.json');
  const idx = readEnc(idxFile, { items: {} });
  if (!d.fullReview) out.fullReviewAt = d.fullReviewAt || idx.items[w.id]?.fullReviewAt || null;
  writeEnc(path.join(dir, 'dossiers', `${w.id}.enc.json`), out);
  idx.items[w.id] = { name: out.name, updatedAt: now, fullReviewAt: out.fullReviewAt, summary: (out.summary || '').slice(0, 200) };
  idx.updatedAt = now;
  writeEnc(idxFile, idx);
  return { id: w.id, name: out.name, updatedAt: now, fullReviewAt: out.fullReviewAt };
}

const FIELDS = ['id', 'seq', 'createdAt', 'briefingDate', 'instrument', 'ticker', 'category', 'horizonLabel', 'horizonDays', 'neutralBandPct', 'refPrice', 'currency', 'refPriceSource', 'refPriceUrl', 'refPriceAsOf', 'probs', 'expectedReturnPct', 'rationale', 'sources', 'method'];

function addPredictions(newOnes, dir) {
  const file = path.join(dir, 'predictions.enc.json');
  const reg = readEnc(file, { predictions: [] });
  const check = verify(reg.predictions);
  if (!check.ok) throw new Error(`Registro già alterato alla voce ${check.brokenAt}: nessuna scrittura`);
  const horizons = { '1 settimana': [7, 1.5], '1 mese': [30, 3], '3-6 mesi': [120, 6], 'Lungo periodo': [365, 10] };
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
    const h = horizons[raw.horizonLabel];
    if (!h || raw.horizonDays !== h[0] || raw.neutralBandPct !== h[1]) throw new Error(`Orizzonte non ammesso per ${raw.instrument}: usa ${Object.entries(horizons).map(([k, v]) => `${k} (${v[0]} giorni, ±${v[1]}%)`).join(', ')}`);
    if (!dateOf(raw.refPriceAsOf)) throw new Error(`refPriceAsOf mancante per ${raw.instrument}`);
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
    else if (cmd === 'verify') console.log(JSON.stringify(verifyAll(a || DEFAULT_DIR)));
    else if (cmd === 'due') console.log(JSON.stringify(due(a || DEFAULT_DIR), null, 2));
    else if (cmd === 'add-outcomes') console.log(JSON.stringify(addOutcomes(JSON.parse(fs.readFileSync(a, 'utf8')), b || DEFAULT_DIR), null, 2));
    else if (cmd === 'chain-outcomes') console.log(JSON.stringify(chainOutcomes(a || DEFAULT_DIR)));
    else if (cmd === 'dossier-plan') console.log(JSON.stringify(dossierPlan(Number(a) || 7, b || DEFAULT_DIR), null, 2));
    else if (cmd === 'dossier-get') {
      const f = path.join(b || DEFAULT_DIR, 'dossiers', `${a}.enc.json`);
      console.log(JSON.stringify(readEnc(f, {}), null, 2));
    } else if (cmd === 'dossier-put') console.log(JSON.stringify(dossierPut(JSON.parse(fs.readFileSync(a, 'utf8')), b || DEFAULT_DIR)));
    else {
      console.error('Comandi: newkey | decrypt | encrypt | add-predictions | publish-briefing | verify | due | add-outcomes | chain-outcomes | dossier-plan | dossier-get | dossier-put');
      process.exit(2);
    }
  } catch (e) {
    console.error('ERRORE:', e.message);
    process.exit(1);
  }
}
