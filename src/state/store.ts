import { useMemo, useSyncExternalStore } from 'react';
import { vault } from '../persistence/vault';
import { catMapOf } from '../analytics/stats';
import type { Category, Settings, Transaction, RecurringRule, Account, Holding, InvestmentOp, PricePoint, Broker } from '../core/types';
import { generateDue } from '../ledger/recurring';
import { buildMonthlyReport } from '../analytics/report';
import { addMonths, monthKey, monthStart, today } from '../core/dates';
import { newId, nowISO } from '../core/id';

const subscribe = (fn: () => void) => vault.subscribe(fn);
const getVersion = () => vault.version;

export interface AppData {
  version: number;
  txs: Transaction[];
  cats: Category[];
  catMap: Map<string, Category>;
  accs: Account[];
  rules: RecurringRule[];
  holdings: Holding[];
  brokers: Broker[];
  ops: InvestmentOp[];
  prices: PricePoint[];
  settings: Settings;
  saving: boolean;
  lastError: string | null;
}

const DEFAULT_SETTINGS: Settings = { id: 'settings', savingsGoal: 25, autoLockMinutes: 5, lastBackupAt: null, backupReminderDays: 7, createdAt: '' };

/** Dati correnti, ricalcolati a ogni modifica del vault */
export function useData(): AppData {
  const version = useSyncExternalStore(subscribe, getVersion);
  return useMemo(() => {
    const cats = vault.list('cat').sort((a, b) => a.order - b.order);
    return {
      version,
      txs: vault.list('tx').sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date))),
      cats,
      catMap: catMapOf(cats),
      accs: vault.list('acc'),
      rules: vault.list('rec'),
      holdings: vault.list('hold'),
      brokers: vault.list('brk').sort((a, b) => a.name.localeCompare(b.name)),
      ops: vault.list('op').sort((a, b) => b.date.localeCompare(a.date)),
      prices: vault.list('price'),
      settings: vault.get('settings', 'settings') ?? DEFAULT_SETTINGS,
      saving: vault.saving,
      lastError: vault.lastError
    };
  }, [version]);
}

// ---------- azioni ----------

export function saveTransaction(t: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; createdAt?: string }) {
  const now = nowISO();
  const tx: Transaction = { ...t, id: t.id ?? newId(), createdAt: t.createdAt ?? now, updatedAt: now };
  vault.put('tx', tx);
  return tx;
}

export function deleteTransaction(id: string) {
  vault.remove('tx', id);
}

export function saveSettings(patch: Partial<Settings>) {
  const cur = vault.get('settings', 'settings') ?? { ...DEFAULT_SETTINGS, createdAt: nowISO() };
  vault.put('settings', { ...cur, ...patch, id: 'settings' });
}

/** Operazioni automatiche all'apertura: genera le ricorrenze maturate e archivia i report dei mesi chiusi */
export function runMaintenance(ref = today()) {
  const rules = vault.list('rec');
  const existing = new Set(vault.list('tx').map((t) => t.id));
  const { txs, updated } = generateDue(rules, existing, ref);
  if (txs.length) vault.putMany('tx', txs);
  if (updated.length) vault.putMany('rec', updated);

  // Istantanea del report del mese appena chiuso (se ci sono dati e non esiste già)
  const prevMonth = monthKey(addMonths(monthStart(ref), -1, 1));
  if (!vault.get('report', prevMonth)) {
    const all = vault.list('tx');
    if (all.some((t) => monthKey(t.date) === prevMonth)) {
      const report = buildMonthlyReport(prevMonth, all, vault.list('op'), catMapOf(vault.list('cat')));
      vault.put('report', { id: prevMonth, createdAt: nowISO(), data: report });
    }
  }
  return txs.length;
}
