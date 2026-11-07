import type { AssetClass, Holding, InvestmentOp, PricePoint } from '../core/types';
import { monthEnd } from '../core/dates';

export interface Position {
  holding: Holding;
  quantity: number;
  costBasis: number; // capitale investito ancora in portafoglio (costo medio), centesimi
  value: number; // valore attuale, centesimi
  pnl: number; // guadagno/perdita non realizzato (valore − capitale investito)
  pnlPct: number | null;
  realized: number; // risultato delle vendite (al netto delle commissioni, al lordo delle tasse)
  income: number; // dividendi e cedole lordi
  costs: number; // costi e commissioni non legati a compravendite
  taxes: number; // tasse trattenute (vendite, dividendi, imposte)
  totalReturn: number; // risultato complessivo: non realizzato + realizzato + proventi − costi − tasse
}

const EPS = 1e-9;

/** Stato di una posizione fino alla data indicata, con il metodo del costo medio ponderato */
export function positionAt(ops: InvestmentOp[], upTo?: string) {
  let quantity = 0;
  let costBasis = 0;
  let realized = 0;
  let income = 0;
  let costs = 0;
  let taxes = 0;
  const sorted = [...ops].filter((o) => !upTo || o.date <= upTo).sort((a, b) => a.date.localeCompare(b.date));
  for (const o of sorted) {
    taxes += o.taxes ?? 0;
    if (o.kind === 'buy') {
      quantity += o.quantity;
      costBasis += o.amount + o.fees;
    } else if (o.kind === 'sell') {
      const avg = quantity > EPS ? costBasis / quantity : 0;
      const sold = Math.min(o.quantity, quantity);
      const cost = avg * sold;
      realized += o.amount - o.fees - cost;
      quantity -= sold;
      costBasis -= cost;
      if (quantity < EPS) {
        quantity = 0;
        costBasis = 0;
      }
    } else if (o.kind === 'split') {
      // il frazionamento cambia le quote, non il capitale investito
      quantity = Math.max(0, quantity + o.quantity);
    } else if (o.kind === 'dividend' || o.kind === 'coupon') {
      income += o.amount;
      costs += o.fees;
    } else if (o.kind === 'fee') {
      costs += o.amount + o.fees;
    } else if (o.kind === 'tax') {
      taxes += o.amount;
    }
  }
  return {
    quantity,
    costBasis: Math.round(costBasis),
    realized: Math.round(realized),
    income: Math.round(income),
    costs: Math.round(costs),
    taxes: Math.round(taxes)
  };
}

/** Posizioni per strumento; con brokerId considera solo le operazioni di quell'intermediario */
export function positions(holdings: Holding[], ops: InvestmentOp[], brokerId?: string | null): Position[] {
  const byHolding = groupOps(brokerId ? ops.filter((o) => o.brokerId === brokerId) : ops);
  return holdings
    .filter((h) => !h.archived && (!brokerId || byHolding.has(h.id)))
    .map((h) => {
      const st = positionAt(byHolding.get(h.id) ?? []);
      const value = Math.round(st.quantity * h.price);
      const pnl = value - st.costBasis;
      const totalReturn = pnl + st.realized + st.income - st.costs - st.taxes;
      return { holding: h, ...st, value, pnl, pnlPct: st.costBasis > 0 ? pnl / st.costBasis : null, totalReturn };
    })
    .sort((a, b) => b.value - a.value);
}

export function portfolioTotals(ps: Position[]) {
  const sum = (k: keyof Pick<Position, 'value' | 'costBasis' | 'realized' | 'income' | 'costs' | 'taxes' | 'totalReturn'>) => ps.reduce((s, p) => s + p[k], 0);
  const value = sum('value');
  const invested = sum('costBasis');
  const pnl = value - invested;
  return {
    value,
    invested,
    pnl,
    pnlPct: invested > 0 ? pnl / invested : null,
    realized: sum('realized'),
    income: sum('income'),
    costs: sum('costs'),
    taxes: sum('taxes'),
    totalReturn: sum('totalReturn')
  };
}

export function allocation(ps: Position[]): { cls: AssetClass; value: number; share: number }[] {
  const total = ps.reduce((s, p) => s + p.value, 0);
  const map = new Map<AssetClass, number>();
  for (const p of ps) map.set(p.holding.assetClass, (map.get(p.holding.assetClass) ?? 0) + p.value);
  return [...map.entries()]
    .filter(([, v]) => v > 0)
    .map(([cls, value]) => ({ cls, value, share: total > 0 ? value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

/** Flusso netto investito in un intervallo (acquisti + commissioni − vendite) */
export function netInvested(ops: InvestmentOp[], start: string, end: string): number {
  let s = 0;
  for (const o of ops) {
    if (o.date < start || o.date > end) continue;
    if (o.kind === 'buy') s += o.amount + o.fees;
    else if (o.kind === 'sell') s -= o.amount - o.fees;
  }
  return s;
}

/** Prezzo noto alla data: ultimo storico ≤ data, altrimenti prezzo implicito dell'ultima operazione, altrimenti prezzo attuale */
function priceAt(h: Holding, prices: PricePoint[], ops: InvestmentOp[], date: string): number {
  let best: PricePoint | undefined;
  for (const p of prices) if (p.date <= date && (!best || p.date > best.date)) best = p;
  let lastOp: InvestmentOp | undefined;
  for (const o of ops) if ((o.kind === 'buy' || o.kind === 'sell') && o.quantity > 0 && o.date <= date && (!lastOp || o.date > lastOp.date)) lastOp = o;
  if (best && (!lastOp || best.date >= lastOp.date)) return best.price;
  if (lastOp) return lastOp.amount / lastOp.quantity;
  if (h.priceDate <= date) return h.price;
  return h.price;
}

/** Valore del portafoglio e capitale investito a fine di ciascun mese */
export function portfolioHistory(holdings: Holding[], ops: InvestmentOp[], prices: PricePoint[], months: string[]) {
  const byHolding = groupOps(ops);
  const pricesBy = new Map<string, PricePoint[]>();
  for (const p of prices) pricesBy.set(p.holdingId, [...(pricesBy.get(p.holdingId) ?? []), p]);
  return months.map((m) => {
    const end = monthEnd(`${m}-01`);
    let value = 0;
    let invested = 0;
    for (const h of holdings) {
      const hOps = byHolding.get(h.id) ?? [];
      const st = positionAt(hOps, end);
      if (st.quantity <= 0) continue;
      value += st.quantity * priceAt(h, pricesBy.get(h.id) ?? [], hOps, end);
      invested += st.costBasis;
    }
    return { key: m, value: Math.round(value), invested: Math.round(invested) };
  });
}

function groupOps(ops: InvestmentOp[]) {
  const m = new Map<string, InvestmentOp[]>();
  for (const o of ops) m.set(o.holdingId, [...(m.get(o.holdingId) ?? []), o]);
  return m;
}
