import { useMemo } from 'react';
import { fmtDate, fmtMoney } from '../lib/format.ts';
import { liveEntries, loanSummary, monthName, monthRange, periodStats, totals, addMonths } from '../money/calc.ts';
import { EntryRow, useApp, useBalances } from '../ui/ctx.tsx';
import { Icon } from '../ui/icons.tsx';

export function HomeScreen() {
  const { ledger, today, wide, xl, go, openAdd, session } = useApp();
  const t = useMemo(() => totals(ledger, today), [ledger, today]);
  const bals = useBalances();
  const month = today.slice(0, 7);
  const [mFrom] = monthRange(month);
  const stats = useMemo(() => periodStats(ledger, mFrom, today), [ledger, mFrom, today]);
  const prev = useMemo(() => {
    const [f, to] = monthRange(addMonths(month, -1));
    return periodStats(ledger, f, to);
  }, [ledger, month]);
  const recent = useMemo(() => liveEntries(ledger).reverse().slice(0, xl ? 10 : 5), [ledger, xl]);
  const loans = useMemo(
    () =>
      [...ledger.accounts]
        .filter(([, a]) => a.kind === 'loan')
        .map(([id, a]) => ({ id, a, s: loanSummary(ledger, id) }))
        .filter((x) => x.s.status !== 'settled'),
    [ledger],
  );
  const owe = loans.filter((x) => x.s.status === 'owe').sort((a, b) => a.s.balance - b.s.balance);
  const owed = loans.filter((x) => x.s.status === 'owed').sort((a, b) => b.s.balance - a.s.balance);
  const money = [...ledger.accounts].filter(([, a]) => a.kind === 'money' && !a.archived).sort(([, a], [, b]) => a.sortOrder - b.sortOrder);
  const spentPct = stats.income > 0 ? Math.min(100, Math.round((stats.spent / stats.income) * 100)) : stats.spent > 0 ? 100 : 0;
  const prevName = monthName(addMonths(month, -1));

  const header = (
    <header className="top">
      <div>
        <p className="eyebrow">{fmtDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="h1">Hello, {session.user.displayName.split(' ')[0]}</h1>
      </div>
      {!wide && (
        <button className="icon-btn" onClick={() => go('/settings')} aria-label="Settings">
          <Icon name="settings" />
        </button>
      )}
    </header>
  );

  if (!money.length) {
    return (
      <div className="screen">
        {header}
        <section className="card">
          <div className="empty">
            <p className="h2">Add your first account</p>
            <p>A bank account, bKash, the cash in your wallet: anywhere your money sits.</p>
            <button className="btn" onClick={() => go('/accounts')}>Add an account</button>
          </div>
        </section>
      </div>
    );
  }

  const hero = (
    <section className="hero" aria-label="Totals">
      <p className="hero-label">Money I have</p>
      <p className="hero-amount num">{fmtMoney(t.moneyHave)}</p>
      <p className="hero-sub">
        Net worth <b className="num">{fmtMoney(t.netWorth)}</b> after loans{' '}
        <button
          className="info"
          aria-label="How net worth is worked out"
          data-tip={`Net worth = money I have (${fmtMoney(t.moneyHave)}) + owed to me (${fmtMoney(t.owedToMe)}) − I owe (${fmtMoney(t.iOwe)})`}
        >
          i
        </button>
      </p>
    </section>
  );

  const monthCard = (
    <section className="card" aria-label="This month">
      <div className="card-head">
        <h2 className="h2">{monthName(month)} so far</h2>
        <button className="link" onClick={() => go('/stats')}>Details</button>
      </div>
      {stats.spent || stats.income ? (
        <>
          <p className="sentence">
            You spent <b className="neg">{fmtMoney(stats.spent)}</b> and earned <b className="pos">{fmtMoney(stats.income)}</b>.
          </p>
          <div className="meter" role="img" aria-label={`Spent ${spentPct}% of what you earned`}>
            <span style={{ width: `${spentPct}%` }} />
          </div>
          <div className="meter-legend">
            <span>{stats.income ? `Spent ${spentPct}% of income` : 'No income recorded yet'}</span>
            {prev.spent > 0 && <span>{stats.spent <= prev.spent ? `${fmtMoney(prev.spent - stats.spent)} less than ${prevName}` : `${fmtMoney(stats.spent - prev.spent)} more than ${prevName}`}</span>}
          </div>
        </>
      ) : (
        <p className="sentence muted">Nothing recorded this month yet. Tap ＋ to add your first expense.</p>
      )}
    </section>
  );

  const names = (list: typeof owe) => list.map((x) => `${x.a.name} ${fmtMoney(Math.abs(x.s.balance), x.a.currency)}`).join(' · ');
  const loanCard = (
    <section className="card" aria-label="Loans">
      <div className="card-head">
        <h2 className="h2">Loans</h2>
        <button className="link" onClick={() => go('/loans')}>See all</button>
      </div>
      {t.iOwe === 0 && t.owedToMe === 0 ? (
        <p className="settled-note">
          <Icon name="check" /> You owe nobody, and nobody owes you.
        </p>
      ) : (
        <div className="loan-split">
          <button className="loan-half owe" onClick={() => go('/loans?tab=owe')}>
            <span className="lbl">
              <Icon name="out" /> I owe
            </span>
            <span className="amt num neg">{fmtMoney(t.iOwe)}</span>
            <span className="who">{owe.length ? names(owe) : 'You owe nobody ✓'}</span>
          </button>
          <button className="loan-half owed" onClick={() => go('/loans?tab=owed')}>
            <span className="lbl">
              <Icon name="in" /> Owed to me
            </span>
            <span className="amt num pos">{fmtMoney(t.owedToMe)}</span>
            <span className="who">{owed.length ? names(owed) : 'Nobody owes you'}</span>
          </button>
        </div>
      )}
    </section>
  );

  const accounts = (
    <section className="card" aria-label="Accounts">
      <div className="card-head">
        <h2 className="h2">Accounts</h2>
        <button className="link" onClick={() => go('/accounts')}>All {money.length}</button>
      </div>
      <div className="acct-grid">
        {money.slice(0, xl ? money.length : 6).map(([id, a]) => {
          const bal = bals.get(id) ?? 0;
          return (
            <button key={id} className="acct-mini" onClick={() => go(`/accounts/${id}`)}>
              <span className="n">{a.name}</span>
              <span className={`v num ${bal < 0 ? 'neg' : ''}`}>{fmtMoney(bal, a.currency)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );

  const recentCard = (
    <section className="card" aria-label="Recent">
      <div className="card-head">
        <h2 className="h2">Recent</h2>
        <button className="link" onClick={() => go('/history')}>See all</button>
      </div>
      {recent.length ? (
        <div className="rows">
          {recent.map(([id, e]) => (
            <EntryRow key={id} id={id} e={e} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <p>No entries yet.</p>
          <button className="btn small" onClick={() => openAdd({ kind: 'expense' })}>Add an expense</button>
        </div>
      )}
    </section>
  );

  if (xl)
    return (
      <div className="screen">
        {header}
        <div className="wide-grid three">
          <div className="col">{hero}{monthCard}{loanCard}</div>
          <div className="col">{recentCard}</div>
          <div className="col">{accounts}</div>
        </div>
      </div>
    );
  if (wide)
    return (
      <div className="screen">
        {header}
        <div className="wide-grid">
          <div className="col">{hero}{monthCard}{recentCard}</div>
          <div className="col">{loanCard}{accounts}</div>
        </div>
      </div>
    );
  return (
    <div className="screen">
      {header}
      {hero}
      {loanCard}
      {monthCard}
      {accounts}
      {recentCard}
    </div>
  );
}
