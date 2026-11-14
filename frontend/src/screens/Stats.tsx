import { useMemo, useState } from 'react';
import { fmtMoney } from '../lib/format.ts';
import { addMonths, balanceHistory, dailySpending, insights, monthName, monthRange, monthlySeries, periodStats, topExpenses } from '../money/calc.ts';
import { EntryRow, useApp } from '../ui/ctx.tsx';
import { CategoryBars, Heatmap, IncomeSpendBars, TwoLines } from '../ui/charts.tsx';

type Period = 'this' | 'last' | 'year';

export function StatsScreen() {
  const { ledger, today, wide, xl, go } = useApp();
  const [period, setPeriod] = useState<Period>('this');
  const month = today.slice(0, 7);
  const [from, to, label] = useMemo((): [string, string, string] => {
    if (period === 'this') return [monthRange(month)[0], today, `${monthName(month)} so far`];
    if (period === 'last') {
      const m = addMonths(month, -1);
      return [...monthRange(m), monthName(m)];
    }
    return [`${today.slice(0, 4)}-01-01`, today, `${today.slice(0, 4)} so far`];
  }, [period, month, today]);
  const heatMonth = period === 'last' ? addMonths(month, -1) : month;

  const stats = useMemo(() => periodStats(ledger, from, to), [ledger, from, to]);
  const series = useMemo(() => monthlySeries(ledger, month, 6), [ledger, month]);
  const history = useMemo(() => balanceHistory(ledger, month, 12, today), [ledger, month, today]);
  const daily = useMemo(() => dailySpending(ledger, heatMonth), [ledger, heatMonth]);
  const tops = useMemo(() => topExpenses(ledger, from, to, 10), [ledger, from, to]);
  const ins = useMemo(() => insights(ledger, today, (n) => fmtMoney(n)), [ledger, today]);

  const cats = useMemo(() => {
    const rows = [...stats.byCategory]
      .map(([id, value]) => {
        const c = ledger.categories.get(id);
        return { id, name: c?.name ?? 'No category', value, colour: c && c.slot ? `var(--c${c.slot})` : 'var(--c-other)' };
      })
      .sort((a, b) => b.value - a.value);
    if (rows.length <= 6) return rows;
    const rest = rows.slice(5);
    return [...rows.slice(0, 5), { id: '__other', name: `Other (${rest.length} categories)`, value: rest.reduce((s, r) => s + r.value, 0), colour: 'var(--c-other)' }];
  }, [stats, ledger]);

  const head = (
    <>
      <header className="top">
        <div>
          <p className="eyebrow">{label}</p>
          <h1 className="h1">Stats</h1>
        </div>
      </header>
      <div className="filters">
        {(
          [
            ['this', 'This month'],
            ['last', 'Last month'],
            ['year', 'This year'],
          ] as [Period, string][]
        ).map(([k, l]) => (
          <button key={k} className="filter" aria-pressed={period === k} onClick={() => setPeriod(k)}>
            {l}
          </button>
        ))}
      </div>
    </>
  );

  const insightRow = (
    <div className="insights">
      <div className="insight">
        You spent <b className="num">{fmtMoney(stats.spent)}</b> and earned <b className="num">{fmtMoney(stats.income)}</b>.
      </div>
      {period === 'this' &&
        ins.map((i) => (
          <div key={i.before + i.after} className="insight">
            {i.before}
            <b className="num">{i.strong}</b>
            {i.after}
          </div>
        ))}
    </div>
  );

  const catCard = (
    <section className="card">
      <div className="card-head">
        <h2 className="h2">Where your money went</h2>
        <span className="muted num">{fmtMoney(stats.spent)}</span>
      </div>
      {cats.length ? (
        <CategoryBars items={cats} onPick={(id) => id !== '__other' && go(`/history?category=${id}`)} />
      ) : (
        <p className="muted">No spending recorded in this period.</p>
      )}
    </section>
  );

  const incomeCard = (
    <section className="card">
      <div className="card-head">
        <h2 className="h2">Income and spending</h2>
        <span className="muted">last 6 months</span>
      </div>
      <IncomeSpendBars data={series} currentMonth={month} />
      <div className="legend">
        <span>
          <i className="box" style={{ background: 'var(--bar)' }} />
          Income
        </span>
        <span>
          <i className="box" style={{ background: 'var(--bar-2)' }} />
          Spending
        </span>
      </div>
    </section>
  );

  const worthCard = (
    <section className="card">
      <div className="card-head">
        <h2 className="h2">Money and net worth</h2>
        <span className="muted">12 months</span>
      </div>
      <TwoLines data={history.map((h) => ({ month: h.month, a: h.moneyHave, b: h.netWorth }))} a="var(--bar)" b="var(--bar-2)" labels={['Money I have', 'Net worth']} />
      <div className="legend">
        <span>
          <i style={{ background: 'var(--bar)' }} />
          Money I have
        </span>
        <span>
          <i style={{ background: 'repeating-linear-gradient(90deg,var(--bar-2) 0 5px,transparent 5px 8px)' }} />
          Net worth
        </span>
      </div>
    </section>
  );

  const loansCard = history.some((h) => h.iOwe || h.owedToMe) ? (
    <section className="card">
      <div className="card-head">
        <h2 className="h2">Loans over time</h2>
        <span className="muted">12 months</span>
      </div>
      <TwoLines data={history.map((h) => ({ month: h.month, a: h.iOwe, b: h.owedToMe }))} a="var(--neg)" b="var(--pos)" labels={['I owe', 'Owed to me']} />
      <div className="legend">
        <span>
          <i style={{ background: 'var(--neg)' }} />I owe
        </span>
        <span>
          <i style={{ background: 'repeating-linear-gradient(90deg,var(--pos) 0 5px,transparent 5px 8px)' }} />
          Owed to me
        </span>
      </div>
    </section>
  ) : null;

  const heatCard = (
    <section className="card">
      <div className="card-head">
        <h2 className="h2">Spending by day</h2>
        <span className="muted">{monthName(heatMonth)}</span>
      </div>
      <Heatmap month={heatMonth} values={daily} today={today} />
    </section>
  );

  const topCard = (
    <section className="card">
      <h2 className="h2">Biggest expenses</h2>
      {tops.length ? (
        <div className="rows">
          {tops.map(([id, e]) => (
            <EntryRow key={id} id={id} e={e} />
          ))}
        </div>
      ) : (
        <p className="muted">None in this period.</p>
      )}
    </section>
  );

  if (xl)
    return (
      <div className="screen">
        {head}
        {insightRow}
        <div className="wide-grid three">
          <div className="col">{catCard}{topCard}</div>
          <div className="col">{incomeCard}{worthCard}{loansCard}</div>
          <div className="col">{heatCard}</div>
        </div>
      </div>
    );
  if (wide)
    return (
      <div className="screen">
        {head}
        {insightRow}
        <div className="wide-grid">
          <div className="col">{incomeCard}{worthCard}{loansCard}</div>
          <div className="col">{catCard}{heatCard}{topCard}</div>
        </div>
      </div>
    );
  return (
    <div className="screen">
      {head}
      {insightRow}
      {catCard}
      {incomeCard}
      {worthCard}
      {loansCard}
      {heatCard}
      {topCard}
    </div>
  );
}
