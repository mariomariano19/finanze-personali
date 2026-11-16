// Piano di risparmio: andamento, budget per categoria e consigli calcolati sul telefono.
// Ogni consiglio dice da quali movimenti nasce e quanto vale in euro l'anno. Nessun dato lascia il dispositivo.
// Importi in centesimi. Gli investimenti non sono costi: contano come risparmio.
import type { Category, RecurringRule, Transaction } from '../core/types';
import { addMonths, monthEnd, monthKey, monthStart } from '../core/dates';
import { needOf, type CatMap } from './stats';
import { normMerchant } from '../ledger/applepay';
import { monthlyEquivalent } from '../ledger/recurring';

export interface MonthSaving {
  month: string; // YYYY-MM
  income: number;
  expense: number;
  saved: number;
  rate: number | null;
}

const monthsBack = (ref: string, n: number) => {
  const out: string[] = [];
  for (let i = n; i >= 1; i--) out.push(monthKey(addMonths(monthStart(ref), -i, 1)));
  return out;
};

/** Mesi completi prima del mese di `today`, i più vecchi prima */
export function completeMonths(today: string, n: number): string[] {
  return monthsBack(today, n);
}

export function monthSavings(txs: Transaction[], months: string[]): MonthSaving[] {
  return months.map((m) => {
    let income = 0;
    let expense = 0;
    for (const t of txs) {
      if (monthKey(t.date) !== m) continue;
      if (t.type === 'income') income += t.amount;
      else if (t.type === 'expense') expense += t.amount;
    }
    return { month: m, income, expense, saved: income - expense, rate: income > 0 ? (income - expense) / income : null };
  });
}

/** Mesi (completi) che hanno almeno un movimento: serve a dire se i consigli sono affidabili */
export function monthsWithData(txs: Transaction[], today: string): number {
  const cur = monthKey(today);
  return new Set(txs.filter((t) => t.type !== 'transfer' && monthKey(t.date) < cur).map((t) => monthKey(t.date))).size;
}

export interface Plan {
  goalRate: number; // es. 0.2
  months: MonthSaving[]; // ultimi mesi completi con dati
  avgIncome: number;
  avgExpense: number;
  avgSaved: number;
  avgRate: number | null;
  /** quanto manca al mese per arrivare all'obiettivo (0 se raggiunto) */
  gapMonthly: number;
  current: MonthSaving; // mese in corso
}

export function savingsPlan(txs: Transaction[], today: string, goalPct: number, n = 3): Plan {
  const all = monthSavings(txs, completeMonths(today, n));
  const months = all.filter((m) => m.income > 0 || m.expense > 0);
  const k = months.length || 1;
  const avgIncome = Math.round(months.reduce((s, m) => s + m.income, 0) / k);
  const avgExpense = Math.round(months.reduce((s, m) => s + m.expense, 0) / k);
  const avgSaved = avgIncome - avgExpense;
  const goalRate = goalPct / 100;
  const gapMonthly = avgIncome > 0 ? Math.max(0, Math.round(goalRate * avgIncome - avgSaved)) : 0;
  return {
    goalRate,
    months,
    avgIncome,
    avgExpense,
    avgSaved,
    avgRate: avgIncome > 0 ? avgSaved / avgIncome : null,
    gapMonthly,
    current: monthSavings(txs, [monthKey(today)])[0]
  };
}

// ---------------- budget ----------------

export interface BudgetLine {
  categoryId: string;
  name: string;
  /** tetto mensile scelto (centesimi) o proposto */
  limit: number;
  proposed: number;
  active: boolean;
  spent: number; // mese in corso
  ratio: number; // spent / limit
  avg: number; // media mensile degli ultimi mesi completi
}

const roundUp5 = (cents: number) => Math.ceil(cents / 500) * 500;

/** Spesa per categoria (foglia) per mese */
function spendBy(txs: Transaction[], months: Set<string>, skipRecurring = false) {
  const m = new Map<string, number>();
  for (const t of txs) {
    if (t.type !== 'expense' || !t.categoryId || !months.has(monthKey(t.date))) continue;
    if (skipRecurring && t.recurringId) continue;
    m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + t.amount);
  }
  return m;
}

