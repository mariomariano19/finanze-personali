import { Icon } from './Icon';
import { formatEUR } from '../core/money';
import { dayLabel } from '../core/dates';
import { SOURCE_LABEL, type Category, type Transaction, type Account } from '../core/types';
import { useNav } from './nav';

export function TxRow({ t, catMap, accs, showDate = true }: { t: Transaction; catMap: Map<string, Category>; accs: Account[]; showDate?: boolean }) {
  const nav = useNav();
  const cat = t.categoryId ? catMap.get(t.categoryId) : undefined;
  const isInc = t.type === 'income';
  const isTr = t.type === 'transfer';
  const title = t.merchant || t.description || cat?.name || (isTr ? 'Giroconto' : 'Movimento');
  const subParts: string[] = [];
  if (showDate) subParts.push(dayLabel(t.date));
  if (isTr) {
    const from = accs.find((a) => a.id === t.accountId)?.name ?? '?';
    const to = accs.find((a) => a.id === t.toAccountId)?.name ?? '?';
    subParts.push(`${from} → ${to}`);
  } else if (cat && cat.name !== title) subParts.push(cat.name);
  else if (!cat) subParts.push('Senza categoria');
  const icon = isTr ? 'transfer' : (cat?.icon ?? (isInc ? 'income' : 'expense'));
  return (
    <button className="row" onClick={() => nav.openSheet({ name: 'tx', id: t.id })}>
      <span className={`ic ${isInc ? 'inc' : isTr ? 'neutral' : ''}`}>
        <Icon name={icon} size={18} color={isInc ? 'var(--income)' : isTr ? 'var(--muted)' : 'var(--expense)'} />
      </span>
      <span className="main">
        <span className="title">{title}</span>
        <span className="sub">
          {subParts.join(' · ')}
          {t.needsReview && <span className="tag review">Da confermare</span>}
          {t.source !== 'manual' && !t.needsReview && <span className="tag">{SOURCE_LABEL[t.source]}</span>}
        </span>
      </span>
      <span className={`amt num ${isInc ? 'income' : ''}`}>{isTr ? formatEUR(t.amount) : formatEUR(isInc ? t.amount : -t.amount, { sign: true })}</span>
    </button>
  );
}

/** Lista raggruppata per giorno */
export function TxGroupedList({ txs, catMap, accs, limit }: { txs: Transaction[]; catMap: Map<string, Category>; accs: Account[]; limit?: number }) {
  const list = limit ? txs.slice(0, limit) : txs;
  const groups: { day: string; items: Transaction[] }[] = [];
  for (const t of list) {
    const g = groups[groups.length - 1];
    if (g && g.day === t.date) g.items.push(t);
    else groups.push({ day: t.date, items: [t] });
  }
  return (
    <>
      {groups.map((g) => (
        <div key={g.day}>
          <div className="day-head">{dayLabel(g.day)}</div>
          <div className="card tight">
            {g.items.map((t) => (
              <TxRow key={t.id} t={t} catMap={catMap} accs={accs} showDate={false} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
