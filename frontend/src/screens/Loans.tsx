import { Fragment, useMemo, useState } from 'react';
import { fmtDate, fmtMoney, initials } from '../lib/format.ts';
import { accountLabel, groupByPerson, loanSummary, loanTitle, offsetPlan, personKey, toBDT, type LoanSummary } from '../money/calc.ts';
import { cancelOut } from '../money/actions.ts';
import type { Account } from '../money/types.ts';
import { EntryRow, useApp } from '../ui/ctx.tsx';
import { ACCOUNT_ICONS, Chip, Icon } from '../ui/icons.tsx';
import { Sheet } from '../ui/kit.tsx';
import { AccountSheet } from './Accounts.tsx';

interface LoanRow {
  id: string;
  a: Account;
  s: LoanSummary;
}

function useLoans(): LoanRow[] {
  const { ledger } = useApp();
  return useMemo(
    () =>
      [...ledger.accounts]
        .filter(([, a]) => a.kind === 'loan')
        .map(([id, a]) => ({ id, a, s: loanSummary(ledger, id) })),
    [ledger],
  );
}

function LoanCard({ row, grouped }: { row: LoanRow; grouped?: boolean }) {
  const { go, openAdd } = useApp();
  const { id, a, s } = row;
  const pct = s.cycleAmount ? Math.round((s.repaid / s.cycleAmount) * 100) : 0;
  const owe = s.status === 'owe';
  // Headline: what the loan is for. The person goes underneath, unless the group heading already names them.
  const sub = [
    a.purpose?.trim() && !grouped ? a.name : '',
    s.openItems[0] ? `since ${fmtDate(s.openItems[0].date, { day: 'numeric', month: 'short', year: 'numeric' })}` : '',
    a.includeInTotal ? '' : 'not on Home',
  ].filter(Boolean);
  return (
    <article className="loan-card">
      <button className="loan-top" onClick={() => go(`/loans/${id}`)}>
        <Chip icon={ACCOUNT_ICONS[a.type] ?? 'person'} />
        <span className="row-main">
          <span className="row-title">{loanTitle(a)}</span>
          <span className="row-sub">{sub.join(' · ')}</span>
        </span>
        <span className={`row-amt num ${owe ? 'neg' : 'pos'}`}>
          {fmtMoney(Math.abs(s.balance), a.currency)}
          <small>{owe ? 'you owe' : 'owes you'}</small>
        </span>
      </button>
      <div className="progress" role="img" aria-label={`${pct}% repaid`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="loan-meta">
        <span>
          {fmtMoney(s.repaid, a.currency)} of {fmtMoney(s.cycleAmount, a.currency)} repaid
        </span>
        <button className="btn small" onClick={() => openAdd({ kind: 'repay', loanId: id })}>
          Repay
        </button>
      </div>
    </article>
  );
}

/** "Overall you owe Rafi ৳4,000" across both directions, in taka. */
function overallText(name: string, net: number, approx: boolean): string {
  const amt = (approx ? '≈ ' : '') + fmtMoney(Math.abs(net));
  if (Math.round(net) === 0) return `Overall you and ${name} are even`;
  return net < 0 ? `Overall you owe ${name} ${amt}` : `Overall ${name} owes you ${amt}`;
}

export function LoansScreen() {
  const { ledger, today, wide, openAdd, go } = useApp();
  const loans = useLoans();
  const initialTab = new URLSearchParams(location.search).get('tab') === 'owed' ? 'owed' : 'owe';
  const [tab, setTab] = useState<'owe' | 'owed'>(initialTab);
  // Adding a loan that was already owed: opens with the current tab's direction.
  const [adding, setAdding] = useState<'owe' | 'owed' | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const bdt = (r: LoanRow) => toBDT(ledger, Math.abs(r.s.balance), r.a.currency, today);
  const owe = loans.filter((r) => r.s.status === 'owe' && !r.a.archived);
  const owed = loans.filter((r) => r.s.status === 'owed' && !r.a.archived);
  const settled = loans.filter((r) => r.s.status === 'settled' || r.a.archived);
  const list = (tab === 'owe' ? owe : owed).sort((x, y) => bdt(y) - bdt(x));
  const sum = (rows: LoanRow[]) => rows.reduce((s, r) => s + bdt(r), 0);
  // Every open loan, by person, to find loans in the other direction and what can be cancelled out.
  const openByPerson = new Map(groupByPerson([...owe, ...owed]).map((g) => [g.key, g.rows]));
  const groups = groupByPerson(list).sort((x, y) => sum(y.rows) - sum(x.rows));

  return (
    <div className="screen">
      <header className="top">
        <div>
          <p className="eyebrow">People and organizations</p>
          <h1 className="h1">Loans</h1>
        </div>
        <button className="btn small ghost" onClick={() => setAdding(tab)}>
          <Icon name="plus" /> Existing loan
        </button>
      </header>
      <div className="tabs" role="tablist">
        <button aria-pressed={tab === 'owe'} onClick={() => setTab('owe')}>
          <span>I owe</span>
          <span className="t-amt num neg">{fmtMoney(sum(owe))}</span>
        </button>
        <button aria-pressed={tab === 'owed'} onClick={() => setTab('owed')}>
          <span>Owed to me</span>
          <span className="t-amt num pos">{fmtMoney(sum(owed))}</span>
        </button>
      </div>
      {list.length ? (
        <div className={wide ? 'grid-auto loan-grid' : 'col'}>
          {groups.map((g) => {
            const all = openByPerson.get(g.key) ?? g.rows;
            const other = all.filter((r) => r.s.status !== (tab === 'owe' ? 'owe' : 'owed'));
            if (g.rows.length === 1 && !other.length) return <LoanCard key={g.rows[0]!.id} row={g.rows[0]!} />;
            const net = all.reduce((s, r) => s + toBDT(ledger, r.s.balance, r.a.currency, today), 0);
            const approx = all.some((r) => r.a.currency === 'USD');
            const canCancel = offsetPlan(ledger, all.map((r) => r.id)).length > 0;
            const total = sum(g.rows);
            return (
              <section key={g.key} className="loan-group" aria-label={`Loans with ${g.name}`}>
                <div className="loan-group-head">
                  <span className="lg-main">
                    <span className="lg-name">{g.name}</span>
                    <span className="lg-sub">
                      {tab === 'owe' ? 'You owe ' : 'Owes you '}
                      <b className={`num ${tab === 'owe' ? 'neg' : 'pos'}`}>{fmtMoney(total)}</b>
                      {g.rows.length > 1 ? ` across ${g.rows.length} loans` : ''}
                    </span>
                    {other.length > 0 && <span className="lg-sub">{overallText(g.name, net, approx)}</span>}
                  </span>
                  {canCancel && (
                    <button className="btn small ghost" onClick={() => setCancelling(g.key)}>
                      <Icon name="swap" /> Cancel out
                    </button>
                  )}
                </div>
                <div className={wide ? 'grid-auto' : 'col'}>
                  {g.rows.map((r) => (
                    <LoanCard key={r.id} row={r} grouped />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <section className="card">
          <p className="settled-note">
            <Icon name="check" /> {tab === 'owe' ? 'You owe nobody' : 'Nobody owes you'}
          </p>
          <div className="list-actions">
            <button className="btn small ghost" onClick={() => openAdd({ kind: tab === 'owe' ? 'borrow' : 'lend' })}>
              {tab === 'owe' ? 'Record money you borrowed' : 'Record money you lent'}
            </button>
            <button className="btn small ghost" onClick={() => setAdding(tab)}>
              Add a loan from before
            </button>
          </div>
        </section>
      )}
      {settled.length > 0 && (
        <details className="settled">
          <summary>
            <span>Settled ({settled.length})</span>
            <Icon name="chev" />
          </summary>
          <div className="rows" style={{ marginTop: 8 }}>
            {groupByPerson(settled).map((g) => (
              <Fragment key={g.key}>
                {g.rows.length > 1 && <p className="settled-person">{g.name} · {g.rows.length} loans</p>}
                {g.rows.map((r) => (
                  <div key={r.id} className={`row${g.rows.length > 1 ? ' in-group' : ''}`}>
                    <Chip icon={ACCOUNT_ICONS[r.a.type] ?? 'person'} />
                    <button className="row-main row-btn" onClick={() => go(`/loans/${r.id}`)}>
                      <span className="row-title">{g.rows.length > 1 ? loanTitle(r.a) : accountLabel(r.a)}</span>
                      <span className="row-sub">{r.a.archived ? 'Archived' : 'Settled ✓ · reuse for a new loan'}</span>
                    </button>
                    <button className="btn small ghost" onClick={() => openAdd({ kind: 'lend', loanId: r.id })}>Lend</button>
                    <button className="btn small ghost" onClick={() => openAdd({ kind: 'borrow', loanId: r.id })}>Borrow</button>
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </details>
      )}
      {adding && <AccountSheet kind="loan" initialDirection={adding} onClose={() => setAdding(null)} />}
      {cancelling && <CancelOutSheet rows={openByPerson.get(cancelling) ?? []} onClose={() => setCancelling(null)} />}
    </div>
  );
}

/** Cancels out a person's loans in opposite directions (7.9): shows each loan before and after, then saves. */
function CancelOutSheet({ rows, onClose }: { rows: LoanRow[]; onClose: () => void }) {
  const { ledger, today, wide, save } = useApp();
  const [busy, setBusy] = useState(false);
  const pairs = offsetPlan(ledger, rows.map((r) => r.id));
  const name = rows[0]?.a.name.trim() ?? '';
  const after = new Map(rows.map((r) => [r.id, r.s.balance]));
  for (const p of pairs) {
    after.set(p.from, after.get(p.from)! - p.amount);
    after.set(p.to, after.get(p.to)! + p.amount);
  }
  const touched = rows.filter((r) => after.get(r.id) !== r.s.balance);
  const totals = (['BDT', 'USD'] as const)
    .map((c) => [c, pairs.filter((p) => p.currency === c).reduce((s, p) => s + p.amount, 0)] as const)
    .filter(([, v]) => v > 0)
    .map(([c, v]) => fmtMoney(v, c))
    .join(' and ');
  const state = (r: LoanRow, bal: number) => (bal === 0 ? 'settled' : bal < 0 ? `you owe ${fmtMoney(-bal, r.a.currency)}` : `owes you ${fmtMoney(bal, r.a.currency)}`);

  async function confirm() {
    setBusy(true);
    const entries = cancelOut(pairs, today);
    const ok = await save(entries.map((e) => ({ id: e.id, type: 'entry' as const, value: e.value })), `Cancelled out ${totals} with ${name}`);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Sheet title={`Cancel out with ${name}`} onClose={onClose} wide={wide}>
      {pairs.length ? (
        <div className="col" style={{ gap: 14 }}>
          <p className="hint">
            {totals} is cancelled on both sides. No money changes hands, and nothing counts as spending or income.
          </p>
          <div className="rows">
            {touched.map((r) => (
              <div key={r.id} className="row">
                <Chip icon={ACCOUNT_ICONS[r.a.type] ?? 'person'} />
                <span className="row-main">
                  <span className="row-title">{loanTitle(r.a)}</span>
                  <span className="row-sub">
                    {state(r, r.s.balance)} → <b>{state(r, after.get(r.id)!)}</b>
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="small-muted">Oldest loans are cancelled first. To undo it, delete the "Cancelled out" entry in either loan's history.</p>
          <button className="btn block" disabled={busy} onClick={() => void confirm()}>
            Cancel out {totals}
          </button>
        </div>
      ) : (
        <p className="muted">There's nothing to cancel out with {name} right now.</p>
      )}
    </Sheet>
  );
}

export function LoanDetail({ id }: { id: string }) {
  const { ledger, wide, go, openAdd, save } = useApp();
  const a = ledger.accounts.get(id);
  const s = useMemo(() => (a ? loanSummary(ledger, id) : null), [ledger, id, a]);
  const [editing, setEditing] = useState(false);
  const others = useMemo(
    () =>
      a
        ? [...ledger.accounts]
            .filter(([oid, o]) => o.kind === 'loan' && oid !== id && !o.archived && personKey(o.name) === personKey(a.name))
            .map(([oid, o]) => ({ id: oid, a: o, s: loanSummary(ledger, oid) }))
        : [],
    [ledger, id, a],
  );
  if (!a || !s) return <div className="screen"><p className="muted">This loan account no longer exists.</p></div>;
  const owe = s.status === 'owe';
  const left = Math.abs(s.balance);
  const pct = s.cycleAmount ? Math.round((s.repaid / s.cycleAmount) * 100) : 0;
  const you = (
    <div className="party">
      <span className="avatar">You</span>You
    </div>
  );
  const them = (
    <div className="party">
      <span className="avatar">{initials(a.name)}</span>
      {a.name}
    </div>
  );
  const arrow = (
    <div className={`flow-arrow num ${owe ? 'neg' : 'pos'}`}>
      {fmtMoney(left, a.currency)}
      <svg viewBox="0 0 64 20" aria-hidden="true">
        <path d="M2 10h58M50 3l10 7-10 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );

  const summary = (
    <section className="card" style={{ gap: 16 }}>
      <p className="statement">
        {s.status === 'settled' ? (
          <>All settled with {a.name} ✓</>
        ) : owe ? (
          <>
            You owe {a.name} <span className="neg num">{fmtMoney(left, a.currency)}</span>
          </>
        ) : (
          <>
            {a.name} owes you <span className="pos num">{fmtMoney(left, a.currency)}</span>
          </>
        )}
      </p>
      {s.status !== 'settled' && (
        <>
          <div className="flow" role="img" aria-label={owe ? `Money goes from you to ${a.name}` : `Money comes from ${a.name} to you`}>
            {owe ? <>{you}{arrow}{them}</> : <>{them}{arrow}{you}</>}
          </div>
          <div className="progress">
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="loan-meta">
            <span>
              {fmtMoney(s.repaid, a.currency)} of {fmtMoney(s.cycleAmount, a.currency)} repaid ({pct}%)
            </span>
          </div>
        </>
      )}
      <div className="list-actions">
        {s.status !== 'settled' && (
          <button className="btn" onClick={() => openAdd({ kind: 'repay', loanId: id })}>Repay</button>
        )}
        <button className="btn ghost" onClick={() => openAdd({ kind: 'lend', loanId: id })}>Lend</button>
        <button className="btn ghost" onClick={() => openAdd({ kind: 'borrow', loanId: id })}>Borrow</button>
        {s.status !== 'settled' && <button className="btn ghost" onClick={() => openAdd({ kind: 'writeoff', loanId: id })}>Write off</button>}
        <button className="btn ghost" onClick={() => setEditing(true)}>
          <Icon name="edit" /> Edit
        </button>
        <button
          className="btn ghost"
          onClick={() => void save([{ id, type: 'account', value: { ...a, archived: !a.archived } }], a.archived ? `${accountLabel(a)} restored` : `${accountLabel(a)} archived`)}
        >
          <Icon name="archive" /> {a.archived ? 'Unarchive' : 'Archive'}
        </button>
      </div>
      {others.length > 0 && (
        <div className="also-with">
          <span className="small-muted">Also with {a.name.trim()}:</span>
          {others.map((o) => (
            <button key={o.id} className="link" onClick={() => go(`/loans/${o.id}`)}>
              {loanTitle(o.a)} ({o.s.status === 'settled' ? 'settled' : o.s.status === 'owe' ? `you owe ${fmtMoney(-o.s.balance, o.a.currency)}` : `owes you ${fmtMoney(o.s.balance, o.a.currency)}`})
            </button>
          ))}
        </div>
      )}
      {a.phone && <p className="small-muted">Phone: {a.phone}</p>}
      {a.note && <p className="small-muted">{a.note}</p>}
    </section>
  );

  const open = s.openItems.length > 0 && (
    <section className="card">
      <h2 className="h2">Open {owe ? 'borrowings' : 'loans'}</h2>
      <div className="rows">
        {s.openItems.map((it, i) => (
          <div key={i} className="row">
            <span className="row-main">
              <span className="row-title">
                {it.entryId ? (owe ? 'Borrowed' : 'Lent') : 'Before you started recording'} {fmtMoney(it.amount, a.currency)}
              </span>
              <span className="row-sub">{fmtDate(it.date)}</span>
              <span className="progress" style={{ marginTop: 6 }}>
                <span style={{ width: `${Math.round(((it.amount - it.remaining) / it.amount) * 100)}%` }} />
              </span>
            </span>
            <span className="row-amt num">
              {fmtMoney(it.remaining, a.currency)}
              <small>left</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );

  const timeline = (
    <section className="card timeline">
      <h2 className="h2">History with {a.name}</h2>
      {s.timeline.length || a.startingBalance ? (
        <div className="rows">
          {s.timeline
            .slice()
            .reverse()
            .map(([eid, e]) => (
              <EntryRow key={eid} id={eid} e={e} />
            ))}
          {a.startingBalance !== 0 && (
            <div className="row">
              <Chip icon="loans" />
              <span className="row-main">
                <span className="row-title">{a.startingBalance > 0 ? `${a.name} already owed you` : `You already owed ${a.name}`}</span>
                <span className="row-sub">{fmtDate(a.startDate)} · before you started recording</span>
              </span>
              <span className="row-amt num">{fmtMoney(Math.abs(a.startingBalance), a.currency)}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="muted">Nothing yet.</p>
      )}
    </section>
  );

  return (
    <div className="screen">
      <button className="back" onClick={() => go('/loans')}>
        <Icon name="back" /> Loans
      </button>
      <header className="top">
        <div>
          <p className="eyebrow">{a.purpose?.trim() ? `Loan with ${a.name.trim()}` : 'Loan'}</p>
          <h1 className="h1">{loanTitle(a)}</h1>
        </div>
      </header>
      {wide ? (
        <div className="wide-grid">
          <div className="col">{summary}{open}</div>
          <div className="col">{timeline}</div>
        </div>
      ) : (
        <>
          {summary}
          {open}
          {timeline}
        </>
      )}
      {editing && <AccountSheet kind="loan" id={id} onClose={() => setEditing(false)} />}
    </div>
  );
}
