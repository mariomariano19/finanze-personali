import { defaultCategories } from '../core/categories';
import type { Account, Settings } from '../core/types';
import { nowISO } from '../core/id';
import type { DataDump } from './vault';

export function initialData(): Partial<DataDump> {
  const accounts: Account[] = [
    { id: 'acc-conto', name: 'Conto corrente', kind: 'checking' },
    { id: 'acc-carta', name: 'Carta di debito', kind: 'card' },
    { id: 'acc-contanti', name: 'Contanti', kind: 'cash' }
  ];
  const settings: Settings = {
    id: 'settings',
    savingsGoal: 25,
    autoLockMinutes: 5,
    lastBackupAt: null,
    backupReminderDays: 7,
    createdAt: nowISO()
  };
  return { cat: defaultCategories(), acc: accounts, settings: [settings] };
}
