import { STORE_NAMES, defaultTaxClass, type Broker, type StoreMap, type StoreName } from '../core/types';

// Migrazioni del modello dati. Ogni passo porta i dati da una versione alla successiva.
// Si applicano all'apertura dell'archivio e quando si ripristina un backup di una versione precedente.

export const CURRENT_DATA_VERSION = 2;

export type Dump = { [K in StoreName]: StoreMap[K][] };

export const DEFAULT_BROKER_ID = 'brk-principale';

/** v1 → v2: intermediari, classi fiscali, nuovi campi delle operazioni */
function v1to2(d: Dump): Dump {
  const brokers: Broker[] = [...(d.brk ?? [])];
  const needsBroker = d.op.some((o) => !o.brokerId);
  if (needsBroker && !brokers.some((b) => b.id === DEFAULT_BROKER_ID)) {
    brokers.push({ id: DEFAULT_BROKER_ID, name: 'Intermediario principale', kind: 'broker', country: 'IT', taxRegime: 'administered' });
  }
  return {
    ...d,
    brk: brokers,
    hold: d.hold.map((h) => ({ ...h, taxClass: h.taxClass ?? defaultTaxClass(h.assetClass), priceSource: h.priceSource ?? 'manual' })),
    op: d.op.map((o) => ({ ...o, brokerId: o.brokerId ?? DEFAULT_BROKER_ID, taxes: o.taxes ?? 0, source: o.source ?? 'manual' }))
  };
}

const STEPS: Record<number, (d: Dump) => Dump> = { 1: v1to2 };

/** Porta un archivio dalla versione `from` a quella attuale. Restituisce lo stesso oggetto se è già aggiornato. */
export function migrate(input: Partial<Dump>, from: number): Dump {
  let d = Object.fromEntries(STORE_NAMES.map((s) => [s, [...((input[s] as unknown[]) ?? [])]])) as unknown as Dump;
  for (let v = Math.max(1, from); v < CURRENT_DATA_VERSION; v++) {
    const step = STEPS[v];
    if (!step) throw new Error(`Migrazione mancante dalla versione ${v}`);
    d = step(d);
  }
  return d;
}
