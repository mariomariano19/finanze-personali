import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { vault } from './persistence/vault';
import { useData, runMaintenance } from './state/store';
import { usePriceSync } from './intel/prices';
import { NavCtx, type Nav, type Route, type SheetState, type Tab } from './ui/nav';
import { ToastProvider } from './ui/common';
import { Icon } from './ui/Icon';
import { periodFor, type Period } from './core/dates';
import { Lock } from './screens/Lock';
import { Home } from './screens/Home';
import { Income } from './screens/Income';
import { Costs } from './screens/Costs';
import { Investments, HoldingDetail, Brokers } from './screens/Investments';
import { Dossier } from './screens/Dossier';
import { Reports } from './screens/Reports';
import { Intelligence } from './screens/Intelligence';
import { IntelSetup } from './screens/IntelSetup';
import { TxList } from './screens/TxList';
import { Settings, Backup, Security, Categories, Recurring, Accounts } from './screens/Settings';
import { TxSheet } from './sheets/TxSheet';
import { HoldingSheet, OpSheet, PriceSheet, RuleSheet, CategorySheet, AccountSheet, BrokerSheet } from './sheets/OtherSheets';

type Status = 'loading' | 'locked' | 'new' | 'open';

export function App() {
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    vault.isInitialized().then((ok) => setStatus(ok ? 'locked' : 'new'));
  }, []);

  const lock = useCallback(() => {
    vault.lock();
    setStatus('locked');
  }, []);

  if (status === 'loading') return null;
  if (status !== 'open') return <Lock initialized={status === 'locked'} onUnlocked={() => setStatus('open')} />;
  return (
    <ToastProvider>
      <Shell onLock={lock} />
    </ToastProvider>
  );
}

const TABS: { id: Tab; label: string; icon: string; cls: string }[] = [
  { id: 'home', label: 'Home', icon: 'home', cls: '' },
  { id: 'income', label: 'Ricavi', icon: 'income', cls: 't-income' },
  { id: 'costs', label: 'Costi', icon: 'expense', cls: 't-costs' },
  { id: 'invest', label: 'Investim.', icon: 'trend', cls: 't-invest' },
  { id: 'intel', label: 'Mercati', icon: 'radar', cls: '' },
  { id: 'reports', label: 'Report', icon: 'report', cls: '' }
];

function Shell({ onLock }: { onLock: () => void }) {
  const data = useData();
  usePriceSync();
  const [tab, setTabState] = useState<Tab>('home');
  const [stack, setStack] = useState<Route[]>([]);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [period, setPeriod] = useState<Period>(() => periodFor('month'));

  // Ricorrenze maturate e report dei mesi chiusi: all'apertura e quando cambiano le regole
  const rulesSig = data.rules.map((r) => `${r.id}:${r.active}:${r.startDate}:${r.frequency}:${r.lastGenerated ?? ''}`).join('|');
  useEffect(() => {
    runMaintenance();
  }, [rulesSig]);

  // Blocco automatico dopo inattività o quando l'app resta in background
  const lastActive = useRef(Date.now());
  useEffect(() => {
    const limit = () => data.settings.autoLockMinutes * 60_000;
    const touch = () => (lastActive.current = Date.now());
    const check = () => {
      if (Date.now() - lastActive.current > limit()) onLock();
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') check();
      else lastActive.current = Math.min(lastActive.current, Date.now());
    };
    const iv = window.setInterval(check, 15_000);
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [data.settings.autoLockMinutes, onLock]);

  const nav: Nav = useMemo(
    () => ({
      tab,
      setTab: (t) => {
        setTabState(t);
        setStack([]);
        window.scrollTo(0, 0);
      },
      push: (r) => {
        setStack((s) => [...s, r]);
        window.scrollTo(0, 0);
      },
      pop: () => setStack((s) => s.slice(0, -1)),
      openSheet: setSheet,
      closeSheet: () => setSheet(null),
      period,
      setPeriod
    }),
    [tab, period]
  );

  const route = stack[stack.length - 1];
  let content;
  if (route) {
    switch (route.name) {
      case 'txList': content = <TxList filter={route.filter} />; break;
      case 'settings': content = <Settings />; break;
      case 'backup': content = <Backup />; break;
      case 'security': content = <Security onLock={onLock} />; break;
      case 'categories': content = <Categories kind={route.kind} />; break;
      case 'recurring': content = <Recurring />; break;
      case 'accounts': content = <Accounts />; break;
      case 'holding': content = <HoldingDetail id={route.id} />; break;
      case 'brokers': content = <Brokers />; break;
      case 'intelSetup': content = <IntelSetup />; break;
      case 'dossier': content = <Dossier itemId={route.itemId} />; break;
    }
  } else {
    content = tab === 'home' ? <Home /> : tab === 'income' ? <Income /> : tab === 'costs' ? <Costs /> : tab === 'invest' ? <Investments /> : tab === 'intel' ? <Intelligence /> : <Reports />;
  }

  const fab = () => {
    if (tab === 'invest') {
      if (data.holdings.length === 0) nav.openSheet({ name: 'holding' });
      else nav.openSheet({ name: 'op' });
    } else nav.openSheet({ name: 'tx', type: tab === 'income' ? 'income' : 'expense' });
  };

  return (
    <NavCtx.Provider value={nav}>
      <main key={route ? `${stack.length}-${route.name}` : tab}>{content}</main>
      {!route && (
        <>
          {tab !== 'intel' && (
            <button className="fab" aria-label="Aggiungi movimento" onClick={fab}>
              <Icon name="plus" size={24} color="#fff" stroke={2.2} />
            </button>
          )}
          <nav className="tabbar" aria-label="Sezioni">
            {TABS.map((t) => (
              <button key={t.id} className={t.cls} aria-current={tab === t.id ? 'page' : undefined} onClick={() => nav.setTab(t.id)}>
                <Icon name={t.icon} size={24} />
                {t.label}
              </button>
            ))}
          </nav>
        </>
      )}
      {data.saving && <span className="saving-dot" aria-label="Salvataggio in corso" />}
      {sheet?.name === 'tx' && <TxSheet key={sheet.id ?? 'new'} id={sheet.id} initialType={sheet.type} initialCategory={sheet.categoryId} />}
      {sheet?.name === 'op' && <OpSheet holdingId={sheet.holdingId} id={sheet.id} />}
      {sheet?.name === 'holding' && <HoldingSheet id={sheet.id} />}
      {sheet?.name === 'price' && <PriceSheet holdingId={sheet.holdingId} />}
      {sheet?.name === 'rule' && <RuleSheet id={sheet.id} />}
      {sheet?.name === 'category' && <CategorySheet id={sheet.id} kind={sheet.kind} parentId={sheet.parentId} />}
      {sheet?.name === 'account' && <AccountSheet id={sheet.id} />}
      {sheet?.name === 'broker' && <BrokerSheet id={sheet.id} />}
    </NavCtx.Provider>
  );
}