/**
 * Budget: per ogni categoria con spese negli ultimi 3 mesi propone la media arrotondata ai 5 € superiori.
 * Le spese fisse (affitto, rate) non hanno budget: non si decidono mese per mese.
 */
export function budgets(txs: Transaction[], cats: CatMap, today: string, saved: Record<string, number> | undefined): BudgetLine[] {
  const months = completeMonths(today, 3);
  const k = Math.max(1, new Set(txs.filter((t) => months.includes(monthKey(t.date))).map((t) => monthKey(t.date))).size);
  // le spese generate da una regola ricorrente sono fisse: niente budget
  const past = spendBy(txs, new Set(months), true);
  const cur = spendBy(txs, new Set([monthKey(today)]), true);
  const ids = new Set([...past.keys(), ...cur.keys(), ...Object.keys(saved ?? {})]);
  const out: BudgetLine[] = [];
  for (const id of ids) {
    const c = cats.get(id);
    if (!c || c.kind !== 'expense') continue;
    if (c.nature === 'fixed' && !(saved && id in saved)) continue;
    const avg = Math.round((past.get(id) ?? 0) / k);
    const proposed = roundUp5(avg);
    const active = Boolean(saved && id in saved);
    const limit = active ? saved![id] : proposed;
    if (!active && proposed === 0) continue;
    const spent = cur.get(id) ?? 0;
    out.push({ categoryId: id, name: c.name, limit, proposed, active, spent, ratio: limit > 0 ? spent / limit : 0, avg });
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || b.ratio - a.ratio || b.avg - a.avg);
}

/** Quota del mese trascorsa (per capire se la spesa è "in linea") */
export function monthProgress(today: string): number {
  const start = Date.parse(monthStart(today) + 'T00:00:00Z');
  const end = Date.parse(monthEnd(today) + 'T00:00:00Z');
  return Math.min(1, (Date.parse(today + 'T00:00:00Z') - start + 86400000) / (end - start + 86400000));
}

// ---------------- consigli ----------------

export type AdviceKind = 'small' | 'subscription' | 'growth' | 'discretionary' | 'fees';

export interface Advice {
  id: string; // stabile, per "fatto" / "non mi interessa"
  kind: AdviceKind;
  title: string;
  detail: string;
  /** risparmio stimato in un anno se segui il consiglio (centesimi) */
  yearly: number;
  /** movimenti da cui nasce il consiglio */
  evidence: string[]; // id movimenti
  action: string;
}

