import { useMemo, useState } from 'react';
import { dayLabel, fmtMoney, parseAmount } from '../lib/format.ts';
import { counts, liveEntries, toBDT } from '../money/calc.ts';
import { describeEntry, EntryRow, useApp } from '../ui/ctx.tsx';
import { Icon } from '../ui/icons.tsx';

type Filter = 'all' | 'spend' | 'income' | 'transfer' | 'loans';

export function HistoryScreen() {
  const { ledger, today, wide } = useApp();
  const params = new URLSearchParams(location.search);
  const [filter, setFilter] = useState<Filter>((params.get('filter') as Filter) ?? 'all');
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState<string>(params.get('month') ?? 'all');
  const categoryFilter = params.get('category');

  const isLoan = (accountId?: string) => (accountId ? ledger.accounts.get(accountId)?.kind === 'loan' : false);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qAmount = parseAmount(q);
    return liveEntries(ledger)
      .reverse()
      .filter(([, e]) => {
        if (month !== 'all' && !e.date.startsWith(month)) return false;
        if (categoryFilter && e.categoryId !== categoryFilter) return false;
        const loan = isLoan(e.accountId) || isLoan(e.toAccountId);
        if (filter === 'spend' && e.kind !== 'expense') return false;
        if (filter === 'income' && e.kind !== 'income') return false;
        if (filter === 'transfer' && (e.kind !== 'transfer' || loan)) return false;
        if (filter === 'loans' && !loan) return false;
        if (!q) return true;
        const v = describeEntry(ledger, e);
        return `${v.title} ${v.sub} ${e.note ?? ''}`.toLowerCase().includes(q) || (qAmount !== null && e.amount === qAmount);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger, filter, query, month, categoryFilter]);

  const amountBDT = (e: (typeof list)[number][1]) => toBDT(ledger, e.amount, ledger.accounts.get(e.accountId)?.currency ?? 'BDT', e.date);
  const spent = list.filter(([, e]) => e.kind === 'expense').reduce((s, [, e]) => s + amountBDT(e), 0);
  const earned = list.filter(([, e]) => e.kind === 'income').reduce((s, [, e]) => s + amountBDT(e), 0);
  const months = useMemo(() => [...new Set(liveEntries(ledger).map(([, e]) => e.date.slice(0, 7)))].sort().reverse(), [ledger]);

  const days: [string, typeof list][] = [];
  for (const item of list) {
    const last = days[days.length - 1];
    if (last && last[0] === item[1].date) last[1].push(item);
    else days.push([item[1].date, [item]]);
  }

  const chips: [Filter, string][] = [
    ['all', 'All'],
    ['spend', 'Spending'],
    ['income', 'Income'],
    ['transfer', 'Transfers'],
    ['loans', 'Loans'],
  ];

  const controls = (
    <>
      <label className="search">
        <Icon name="search" />
        <input id="q" type="search" placeholder="Search notes, names or amounts" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
      </label>
      <div className="filters" style={wide ? { flexWrap: 'wrap' } : undefined}>
        {chips.map(([k, l]) => (
          <button key={k} className="filter" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="h-month">Month</label>
        <select id="h-month" value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="all">All time</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
            </option>
          ))}
        </select>
      </div>
      {categoryFilter && <p className="small-muted">Showing one category: {ledger.categories.get(categoryFilter)?.name}</p>}
      <div className="totals">
        <div className="total-box">
          <div className="lbl">Spent (shown)</div>
          <div className="v num neg">{fmtMoney(spent)}</div>
        </div>
        <div className="total-box">
          <div className="lbl">Earned (shown)</div>
          <div className="v num pos">{fmtMoney(earned)}</div>
        </div>
      </div>
    </>
  );

  const listCard = (
    <section className="card" style={{ paddingTop: 4 }}>
      {days.length ? (
        days.map(([date, items]) => {
          const daySpent = items.filter(([, e]) => e.kind === 'expense' && counts(e)).reduce((s, [, e]) => s + amountBDT(e), 0);
          return (
            <div key={date}>
              <div className="day-head">
                <span>{dayLabel(date, today)}</span>
                <span className="num">{daySpent ? `Spent ${fmtMoney(daySpent)}` : ''}</span>
              </div>
              <div className="rows">
                {items.map(([id, e]) => (
                  <EntryRow key={id} id={id} e={e} />
                ))}
              </div>
            </div>
          );
        })
      ) : (
        <p className="muted" style={{ margin: '12px 0' }}>
          {ledger.entries.size ? 'Nothing matches. Try another word or filter.' : 'No entries yet. Tap ＋ to add one.'}
        </p>
      )}
    </section>
  );

  const head = (
    <header className="top">
      <div>
        <p className="eyebrow">{list.length} entries</p>
        <h1 className="h1">History</h1>
      </div>
    </header>
  );

  if (wide)
    return (
      <div className="screen">
        {head}
        <div className="wide-grid list-side">
          <div className="col sticky-col">{controls}</div>
          <div className="col">{listCard}</div>
        </div>
      </div>
    );
  return (
    <div className="screen">
      {head}
      {controls}
      {listCard}
    </div>
  );
}
