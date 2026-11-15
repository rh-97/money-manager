import { useMemo, useState, type FormEvent } from 'react';
import { randomId } from '@mm/shared';
import { amountInputValue, fmtDate, fmtMoney, parseAmount } from '../lib/format.ts';
import { accountHistory, rateOn, toBDT } from '../money/calc.ts';
import type { Account, Currency, LoanAccountType, MoneyAccountType } from '../money/types.ts';
import { EntryRow, useApp, useBalances } from '../ui/ctx.tsx';
import { ACCOUNT_ICONS, Chip, Icon } from '../ui/icons.tsx';
import { Field, Secret, Sheet, useReveal } from '../ui/kit.tsx';

export const MONEY_TYPES: [MoneyAccountType, string][] = [
  ['bank', 'Bank'],
  ['wallet', 'Mobile wallet'],
  ['ewallet', 'E-wallet'],
  ['cash', 'Cash'],
  ['card', 'Credit card'],
  ['savings', 'Savings & investments'],
  ['other', 'Other'],
];
export const LOAN_TYPES: [LoanAccountType, string][] = [
  ['person', 'Person'],
  ['bank', 'Bank'],
  ['organization', 'Organization'],
  ['other', 'Other'],
];
export const typeLabel = (a: Account): string => (a.kind === 'money' ? MONEY_TYPES : LOAN_TYPES).find(([t]) => t === a.type)?.[1] ?? 'Other';

