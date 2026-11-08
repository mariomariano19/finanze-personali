// Prezzi automatici: l'app pubblica (cifrata) la sola lista degli strumenti, senza quantità né importi;
// il motore del mattino scrive le chiusure in euro con fonte; l'app le importa nello storico prezzi.
import { useEffect, useRef } from 'react';
import { vault } from '../persistence/vault';
import { saveSettings, useData } from '../state/store';
import type { AppData } from '../state/store';
import type { Holding, IntelCache, PricePoint } from '../core/types';
import { IntelClient } from './client';
import { canonical, sha256Hex } from './crypto';
import { nowISO } from '../core/id';

export const AUTO_CLASSES = ['stock', 'etf', 'bond', 'fund', 'pension'];

export interface TrackedItem {
  id: string;
  name: string;
  symbol?: string;
  isin?: string;
  exchange?: string;
  assetClass: string;
  fundLine?: string;
}

export interface RemotePoint {
  date: string;
  price: number; // euro per quota (per le obbligazioni può essere per 100 di nominale: unit "pct")
  source: string;
  url: string;
  unit?: string;
  native?: { price: number; currency: string };
  fx?: { rate: number; source: string; url: string };
  note?: string;
}

export interface RemotePrices {
  updatedAt?: string;
  items: Record<string, RemotePoint[]>;
  benchmark?: { name: string; proxy?: string; symbol?: string; isin?: string; points: RemotePoint[] };
}

export interface Rejected {
  holdingId: string;
  name: string;
  date: string;
  price: number; // centesimi proposti
  previous: number; // centesimi dell'ultimo prezzo noto
  source: string;
  url: string;
}

/** Stato locale dei prezzi automatici (nel vault, cifrato col PIN) */
export interface PriceState {
  syncedAt?: string;
  remoteUpdatedAt?: string;
  benchmark?: RemotePrices['benchmark'];
  sources?: Record<string, { source: string; url: string; date: string; native?: RemotePoint['native']; fx?: RemotePoint['fx'] }>;
  rejected?: Rejected[];
  /** prezzi sospetti già decisi (accettati o scartati), da non riproporre: "holdingId|data" */
  dismissed?: string[];
  error?: string;
}

export const getPriceState = (): PriceState => ((vault.get('intel', 'prices') as unknown as PriceState | undefined) ?? {});
const setPriceState = (s: PriceState) => vault.put('intel', { id: 'prices', ...s } as unknown as IntelCache);

