import { createContext, useContext } from 'react';
import type { Period } from '../core/dates';
import type { Nature, Need, TxType } from '../core/types';

export type Tab = 'home' | 'income' | 'costs' | 'invest' | 'intel' | 'reports';

export interface TxFilter {
  type?: TxType;
  macroId?: string;
  categoryId?: string;
  nature?: Nature;
  need?: Need;
  junk?: boolean;
  review?: boolean;
  period?: Period;
  title?: string;
}

export type Route =
  | { name: 'txList'; filter: TxFilter }
  | { name: 'settings' }
  | { name: 'categories'; kind: 'income' | 'expense' }
  | { name: 'recurring' }
  | { name: 'applePay' }
  | { name: 'accounts' }
  | { name: 'backup' }
  | { name: 'security' }
  | { name: 'holding'; id: string }
  | { name: 'brokers' }
  | { name: 'intelSetup' }
  | { name: 'dossier'; itemId: string };

export type SheetState =
  | { name: 'tx'; id?: string; type?: TxType | 'investment'; categoryId?: string }
  | { name: 'op'; holdingId?: string; id?: string }
  | { name: 'holding'; id?: string }
  | { name: 'price'; holdingId: string }
  | { name: 'rule'; id?: string }
  | { name: 'category'; id?: string; kind: 'income' | 'expense'; parentId?: string | null }
  | { name: 'account'; id?: string }
  | { name: 'broker'; id?: string };

export interface Nav {
  tab: Tab;
  setTab: (t: Tab) => void;
  push: (r: Route) => void;
  pop: () => void;
  openSheet: (s: SheetState) => void;
  closeSheet: () => void;
  period: Period;
  setPeriod: (p: Period) => void;
}

export const NavCtx = createContext<Nav>(null as unknown as Nav);
export const useNav = () => useContext(NavCtx);