const eur = (c: number) => {
  const v = Math.round(c / 100);
  return `${v.toLocaleString('it-IT')} €`;
};
const eur2 = (c: number) => (c / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

export interface AdviceInput {
  txs: Transaction[];
  cats: Category[];
  catMap: CatMap;
  rules: RecurringRule[];
  today: string;
  goalPct: number;
}

export function advice({ txs, catMap, rules, today, goalPct }: AdviceInput): Advice[] {
  const months3 = completeMonths(today, 3);
  const set3 = new Set(months3);
  const exp3 = txs.filter((t) => t.type === 'expense' && set3.has(monthKey(t.date)));
  const k = Math.max(1, new Set(txs.filter((t) => set3.has(monthKey(t.date))).map((t) => monthKey(t.date))).size);
  const out: Advice[] = [];

  // 1. piccole spese ripetute (≤ 10 €, discrezionali), raggruppate per esercente o categoria
  const small = new Map<string, Transaction[]>();
  for (const t of exp3) {
    if (t.amount > 1000 || needOf(t, catMap) !== 'discretionary') continue;
    const key = t.merchant ? 'm:' + normMerchant(t.merchant) : 'c:' + (t.categoryId ?? '');
    small.set(key, [...(small.get(key) ?? []), t]);
  }
  for (const [key, list] of small) {
    if (list.length < 4 * k * 0.75 && list.length < 6) continue; // almeno ~1 a settimana
    const total = list.reduce((s, t) => s + t.amount, 0);
    const monthly = total / k;
    const label = key.startsWith('m:') ? (list[0].merchant ?? '') : catMap.get(key.slice(2))?.name ?? 'Piccole spese';
    const perDay = monthly / 30;
    out.push({
      id: 'small-' + key,
      kind: 'small',
      title: `${label}: ${eur2(perDay)} al giorno`,
      detail: `${list.length} spese da meno di 10 € negli ultimi ${k} mesi, circa ${eur(monthly)} al mese, ${eur(monthly * 12)} l’anno.`,
      yearly: Math.round(monthly * 12 * 0.5),
      evidence: list.map((t) => t.id),
      action: 'Dimezzandole risparmi la metà; il valore indicato è questo.'
    });
  }

  // 2. abbonamenti e spese fisse: regole ricorrenti + esercenti con stesso importo ogni mese
  const ruleNames = new Set<string>();
  for (const r of rules) {
    if (!r.active || r.type !== 'expense') continue;
    const yearly = monthlyEquivalent(r) * 12;
    ruleNames.add(normMerchant(r.description));
    const c = r.categoryId ? catMap.get(r.categoryId) : undefined;
    // affitto, mutuo, rate, tasse: non sono "abbonamenti" da disdire
    if (c && /affitto|mutuo|rate|prestit|finanziam|tasse|imposte|condominio|assicuraz/i.test(c.name + ' ' + r.description)) continue;
    // commissioni e interessi bancari hanno il loro consiglio: non contarli due volte
    if (c && /commission|interessi passivi|canone/i.test(c.name)) continue;
    out.push({
      id: 'sub-rule-' + r.id,
      kind: 'subscription',
      title: `${r.description || c?.name || 'Spesa ricorrente'}: ${eur(yearly)} l’anno`,
      detail: `Spesa fissa registrata come ricorrente (${eur2(r.amount)} ${r.frequency === 'monthly' ? 'al mese' : r.frequency === 'yearly' ? 'l’anno' : r.frequency === 'quarterly' ? 'a trimestre' : 'a settimana'}).`,
      yearly,
      evidence: txs.filter((t) => t.recurringId === r.id).map((t) => t.id),
      action: 'Lo usi ancora? Se no, disdirlo vale l’intero importo; se sì, controlla se esiste un piano più economico.'
    });
  }
  const months4 = new Set(completeMonths(today, 4));
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.type !== 'expense' || !t.merchant || t.recurringId || !months4.has(monthKey(t.date))) continue;
    const n = normMerchant(t.merchant);
    if (!n || ruleNames.has(n)) continue;
    byMerchant.set(n, [...(byMerchant.get(n) ?? []), t]);
  }
  for (const [n, list] of byMerchant) {
    const perMonth = new Map<string, Transaction[]>();
    for (const t of list) perMonth.set(monthKey(t.date), [...(perMonth.get(monthKey(t.date)) ?? []), t]);
    if (perMonth.size < 3 || [...perMonth.values()].some((x) => x.length !== 1)) continue;
    const amounts = list.map((t) => t.amount);
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    if (amounts.some((a) => Math.abs(a - avg) > avg * 0.1)) continue;
    out.push({
      id: 'sub-detect-' + n,
      kind: 'subscription',
      title: `${list[0].merchant}: sembra un abbonamento, ${eur(avg * 12)} l’anno`,
      detail: `Stesso esercente e importo simile (${eur2(avg)}) una volta al mese negli ultimi ${perMonth.size} mesi.`,
      yearly: Math.round(avg * 12),
      evidence: list.map((t) => t.id),
      action: 'Se è un abbonamento che non usi, disdirlo vale l’intero importo. Puoi anche segnarlo come spesa ricorrente.'
    });
  }

  // 3. categorie in crescita: ultimo mese completo contro la media dei 3 precedenti
  const last = completeMonths(today, 1)[0];
  const prev3 = new Set(monthsBack(addMonths(monthStart(today), -1, 1), 3));
  const lastBy = spendBy(txs, new Set([last]));
  const prevBy = spendBy(txs, prev3);
  const kPrev = Math.max(1, new Set(txs.filter((t) => prev3.has(monthKey(t.date))).map((t) => monthKey(t.date))).size);
  for (const [id, amt] of lastBy) {
    const c = catMap.get(id);
    if (!c || c.nature === 'fixed') continue;
    const base = (prevBy.get(id) ?? 0) / kPrev;
    if (base < 2000) continue; // sotto i 20 € al mese non è un trend
    const diff = amt - base;
    if (diff < 3000 || amt < base * 1.25) continue;
    out.push({
      id: `growth-${id}-${last}`,
      kind: 'growth',
      title: `${c.name}: +${Math.round((amt / base - 1) * 100)}% nell’ultimo mese`,
      detail: `${eur(amt)} nell’ultimo mese contro una media di ${eur(base)} nei 3 mesi prima.`,
      yearly: Math.round(diff * 12),
      evidence: txs.filter((t) => t.type === 'expense' && t.categoryId === id && monthKey(t.date) === last).map((t) => t.id),
      action: 'Tornare alla media di prima vale questo importo in un anno.'
    });
  }

  // 4. spese discrezionali, se il risparmio è sotto l'obiettivo
  const plan = savingsPlan(txs, today, goalPct);
  if (plan.gapMonthly > 0 && plan.avgIncome > 0) {
    const disc = exp3.filter((t) => needOf(t, catMap) === 'discretionary');
    const discMonthly = disc.reduce((s, t) => s + t.amount, 0) / k;
    if (discMonthly > 0) {
      const share = discMonthly / Math.max(1, plan.avgExpense);
      const cut = Math.min(discMonthly, plan.gapMonthly);
      out.push({
        id: 'disc-gap',
        kind: 'discretionary',
        title: `Spese non necessarie: ${eur(discMonthly)} al mese (${Math.round(share * 100)}% dei costi)`,
        detail: `Per arrivare al ${goalPct}% di risparmio ti mancano ${eur(plan.gapMonthly)} al mese; ridurre le spese discrezionali di ${Math.round((cut / discMonthly) * 100)}% basterebbe.`,
        yearly: Math.round(cut * 12),
        evidence: disc.map((t) => t.id),
        action: 'Scegli dove tagliare guardando le categorie discrezionali più grandi.'
      });
    }
  }

  // 5. commissioni e interessi bancari
  const fees = exp3.filter((t) => {
    const c = t.categoryId ? catMap.get(t.categoryId) : undefined;
    return c && /commission|interessi passivi|canone/i.test(c.name);
  });
  const feesMonthly = fees.reduce((s, t) => s + t.amount, 0) / k;
  if (feesMonthly >= 100) {
    out.push({
      id: 'fees',
      kind: 'fees',
      title: `Costi bancari: ${eur(feesMonthly * 12)} l’anno`,
      detail: `Commissioni, canoni e interessi passivi: circa ${eur2(feesMonthly)} al mese negli ultimi ${k} mesi.`,
      yearly: Math.round(feesMonthly * 12),
      evidence: fees.map((t) => t.id),
      action: 'Molti conti online hanno canone zero: confronta le condizioni del tuo conto.'
    });
  }

  return out.filter((a) => a.yearly >= 1000).sort((a, b) => b.yearly - a.yearly);
}

/** Effetto della simulazione: risparmio annuo dei consigli scelti e nuovo tasso di risparmio */
export function simulate(plan: Plan, chosen: Advice[]) {
  const yearly = chosen.reduce((s, a) => s + a.yearly, 0);
  const monthly = yearly / 12;
  const newRate = plan.avgIncome > 0 ? (plan.avgSaved + monthly) / plan.avgIncome : null;
  return { yearly, monthly: Math.round(monthly), newRate, reachesGoal: newRate !== null && newRate >= plan.goalRate };
}
