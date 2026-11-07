import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { vault } from '../persistence/vault';
import { useData } from '../state/store';
import { IntelClient } from './client';
import { verifyChain, type ChainResult } from './crypto';
import type { Briefing, IntelIndex, InvestorProfile, Outcome, Prediction, WatchItem } from './model';
import type { IntelCache } from '../core/types';
import { nowISO } from '../core/id';

interface Cache {
  fetchedAt: string;
  index: IntelIndex | null;
  briefings: Record<string, Briefing>;
  predictions: Prediction[];
  outcomes: Outcome[];
  watchlist: WatchItem[];
  profile: InvestorProfile | null;
}

const EMPTY: Cache = { fetchedAt: '', index: null, briefings: {}, predictions: [], outcomes: [], watchlist: [], profile: null };

function saveCache(c: Cache) {
  vault.put('intel', { id: 'cache', ...c } as unknown as IntelCache);
}

/** Dati Intelligence: copia locale cifrata nel vault, aggiornata dal deposito quando c'è rete */
export function useIntel() {
  const data = useData();
  const cfg = data.settings.intel;
  const configured = Boolean(cfg?.key);
  const client = useMemo(() => (cfg?.key ? new IntelClient({ key: cfg.key, token: cfg.token, repo: cfg.repo, branch: cfg.branch }) : null), [cfg?.key, cfg?.token, cfg?.repo, cfg?.branch]);
  const cache = ((vault.get('intel', 'cache') as unknown as Cache | undefined) ?? EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<ChainResult>({ ok: true, checked: 0, brokenAt: null });
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!client || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const [index, reg, out, wl, profile] = await Promise.all([
        client.read<IntelIndex>('index'),
        client.read<{ predictions: Prediction[] }>('predictions'),
        client.read<{ outcomes: Outcome[] }>('outcomes'),
        client.read<{ items: WatchItem[] }>('watchlist'),
        client.read<InvestorProfile>('profile')
      ]);
      const cur = ((vault.get('intel', 'cache') as unknown as Cache | undefined) ?? EMPTY);
      const briefings = { ...cur.briefings };
      if (index?.latest && !briefings[index.latest]) {
        const b = await client.read<Briefing>(`briefings/${index.latest}`);
        if (b) briefings[index.latest] = b;
      }
      saveCache({ fetchedAt: nowISO(), index, briefings, predictions: reg?.predictions ?? [], outcomes: out?.outcomes ?? [], watchlist: wl?.items ?? [], profile });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [client]);

  const loadBriefing = useCallback(
    async (date: string) => {
      const cur = ((vault.get('intel', 'cache') as unknown as Cache | undefined) ?? EMPTY);
      if (cur.briefings[date] || !client) return;
      try {
        const b = await client.read<Briefing>(`briefings/${date}`);
        if (b) saveCache({ ...cur, briefings: { ...cur.briefings, [date]: b } });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [client]
  );

  const saveWatchlist = useCallback(
    async (items: WatchItem[], msg: string) => {
      if (!client) throw new Error('Intelligence non collegata.');
      await client.write('watchlist', { items, updatedAt: nowISO() }, msg);
      const cur = ((vault.get('intel', 'cache') as unknown as Cache | undefined) ?? EMPTY);
      saveCache({ ...cur, watchlist: items });
    },
    [client]
  );

  const saveProfile = useCallback(
    async (p: InvestorProfile) => {
      if (!client) throw new Error('Intelligence non collegata.');
      const profile = { ...p, updatedAt: nowISO() };
      await client.write('profile', profile, 'Profilo d’investitore aggiornato dall’app');
      const cur = ((vault.get('intel', 'cache') as unknown as Cache | undefined) ?? EMPTY);
      saveCache({ ...cur, profile });
    },
    [client]
  );

  // all'apertura della scheda: aggiorna se la copia locale ha più di 5 minuti
  useEffect(() => {
    if (!client) return;
    const age = cache.fetchedAt ? Date.now() - Date.parse(cache.fetchedAt) : Infinity;
    if (age > 5 * 60_000) refresh();
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    verifyChain(cache.predictions).then((r) => alive && setChain(r));
    return () => {
      alive = false;
    };
  }, [cache.predictions]);

  return { configured, canWrite: Boolean(client?.canWrite), client, cache, loading, error, chain, refresh, loadBriefing, saveWatchlist, saveProfile };
}