export function buildTracked(holdings: Holding[]): TrackedItem[] {
  return holdings
    .filter((h) => !h.archived && AUTO_CLASSES.includes(h.assetClass))
    .map((h) => ({ id: h.id, name: h.name, symbol: h.symbol, isin: h.isin, exchange: h.exchange, assetClass: h.assetClass, fundLine: h.details?.fundLine }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Converte il prezzo remoto in centesimi per quota, gestendo le obbligazioni quotate per 100 di nominale */
export function toCents(h: Holding, p: RemotePoint, previous: number | null): number {
  let c = p.price * 100;
  if ((p.unit === 'pct' || h.assetClass === 'bond') && previous && previous > 0) {
    // scegli la scala più vicina all'ultimo prezzo noto (quota da 1 € o da 100 € di nominale)
    const cands = [c, c / 100, c * 100];
    c = cands.reduce((best, x) => (Math.abs(Math.log(x / previous)) < Math.abs(Math.log(best / previous)) ? x : best), c);
  }
  return Math.round(c * 10000) / 10000;
}

const lastKnown = (h: Holding, before: string): number | null => {
  let best: PricePoint | null = null;
  for (const p of vault.list('price')) if (p.holdingId === h.id && p.date < before && (!best || p.date > best.date)) best = p;
  if (best) return best.price;
  return h.price > 0 && h.priceDate < before ? h.price : null;
};

/** Variazione oltre la quale un prezzo automatico va confermato a mano (errore di strumento o di unità) */
const MAX_JUMP = 0.4;

export function applyPoint(h: Holding, date: string, cents: number) {
  vault.put('price', { id: `${h.id}-${date}`, holdingId: h.id, date, price: cents });
  const cur = vault.get('hold', h.id) ?? h;
  if (date >= cur.priceDate || cur.price <= 0) vault.put('hold', { ...cur, price: cents, priceDate: date, priceSource: 'api' });
}

/** Importa i prezzi remoti; i salti sospetti finiscono tra i "da confermare" */
export function importPrices(holdings: Holding[], remote: RemotePrices): { added: number; rejected: Rejected[] } {
  const state = getPriceState();
  const rejected: Rejected[] = [...(state.rejected ?? [])];
  const sources = { ...(state.sources ?? {}) };
  let added = 0;
  for (const h of holdings) {
    const pts = remote.items?.[h.id];
    if (!pts?.length || h.archived) continue;
    for (const p of [...pts].sort((a, b) => a.date.localeCompare(b.date))) {
      if (vault.get('price', `${h.id}-${p.date}`)) continue; // un prezzo di quel giorno c'è già (anche inserito a mano): non lo tocco
      if (rejected.some((r) => r.holdingId === h.id && r.date === p.date) || state.dismissed?.includes(`${h.id}|${p.date}`)) continue;
      const prev = lastKnown(h, p.date);
      const cents = toCents(h, p, prev);
      if (prev && prev > 0 && Math.abs(cents / prev - 1) > MAX_JUMP) {
        rejected.push({ holdingId: h.id, name: h.name, date: p.date, price: cents, previous: prev, source: p.source, url: p.url });
        continue;
      }
      applyPoint(h, p.date, cents);
      sources[h.id] = { source: p.source, url: p.url, date: p.date, native: p.native, fx: p.fx };
      added++;
    }
  }
  setPriceState({ ...state, rejected, sources, benchmark: remote.benchmark, remoteUpdatedAt: remote.updatedAt, syncedAt: nowISO(), error: undefined });
  return { added, rejected };
}

export function resolveRejected(r: Rejected, accept: boolean) {
  const state = getPriceState();
  if (accept) {
    const h = vault.get('hold', r.holdingId);
    if (h) applyPoint(h, r.date, r.price);
  }
  setPriceState({
    ...state,
    rejected: (state.rejected ?? []).filter((x) => !(x.holdingId === r.holdingId && x.date === r.date)),
    dismissed: [...(state.dismissed ?? []), `${r.holdingId}|${r.date}`]
  });
}

/** Pubblica la lista strumenti se è cambiata, poi importa i prezzi (al massimo ogni 30 minuti) */
export async function syncPrices(data: AppData, force = false): Promise<{ added: number } | null> {
  const cfg = data.settings.intel;
  if (!cfg?.key) return null;
  const client = new IntelClient({ key: cfg.key, token: cfg.token, repo: cfg.repo, branch: cfg.branch });
  const state = getPriceState();
  const tracked = buildTracked(data.holdings);
  const hash = await sha256Hex(canonical(tracked));
  try {
    if (client.canWrite && hash !== cfg.trackedHash) {
      await client.write('tracked', { items: tracked, updatedAt: nowISO() }, 'Lista strumenti aggiornata dall’app');
      saveSettings({ intel: { ...cfg, trackedHash: hash } });
    }
    const age = state.syncedAt ? Date.now() - Date.parse(state.syncedAt) : Infinity;
    if (!force && age < 30 * 60_000) return null;
    const remote = await client.read<RemotePrices>('prices');
    if (!remote) {
      setPriceState({ ...state, syncedAt: nowISO(), error: undefined });
      return { added: 0 };
    }
    const dismissed = new Set(state.dismissed ?? []);
    const filtered: RemotePrices = { ...remote, items: Object.fromEntries(Object.entries(remote.items ?? {}).map(([id, pts]) => [id, pts.filter((p) => !dismissed.has(`${id}|${p.date}`))])) };
    const r = importPrices(vault.list('hold'), filtered);
    return { added: r.added };
  } catch (e) {
    setPriceState({ ...getPriceState(), error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** All'avvio e quando cambiano gli strumenti: sincronizza in background */
export function usePriceSync() {
  const data = useData();
  const busy = useRef(false);
  const key = data.settings.intel?.key;
  const sig = data.holdings.map((h) => `${h.id}:${h.name}:${h.symbol ?? ''}:${h.isin ?? ''}:${h.archived ? 1 : 0}`).join('|');
  useEffect(() => {
    if (!key || busy.current) return;
    busy.current = true;
    syncPrices(data).finally(() => {
      busy.current = false;
    });
  }, [key, sig]); // eslint-disable-line react-hooks/exhaustive-deps
}
