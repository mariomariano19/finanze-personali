import { useMemo, useState } from 'react';
import { useData } from '../state/store';
import { useNav, type TxFilter } from '../ui/nav';
import { Header, Empty } from '../ui/common';
import { TxGroupedList } from '../ui/TxRow';
import { inPeriod, periodLabel } from '../core/dates';
import { formatEUR } from '../core/money';
import { macroOf } from '../analytics/stats';

export function TxList({ filter }: { filter: TxFilter }) {
  const data = useData();
  const nav = useNav();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.txs.filter((t) => {
      if (filter.type && t.type !== filter.type) return false;
      if (filter.review && !t.needsReview) return false;
      if (filter.period && !inPeriod(t.date, filter.period)) return false;
      if (filter.categoryId && t.categoryId !== filter.categoryId) return false;
      if (filter.macroId && macroOf(t.categoryId, data.catMap)?.id !== filter.macroId) return false;
      if (needle) {
        const cat = t.categoryId ? data.catMap.get(t.categoryId)?.name ?? '' : '';
        const hay = `${t.description} ${t.merchant ?? ''} ${cat} ${(t.amount / 100).toFixed(2).replace('.', ',')}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [data.txs, data.catMap, filter, q]);

  const total = list.reduce((s, t) => s + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0);

  return (
    <div className="screen no-tab">
      <Header onBack={nav.pop} eyebrow={filter.period ? periodLabel(filter.period) : `${list.length} movimenti`} title={filter.title ?? 'Movimenti'} />
      <input className="search" type="search" placeholder="Cerca per descrizione, esercente, categoria o importo" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cerca movimenti" />
      {list.length > 0 && (
        <span className="small muted">
          {list.length} movimenti · saldo <b className="num">{formatEUR(total, { sign: true })}</b>
        </span>
      )}
      {list.length === 0 ? (
        <div className="card"><Empty>Nessun movimento trovato.</Empty></div>
      ) : (
        <>
          <TxGroupedList txs={list} catMap={data.catMap} accs={data.accs} limit={limit} />
          {list.length > limit && (
            <button className="btn secondary" onClick={() => setLimit((l) => l + 200)}>
              Mostra altri
            </button>
          )}
        </>
      )}
    </div>
  );
}