export function AccountsScreen() {
  const { ledger, today, wide, go } = useApp();
  const bals = useBalances();
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  // Totals stay hidden until the top card is tapped, so nobody sees them over your shoulder.
  const [showTotals, toggleTotals] = useReveal();
  // "Add up": pick any accounts to see their combined total. Only for this view; nothing is saved.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const togglePick = (ids: string[], on?: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      const add = on ?? !ids.every((i) => next.has(i));
      for (const i of ids) (add ? next.add(i) : next.delete(i));
      return next;
    });
  const money = [...ledger.accounts].filter(([, a]) => a.kind === 'money').sort(([, a], [, b]) => a.sortOrder - b.sortOrder);
  const visible = money.filter(([, a]) => showArchived || !a.archived);
  const archivedCount = money.filter(([, a]) => a.archived).length;
  // The Accounts page counts every money account; Home counts only those marked "count in the Home total".
  const inBDT = ([id, a]: (typeof money)[number]) => toBDT(ledger, bals.get(id) ?? 0, a.currency, today);
  const total = money.reduce((s, x) => s + inBDT(x), 0);
  const homeTotal = money.filter(([, a]) => a.includeInTotal).reduce((s, x) => s + inBDT(x), 0);
  const byType = MONEY_TYPES.map(([type, label]) => {
    const items = money.filter(([, a]) => a.type === type);
    return { type, label, count: items.length, sum: items.reduce((s, x) => s + inBDT(x), 0) };
  }).filter((t) => t.count > 0);
  const pickedRows = money.filter(([id]) => picked.has(id));
  const pickedSum = pickedRows.reduce((s, x) => s + inBDT(x), 0);
  const pickedHidden = pickedRows.some(([, a]) => a.hideBalance);
  const pickedUsd = pickedRows.some(([, a]) => a.currency === 'USD');
  const rate = rateOn(ledger, today);
  const hasUsd = money.some(([, a]) => a.currency === 'USD');

  return (
    <div className="screen">
      <header className="top">
        <div>
          <p className="eyebrow">{money.length} accounts</p>
          <h1 className="h1">Accounts</h1>
        </div>
        <div className="list-actions" style={{ margin: 0 }}>
          {money.length > 1 && (
            <button
              className="btn small ghost"
              aria-pressed={picking}
              onClick={() => {
                setPicking((v) => !v);
                setPicked(new Set());
              }}
            >
              <Icon name={picking ? 'x' : 'check'} /> {picking ? 'Done' : 'Add up'}
            </button>
          )}
          {!picking && (
            <button className="btn small ghost" onClick={() => setAdding(true)}>
              <Icon name="plus" /> Add
            </button>
          )}
        </div>
      </header>
      {picking && <p className="hint" style={{ margin: 0 }}>Tap accounts to add them up. Tap a group's name to pick the whole group. This doesn't change any other total.</p>}
      {money.length > 0 && (
        <section
          className="hero tappable"
          role="button"
          tabIndex={0}
          aria-label={showTotals ? 'Hide totals' : 'Show totals'}
          onClick={toggleTotals}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleTotals())}
        >
          <p className="hero-label">All my money</p>
          <p className="hero-amount num">{showTotals ? fmtMoney(total) : <span className="secret-dots">৳ ••••••</span>}</p>
          {!showTotals && (
            <p className="hero-hint">
              <Icon name="eye" /> Tap to show your totals
            </p>
          )}
          {showTotals && byType.length > 1 && (
            <div className="type-totals">
              {byType.map((t) => (
                <span key={t.type}>
                  <span className="lbl">{t.label}</span>
                  <b className="num">{fmtMoney(t.sum)}</b>
                </span>
              ))}
            </div>
          )}
          {showTotals && Math.round(homeTotal) !== Math.round(total) && (
            <p className="hero-sub">
              <span>
                Home shows <b className="num">{fmtMoney(homeTotal)}</b>, only the accounts you count in the Home total.
              </span>
            </p>
          )}
          {hasUsd && (
            <p className="hero-sub">
              Dollars counted at $1 = ৳{rate.rate.toFixed(2)} · {rate.source === 'own' ? 'your rate' : rate.source === 'auto' ? `automatic · ${rate.date === today ? 'updated today' : `from ${fmtDate(rate.date!)}`}` : 'estimate (no rate yet)'}
            </p>
          )}
        </section>
      )}
      {!money.length && (
        <section className="card">
          <div className="empty">
            <p className="h2">No accounts yet</p>
            <p>Add every place your money sits: banks, bKash, cash in your wallet, even the drawer.</p>
            <button className="btn" onClick={() => setAdding(true)}>Add an account</button>
          </div>
        </section>
      )}
      <div className={wide ? 'grid-auto acct-groups' : 'col'}>
        {MONEY_TYPES.map(([type, label]) => {
          const items = visible.filter(([, a]) => a.type === type);
          if (!items.length) return null;
          const sum = byType.find((t) => t.type === type)?.sum ?? 0;
          return (
            <div key={type} className="col" style={{ gap: 8 }}>
              <div className="group-head">
                {picking ? (
                  <button type="button" className="link group-pick" onClick={() => togglePick(items.map(([id]) => id))}>
                    {label}
                  </button>
                ) : (
                  <span>{label}</span>
                )}
                <span className="num">{showTotals ? fmtMoney(sum) : '••••••'}</span>
              </div>
              <section className="card" style={{ paddingBlock: 4 }}>
                <div className="rows">
                  {items.map(([id, a]) => {
                    const b = bals.get(id) ?? 0;
                    const hide = Boolean(a.hideBalance);
                    return (
                      <button
                        key={id}
                        className={`row acct-row${picking && picked.has(id) ? ' picked' : ''}`}
                        aria-pressed={picking ? picked.has(id) : undefined}
                        onClick={() => (picking ? togglePick([id]) : go(`/accounts/${id}`))}
                      >
                        {picking && <span className="pick-box" aria-hidden="true">{picked.has(id) && <Icon name="check" />}</span>}
                        <Chip icon={ACCOUNT_ICONS[a.type] ?? 'wallet'} slot={a.slot} />
                        <span className="row-main">
                          <span className="row-title">{a.name}</span>
                          <span className="row-sub">
                            {a.archived ? 'Archived · ' : ''}
                            {a.type === 'savings' && a.maturityDate ? `${a.interestRate ? `${a.interestRate}% · ` : ''}matures ${fmtDate(a.maturityDate, { month: 'short', year: 'numeric' })}` : a.currency === 'USD' && !hide ? `≈ ${fmtMoney(toBDT(ledger, b, 'USD', today))}` : a.includeInTotal ? typeLabel(a) : 'Not in the Home total'}
                          </span>
                        </span>
                        <span className={`row-amt num ${b < 0 ? 'neg' : ''}`}>
                          <Secret hidden={hide} label={`${a.name} balance`}>
                            {fmtMoney(b, a.currency)}
                          </Secret>
                          {a.type === 'card' && b < 0 && !hide && <small>owed on card</small>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          );
        })}
      </div>
      {picking && (
        <div className="pick-bar" role="status" aria-live="polite">
          <span className="pick-count">
            {picked.size ? `${picked.size} selected` : 'Nothing selected'}
          </span>
          <b className="num pick-sum">
            <Secret hidden={pickedHidden} label="selected total">
              {(pickedUsd ? '≈ ' : '') + fmtMoney(pickedSum)}
            </Secret>
          </b>
          {picked.size > 0 && (
            <button className="link" onClick={() => setPicked(new Set())}>
              Clear
            </button>
          )}
        </div>
      )}
      {archivedCount > 0 && (
        <button className="link" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? 'Hide' : 'Show'} {archivedCount} archived
        </button>
      )}
      {adding && <AccountSheet kind="money" onClose={() => setAdding(false)} />}
    </div>
  );
}

export function AccountDetail({ id }: { id: string }) {
  const { ledger, today, wide, go, openAdd, save } = useApp();
  const bals = useBalances();
  const a = ledger.accounts.get(id);
  const history = useMemo(() => (a ? accountHistory(ledger, id) : []), [ledger, id, a]);
  const [editing, setEditing] = useState(false);
  const [showBalance, toggleBalance] = useReveal();
  if (!a) return <div className="screen"><p className="muted">This account no longer exists.</p></div>;
  if (a.kind === 'loan')
    return (
      <div className="screen">
        <button className="link" onClick={() => go(`/loans/${id}`)}>Open {a.name} in Loans</button>
      </div>
    );
  const b = bals.get(id) ?? 0;
  const card = (
    <section className="card" style={{ gap: 6 }}>
      <Chip icon={ACCOUNT_ICONS[a.type] ?? 'wallet'} slot={a.slot} />
      <p className="muted" style={{ margin: '6px 0 0' }}>
        {a.name} · {typeLabel(a)}
        {a.archived ? ' · Archived' : ''}
      </p>
      <p className={`hero-amount num ${b < 0 ? 'neg' : ''}`} style={{ margin: 0 }}>
        <Secret hidden={Boolean(a.hideBalance)} shown={showBalance} onToggle={toggleBalance} label="balance">
          {fmtMoney(b, a.currency)}
        </Secret>
      </p>
      {a.currency === 'USD' && (!a.hideBalance || showBalance) && <p className="hint">≈ {fmtMoney(toBDT(ledger, b, 'USD', today))}</p>}
      {a.type === 'card' && b < 0 && <p className="hint">Owed on this card. Pay the bill with a transfer from a bank.</p>}
      {a.type === 'savings' && (a.interestRate || a.maturityDate) && (
        <p className="hint">
          {a.interestRate ? `${a.interestRate}% a year` : ''}
          {a.interestRate && a.maturityDate ? ' · ' : ''}
          {a.maturityDate ? `matures ${fmtDate(a.maturityDate)}` : ''}
        </p>
      )}
      {a.note && <p className="hint">{a.note}</p>}
      <div className="list-actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => openAdd({ kind: 'expense', accountId: id })}>Add entry</button>
        <button className="btn ghost" onClick={() => openAdd({ kind: 'correction', accountId: id })}>
          <Icon name="scale" /> Correct balance
        </button>
        <button className="btn ghost" onClick={() => setEditing(true)}>
          <Icon name="edit" /> Edit
        </button>
        <button className="btn ghost" onClick={() => void save([{ id, type: 'account', value: { ...a, archived: !a.archived } }], a.archived ? `${a.name} restored` : `${a.name} archived`)}>
          <Icon name="archive" /> {a.archived ? 'Unarchive' : 'Archive'}
        </button>
      </div>
    </section>
  );
  const list = (
    <section className="card">
      <h2 className="h2">History</h2>
      {history.length ? (
        <div className="rows">
          {history.map(([eid, e]) => (
            <EntryRow key={eid} id={eid} e={e} />
          ))}
        </div>
      ) : (
        <p className="muted">No entries yet.{a.hideBalance ? '' : ` Starting balance ${fmtMoney(a.startingBalance, a.currency)} on ${fmtDate(a.startDate)}.`}</p>
      )}
    </section>
  );
  return (
    <div className="screen">
      <button className="back" onClick={() => go('/accounts')}>
        <Icon name="back" /> Accounts
      </button>
      {wide ? (
        <div className="wide-grid">
          <div className="col">{card}</div>
          <div className="col">{list}</div>
        </div>
      ) : (
        <>
          {card}
          {list}
        </>
      )}
      {editing && <AccountSheet kind="money" id={id} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** Create or edit a money account or a loan account. */
export function AccountSheet({ kind, id, onClose, onCreated, initialDirection }: { kind: 'money' | 'loan'; id?: string; onClose: () => void; onCreated?: (id: string) => void; initialDirection?: 'owed' | 'owe' }) {
  const { ledger, today, wide, save, go } = useApp();
  const existing = id ? ledger.accounts.get(id) : undefined;
  const hasEntries = id ? [...ledger.entries.values()].some((e) => e.accountId === id || e.toAccountId === id) : false;
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<string>(existing?.type ?? (kind === 'money' ? 'bank' : 'person'));
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? 'BDT');
  const [direction, setDirection] = useState<'owed' | 'owe'>(existing ? (existing.startingBalance < 0 ? 'owe' : 'owed') : (initialDirection ?? 'owed'));
  const startAbs = existing ? Math.abs(existing.startingBalance) : 0;
  const [balance, setBalance] = useState(existing ? amountInputValue(kind === 'loan' ? startAbs : existing.startingBalance) : '');
  const [startDate, setStartDate] = useState(existing?.startDate ?? ledger.settings.startDate ?? today);
  const [include, setInclude] = useState(existing?.includeInTotal ?? true);
  const [hideBalance, setHideBalance] = useState(existing?.hideBalance ?? false);
  const [slot, setSlot] = useState(existing?.slot ?? 1 + (ledger.accounts.size % 6));
  const [note, setNote] = useState(existing?.note ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [rate, setRate] = useState(existing?.interestRate ? String(existing.interestRate) : '');
  const [maturity, setMaturity] = useState(existing?.maturityDate ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Give it a name.');
    const bal = balance.trim() === '' ? 0 : parseAmount(balance, true);
    if (bal === null) return setError('The balance should be a number, like 15000 or 1250.50.');
    if (kind === 'loan' && bal < 0) return setError('Enter the amount without a minus sign, and choose who owes whom.');
    const startingBalance = kind === 'loan' ? (direction === 'owe' ? -Math.abs(bal) : Math.abs(bal)) : type === 'card' && bal > 0 ? -bal : bal;
    const value: Account = {
      kind,
      type: type as Account['type'],
      name: name.trim(),
      currency,
      startingBalance,
      startDate,
      includeInTotal: kind === 'money' ? include : true,
      hideBalance: kind === 'money' && hideBalance ? true : undefined,
      archived: existing?.archived ?? false,
      slot,
      note: note.trim() || undefined,
      phone: kind === 'loan' ? phone.trim() || undefined : undefined,
      interestRate: type === 'savings' && rate ? Number(rate) : undefined,
      maturityDate: type === 'savings' && maturity ? maturity : undefined,
      sortOrder: existing?.sortOrder ?? ledger.accounts.size,
    };
    setBusy(true);
    const newId = id ?? randomId();
    const ok = await save([{ id: newId, type: 'account', value }], id ? 'Saved' : `${value.name} added`);
    setBusy(false);
    if (ok) {
      onClose();
      if (!id) onCreated?.(newId);
    }
  }

  async function remove() {
    if (!id) return;
    const ok = await save([{ id, delete: true }], `${existing?.name} deleted`);
    if (ok) {
      onClose();
      go(kind === 'loan' ? '/loans' : '/accounts');
    }
  }

  const types = kind === 'money' ? MONEY_TYPES : LOAN_TYPES;
  return (
    <Sheet title={id ? `Edit ${existing?.name}` : kind === 'money' ? 'New account' : 'Add an existing loan'} onClose={onClose} wide={wide}>
      <form className="col" style={{ gap: 12 }} onSubmit={submit}>
        {kind === 'loan' && !id && (
          <p className="hint">
            For money that was already owed before you started recording. No money account changes, so <b>Money I have</b> and the Accounts total stay the same; only the loan totals and net worth include it.
          </p>
        )}
        <Field label="Name" htmlFor="a-name">
          <input id="a-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'money' ? 'e.g. City Bank Salary, bKash, Cash (drawer)' : 'e.g. Rahim, BRAC Bank home loan'} autoFocus={!id} />
        </Field>
        <div className="two">
          <Field label="Type" htmlFor="a-type">
            <select id="a-type" value={type} onChange={(e) => setType(e.target.value)}>
              {types.map(([t, l]) => (
                <option key={t} value={t}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Currency" htmlFor="a-cur" hint={hasEntries ? 'Locked: this account has entries.' : undefined}>
            <select id="a-cur" value={currency} disabled={hasEntries} onChange={(e) => setCurrency(e.target.value as Currency)}>
              <option value="BDT">৳ Taka (BDT)</option>
              <option value="USD">$ Dollar (USD)</option>
            </select>
          </Field>
        </div>
        {kind === 'loan' && (
          <div className="field">
            <label>Who owes whom</label>
            <div className="cat-pick">
              <button type="button" aria-pressed={direction === 'owed'} onClick={() => setDirection('owed')}>They owe me</button>
              <button type="button" aria-pressed={direction === 'owe'} onClick={() => setDirection('owe')}>I owe them</button>
            </div>
          </div>
        )}
        <div className="two">
          <Field
            label={kind === 'loan' ? 'Amount already owed' : type === 'card' ? 'Amount owed on the card' : 'Balance'}
            htmlFor="a-bal"
            hint={kind === 'loan' ? 'Leave 0 if you are starting a new loan now.' : 'On the start date.'}
          >
            <input id="a-bal" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Start date" htmlFor="a-date">
            <input id="a-date" type="date" value={startDate} max={today} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
        </div>
        {type === 'savings' && kind === 'money' && (
          <div className="two">
            <Field label="Interest rate (% a year)" htmlFor="a-rate">
              <input id="a-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 9.5" />
            </Field>
            <Field label="Maturity date" htmlFor="a-mat">
              <input id="a-mat" type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} />
            </Field>
          </div>
        )}
        {kind === 'loan' && (
          <Field label="Phone (optional)" htmlFor="a-phone">
            <input id="a-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        )}
        {kind === 'money' && (
          <div className="field">
            <label>Colour</label>
            <div className="cat-pick">
              {[1, 2, 3, 4, 5, 6].map((s) => (
                <button key={s} type="button" aria-pressed={slot === s} aria-label={`Colour ${s}`} onClick={() => setSlot(s)}>
                  <span className="swatch" style={{ width: 14, height: 14, borderRadius: 4, background: `var(--c${s})` }} />
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Note (optional)" htmlFor="a-note" hint="Don't store full account or card numbers.">
          <input id="a-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {kind === 'money' && (
          <label className="check-row">
            <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} />
            <span>Count this in the Home total. Turn it off for savings you don't want to see every day, or money held for someone. The Accounts page always counts every account.</span>
          </label>
        )}
        {kind === 'money' && (
          <label className="check-row">
            <input type="checkbox" checked={hideBalance} onChange={(e) => setHideBalance(e.target.checked)} />
            <span>Hide the balance until I tap it, so people nearby can't see it.</span>
          </label>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn block" type="submit" disabled={busy}>{id ? 'Save' : 'Add'}</button>
        {id && !hasEntries && !confirmDelete && (
          <button type="button" className="link" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" /> Delete this account
          </button>
        )}
        {id && hasEntries && <p className="small-muted">This account has entries, so it can be archived but not deleted.</p>}
        {confirmDelete && (
          <div className="banner">
            <span>Delete {existing?.name}? This can't be undone.</span>
            <button type="button" className="btn small danger" onClick={() => void remove()}>Delete</button>
          </div>
        )}
      </form>
    </Sheet>
  );
}
