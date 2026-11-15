import { useMemo, useState, type FormEvent } from 'react';
import { randomId } from '@mm/shared';
import { amountInputValue, fmtMoney, parseAmount } from '../lib/format.ts';
import { effects, loanSummary } from '../money/calc.ts';
import { correction, expenseOrIncome, repay, transfer, writeOff, type NewEntry } from '../money/actions.ts';
import type { Account, Settings } from '../money/types.ts';
import { useApp, useBalances, type AddKind, type AddPreset, type Change } from '../ui/ctx.tsx';
import { Icon } from '../ui/icons.tsx';
import { AmountInput, Field, Sheet } from '../ui/kit.tsx';

/** Lend/borrow without a money account: a loan that was already owed before. */
const NO_ACCOUNT = 'none';

const TYPES: [AddKind, string, string, string][] = [
  ['expense', 'Expense', 'out', 'Money spent'],
  ['income', 'Income', 'in', 'Salary, other'],
  ['transfer', 'Transfer', 'transfer', 'Between accounts'],
  ['lend', 'Lend', 'out', 'Give a loan'],
  ['borrow', 'Borrow', 'in', 'Take a loan'],
  ['repay', 'Repay', 'check', 'Pay back or get back'],
];
const MORE: [AddKind, string, string, string][] = [
  ['exchange', 'Exchange', 'swap', '৳ and $'],
  ['correction', 'Correction', 'scale', 'Fix a balance'],
  ['writeoff', 'Write off', 'gift', 'Forgive a loan'],
];
const TITLES: Record<AddKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  exchange: 'Currency exchange',
  lend: 'Lend',
  borrow: 'Borrow',
  repay: 'Repay',
  writeoff: 'Write off',
  correction: 'Correct balance',
};

export function AddSheet({ preset, onClose }: { preset: AddPreset; onClose: () => void }) {
  const { wide } = useApp();
  const [kind, setKind] = useState<AddKind | null>(preset.kind ?? null);
  if (!kind)
    return (
      <Sheet title="What happened?" onClose={onClose} wide={wide}>
        <div className="type-grid">
          {TYPES.map(([k, l, ic, sub]) => (
            <button key={k} className="type-btn" onClick={() => setKind(k)}>
              <Icon name={ic} />
              {l}
              <small>{sub}</small>
            </button>
          ))}
        </div>
        <p className="type-sub">More</p>
        <div className="type-grid">
          {MORE.map(([k, l, ic, sub]) => (
            <button key={k} className="type-btn" onClick={() => setKind(k)}>
              <Icon name={ic} />
              {l}
              <small>{sub}</small>
            </button>
          ))}
        </div>
      </Sheet>
    );
  return (
    <Sheet title={TITLES[kind]} onClose={onClose} onBack={preset.kind ? undefined : () => setKind(null)} wide={wide} label={`Add ${TITLES[kind]}`}>
      <EntryForm kind={kind} preset={preset} onDone={onClose} />
    </Sheet>
  );
}

function EntryForm({ kind, preset, onDone }: { kind: AddKind; preset: AddPreset; onDone: () => void }) {
  const { ledger, today, save } = useApp();
  const bals = useBalances();
  const accounts = [...ledger.accounts].sort(([, a], [, b]) => a.sortOrder - b.sortOrder);
  const money = accounts.filter(([, a]) => a.kind === 'money' && (!a.archived || a === ledger.accounts.get(preset.accountId ?? '')));
  const loans = accounts.filter(([, a]) => a.kind === 'loan' && !a.archived);
  const openLoans = useMemo(() => loans.map(([id, a]) => ({ id, a, s: loanSummary(ledger, id) })).filter((x) => x.s.status !== 'settled'), [ledger, loans.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Most-used categories first; the rest behind "More".
  const usage = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of ledger.entries.values()) if (e.categoryId && !e.parentId) n.set(e.categoryId, (n.get(e.categoryId) ?? 0) + 1);
    return n;
  }, [ledger]);
  const cats = [...ledger.categories]
    .filter(([, c]) => !c.hidden && c.system !== 'writeoff' && c.kind === (kind === 'income' ? 'income' : 'expense'))
    .sort(([ia, a], [ib, b]) => (usage.get(ib) ?? 0) - (usage.get(ia) ?? 0) || a.sortOrder - b.sortOrder);
  const [allCats, setAllCats] = useState(false);

  const presetMoney = preset.accountId && ledger.accounts.get(preset.accountId)?.kind === 'money' ? preset.accountId : undefined;
  const firstUsd = money.find(([, a]) => a.currency === 'USD')?.[0];
  const firstBdt = money.find(([, a]) => a.currency === 'BDT')?.[0];
  const [accountId, setAccountId] = useState<string>(presetMoney ?? (kind === 'exchange' ? (firstUsd ?? money[0]?.[0]) : money[0]?.[0]) ?? '');
  const [toAccountId, setToAccountId] = useState<string>((kind === 'exchange' ? firstBdt : money.find(([id]) => id !== accountId)?.[0]) ?? '');
  const [loanId, setLoanId] = useState<string>(preset.loanId ?? (kind === 'repay' || kind === 'writeoff' ? (openLoans[0]?.id ?? '') : (loans[0]?.[0] ?? 'new')));
  const [newLoanName, setNewLoanName] = useState('');
  const [newLoanType, setNewLoanType] = useState<Account['type']>('person');
  const [categoryId, setCategoryId] = useState<string>(cats[0]?.[0] ?? '');
  const loanForRepay = openLoans.find((x) => x.id === loanId);
  const [amount, setAmount] = useState(kind === 'repay' && loanForRepay ? amountInputValue(Math.abs(loanForRepay.s.balance)) : '');
  const [toAmount, setToAmount] = useState('');
  const [fee, setFee] = useState('');
  const [interest, setInterest] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [asGift, setAsGift] = useState(false);
  const [useRate, setUseRate] = useState(true);
  const [real, setReal] = useState(() => (presetMoney ? amountInputValue(bals.get(presetMoney) ?? 0) : ''));
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const acct = ledger.accounts.get(accountId);
  const toAcct = ledger.accounts.get(toAccountId);
  const loan = loanId === 'new' ? undefined : ledger.accounts.get(loanId);
  const sym = (a?: Account) => (a?.currency === 'USD' ? '$' : '৳');

  if (!money.length && kind !== 'writeoff')
    return (
      <div className="empty">
        <p>Add an account first: a bank, bKash or your cash.</p>
      </div>
    );

  /** For lend/borrow: from and to, in transfer terms. */
  function loanEnds(): { from: string; to: string; fromCur: string; toCur: string } {
    const loanCur = loan?.currency ?? acct?.currency ?? 'BDT';
    return kind === 'lend' ? { from: accountId, to: loanId, fromCur: acct!.currency, toCur: loanCur } : { from: loanId, to: accountId, fromCur: loanCur, toCur: acct!.currency };
  }
  const loanCurrencyDiffers = (kind === 'lend' || kind === 'borrow') && loan && acct && loan.currency !== acct.currency;
  const transferCurrencyDiffers = (kind === 'transfer' || kind === 'exchange') && acct && toAcct && acct.currency !== toAcct.currency;

  function build(): { entries: NewEntry[]; extra: Change[] } | string {
    const amt = parseAmount(amount);
    const feeAmt = fee.trim() ? parseAmount(fee) : 0;
    if (feeAmt === null) return 'The fee should be a number.';
    const extra: Change[] = [];
    switch (kind) {
      case 'expense':
      case 'income':
        if (!amt) return 'Enter an amount.';
        if (!categoryId) return 'Choose a category.';
        return { entries: expenseOrIncome({ kind, date, amount: amt, accountId, categoryId, note: note.trim() }), extra };
      case 'transfer':
      case 'exchange': {
        if (!amt) return 'Enter an amount.';
        if (!toAccountId || toAccountId === accountId) return 'Choose two different accounts.';
        let to: number | undefined;
        if (transferCurrencyDiffers) {
          const t = parseAmount(toAmount);
          if (!t) return `Enter the amount received in ${toAcct!.currency === 'USD' ? 'dollars' : 'taka'}.`;
          to = t;
          if (useRate) {
            const bdtPerUsd = acct!.currency === 'USD' ? t / amt : amt / t;
            extra.push(...ownRateChange(ledger.settings, ledger.settingsId, Math.round(bdtPerUsd * 100) / 100, date));
          }
        }
        return { entries: transfer(ledger.categories, { date, amount: amt, from: accountId, to: toAccountId, toAmount: to, fee: feeAmt ?? 0, feeAccountId: accountId, note: note.trim() }), extra };
      }
      case 'lend':
      case 'borrow': {
        if (!amt) return 'Enter an amount.';
        if (accountId === NO_ACCOUNT) {
          // Owed from before: no money moves, so only the loan's starting balance changes.
          const signed = kind === 'lend' ? amt : -amt;
          if (loanId === 'new') {
            if (!newLoanName.trim()) return kind === 'lend' ? 'Who owes you?' : 'Who do you owe?';
            const value: Account = { kind: 'loan', type: newLoanType, name: newLoanName.trim(), currency: 'BDT', startingBalance: signed, startDate: date < today ? date : today, includeInTotal: true, archived: false, slot: 0, sortOrder: ledger.accounts.size };
            return { entries: [], extra: [{ id: randomId(), type: 'account', value }] };
          }
          if (!loan) return 'Choose a loan.';
          const value: Account = { ...loan, startingBalance: loan.startingBalance + signed, startDate: date < loan.startDate ? date : loan.startDate };
          return { entries: [], extra: [{ id: loanId, type: 'account', value }] };
        }
        let lid = loanId;
        if (loanId === 'new') {
          if (!newLoanName.trim()) return kind === 'lend' ? 'Who are you lending to?' : 'Who are you borrowing from?';
          lid = randomId();
          const value: Account = { kind: 'loan', type: newLoanType, name: newLoanName.trim(), currency: acct!.currency, startingBalance: 0, startDate: date < today ? date : today, includeInTotal: true, archived: false, slot: 0, sortOrder: ledger.accounts.size };
          extra.push({ id: lid, type: 'account', value });
        }
        let to: number | undefined;
        if (loanCurrencyDiffers) {
          const t = parseAmount(toAmount);
          if (!t) return 'Enter the amount in the other currency too.';
          to = t;
        }
        const ends = kind === 'lend' ? { from: accountId, to: lid } : { from: lid, to: accountId };
        return { entries: transfer(ledger.categories, { date, amount: amt, ...ends, toAmount: to, fee: feeAmt ?? 0, feeAccountId: accountId, loanAction: kind, note: note.trim() }), extra };
      }
      case 'repay': {
        if (!loanForRepay) return 'Choose a loan.';
        if (!amt) return 'Enter the amount paid.';
        if (loanForRepay.a.currency !== acct!.currency) return `This loan is in ${loanForRepay.a.currency === 'USD' ? 'dollars' : 'taka'}. Choose a ${loanForRepay.a.currency} account.`;
        const int = interest.trim() ? parseAmount(interest) : 0;
        if (int === null) return 'The interest should be a number.';
        try {
          return { entries: repay(ledger.categories, { date, loanId, moneyId: accountId, loanBalance: loanForRepay.s.balance, amount: amt, interest: int, fee: feeAmt ?? 0, note: note.trim() }), extra };
        } catch (err) {
          return (err as Error).message.replace('That is more than what is left on this loan.', `That's more than the ${fmtMoney(Math.abs(loanForRepay.s.balance), loanForRepay.a.currency)} left on this loan.`);
        }
      }
      case 'writeoff': {
        if (!loanForRepay) return 'Choose a loan.';
        return { entries: writeOff(ledger.categories, { date, loanId, loanBalance: loanForRepay.s.balance, asGift, note: note.trim() }), extra };
      }
      case 'correction': {
        const r = parseAmount(real, true);
        if (r === null) return 'Enter the real balance.';
        try {
          return { entries: correction({ date, accountId, current: bals.get(accountId) ?? 0, real: r }), extra };
        } catch (err) {
          return (err as Error).message;
        }
      }
    }
  }

  function checkWarnings(entries: NewEntry[]): string[] {
    const out: string[] = [];
    if (date > today) out.push('The date is in the future.');
    const after = new Map(bals);
    for (const { value } of entries) for (const { accountId: id, delta } of effects(value)) after.set(id, (after.get(id) ?? 0) + delta);
    for (const [id, v] of after) {
      const a = ledger.accounts.get(id);
      if (!a || a.kind !== 'money' || a.type === 'card' || kind === 'correction') continue;
      if (v < 0 && (bals.get(id) ?? 0) >= 0) out.push(`${a.name} would go below zero (${fmtMoney(v, a.currency)}).`);
    }
    return out;
  }

  async function submit(e: FormEvent, force = false) {
    e.preventDefault();
    setError(null);
    const r = build();
    if (typeof r === 'string') return setError(r);
    if (!force) {
      const w = checkWarnings(r.entries);
      if (w.length) return setWarnings(w);
    }
    setBusy(true);
    const changes: Change[] = [...r.extra, ...r.entries.map((n) => ({ id: n.id, type: 'entry' as const, value: n.value }))];
    const main = r.entries[0]?.value;
    const msg = !main
      ? 'Loan from before added'
      : kind === 'expense' || kind === 'income'
        ? `Saved ${fmtMoney(main.kind === 'income' ? main.amount : -main.amount, acct?.currency, { sign: true })} · ${ledger.categories.get(categoryId)?.name ?? ''}`
        : kind === 'correction'
          ? `${acct?.name} corrected by ${fmtMoney(main.amount, acct?.currency, { sign: true })}`
          : 'Saved';
    const ok = await save(changes, msg);
    setBusy(false);
    if (ok) onDone();
  }

  const accountSelect = (id: string, label: string, value: string, set: (v: string) => void, exclude?: string) => (
    <Field label={label} htmlFor={id}>
      <select id={id} value={value} onChange={(e) => set(e.target.value)}>
        {money
          .filter(([aid]) => aid !== exclude)
          .map(([aid, a]) => (
            <option key={aid} value={aid}>
              {a.hideBalance ? a.name : `${a.name} (${fmtMoney(bals.get(aid) ?? 0, a.currency)})`}
            </option>
          ))}
      </select>
    </Field>
  );
  const dateField = (
    <Field label="Date" htmlFor="f-date">
      <input id="f-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
    </Field>
  );
  const noteField = (placeholder: string) => (
    <Field label="Note (optional)" htmlFor="f-note">
      <input id="f-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} />
    </Field>
  );
  const feeField = (
    <Field label="Fee (optional)" htmlFor="f-fee" hint="e.g. bKash cash-out or bank charge. Counted as spending.">
      <input id="f-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0" />
    </Field>
  );

  let fields;
  switch (kind) {
    case 'expense':
    case 'income':
      fields = (
        <>
          <AmountInput id="f-amt" value={amount} onChange={setAmount} symbol={sym(acct)} autoFocus />
          <div className="field">
            <label>Category</label>
            <div className="cat-pick">
              {(allCats ? cats : cats.slice(0, 8).concat(cats.slice(8).filter(([cid]) => cid === categoryId))).map(([cid, c]) => (
                <button key={cid} type="button" aria-pressed={categoryId === cid} onClick={() => setCategoryId(cid)}>
                  <span className="swatch" style={{ width: 8, height: 8, borderRadius: 2, background: c.slot ? `var(--c${c.slot})` : 'var(--c-other)' }} />
                  {c.name}
                </button>
              ))}
              {!allCats && cats.length > 8 && (
                <button type="button" onClick={() => setAllCats(true)}>
                  More…
                </button>
              )}
            </div>
          </div>
          <div className="two">
            {accountSelect('f-acct', kind === 'expense' ? 'Paid from' : 'Received into', accountId, setAccountId)}
            {dateField}
          </div>
          {noteField(kind === 'expense' ? 'e.g. Shoes, Bata' : 'e.g. November salary')}
        </>
      );
      break;
    case 'transfer':
    case 'exchange':
      fields = (
        <>
          <AmountInput id="f-amt" value={amount} onChange={setAmount} symbol={sym(acct)} label="Amount sent" autoFocus />
          <div className="two">
            {accountSelect('f-acct', 'From', accountId, setAccountId)}
            {accountSelect('f-to', 'To', toAccountId, setToAccountId, accountId)}
          </div>
          {transferCurrencyDiffers && (
            <>
              <Field label={`Amount received (${sym(toAcct)})`} htmlFor="f-recv">
                <input id="f-recv" inputMode="decimal" value={toAmount} onChange={(e) => setToAmount(e.target.value)} />
              </Field>
              <label className="check-row">
                <input type="checkbox" checked={useRate} onChange={(e) => setUseRate(e.target.checked)} />
                <span>Use this exchange's rate as my dollar rate from now on</span>
              </label>
            </>
          )}
          <div className="two">
            {feeField}
            {dateField}
          </div>
          {noteField('Optional')}
        </>
      );
      break;
    case 'lend':
    case 'borrow':
      fields = (
        <>
          <AmountInput id="f-amt" value={amount} onChange={setAmount} symbol={sym(accountId === NO_ACCOUNT ? loan : kind === 'lend' ? acct : (loan ?? acct))} autoFocus />
          <Field label={kind === 'lend' ? 'Lend to' : 'Borrow from'} htmlFor="f-loan">
            <select id="f-loan" value={loanId} onChange={(e) => setLoanId(e.target.value)}>
              {loans.map(([lid, a]) => {
                const s = loanSummary(ledger, lid);
                return (
                  <option key={lid} value={lid}>
                    {a.name}
                    {s.status === 'settled' ? ' (settled)' : ` (${s.status === 'owe' ? 'you owe' : 'owes you'} ${fmtMoney(Math.abs(s.balance), a.currency)})`}
                  </option>
                );
              })}
              <option value="new">+ New person or organization…</option>
            </select>
          </Field>
          {loanId === 'new' && (
            <div className="two">
              <Field label="Name" htmlFor="f-newloan">
                <input id="f-newloan" value={newLoanName} onChange={(e) => setNewLoanName(e.target.value)} placeholder="e.g. Rahim" />
              </Field>
              <Field label="Type" htmlFor="f-newtype">
                <select id="f-newtype" value={newLoanType} onChange={(e) => setNewLoanType(e.target.value as Account['type'])}>
                  <option value="person">Person</option>
                  <option value="bank">Bank</option>
                  <option value="organization">Organization</option>
                  <option value="other">Other</option>
                </select>
              </Field>
            </div>
          )}
          <div className="two">
            <Field label={kind === 'lend' ? 'From account' : 'Into account'} htmlFor="f-acct">
              <select id="f-acct" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {money.map(([aid, a]) => (
                  <option key={aid} value={aid}>
                    {a.hideBalance ? a.name : `${a.name} (${fmtMoney(bals.get(aid) ?? 0, a.currency)})`}
                  </option>
                ))}
                <option value={NO_ACCOUNT}>None (owed from before)</option>
              </select>
            </Field>
            {dateField}
          </div>
          {accountId === NO_ACCOUNT && (
            <p className="hint">
              No money moves now, so <b>Money I have</b> and the Accounts total stay the same. {kind === 'lend' ? 'It adds to what they owe you.' : 'It adds to what you owe them.'}
            </p>
          )}
          {loanCurrencyDiffers && (
            <Field label={`Amount in ${kind === 'lend' ? loan!.currency : acct!.currency}`} htmlFor="f-recv" hint="The loan and the account use different currencies.">
              <input id="f-recv" inputMode="decimal" value={toAmount} onChange={(e) => setToAmount(e.target.value)} />
            </Field>
          )}
          {kind === 'lend' && accountId !== NO_ACCOUNT && feeField}
          {noteField('Optional')}
        </>
      );
      void loanEnds;
      break;
    case 'repay':
      fields = openLoans.length ? (
        <>
          <Field label="Loan" htmlFor="f-loan">
            <select
              id="f-loan"
              value={loanId}
              onChange={(e) => {
                setLoanId(e.target.value);
                const l = openLoans.find((x) => x.id === e.target.value);
                if (l) setAmount(amountInputValue(Math.abs(l.s.balance)));
              }}
            >
              {openLoans.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.a.name} ({x.s.status === 'owe' ? 'you owe' : 'owes you'} {fmtMoney(Math.abs(x.s.balance), x.a.currency)})
                </option>
              ))}
            </select>
          </Field>
          {loanForRepay && (
            <p className="hint">
              {loanForRepay.s.status === 'owe'
                ? `You owe ${loanForRepay.a.name} ${fmtMoney(Math.abs(loanForRepay.s.balance), loanForRepay.a.currency)}. Pay part or all of it.`
                : `${loanForRepay.a.name} owes you ${fmtMoney(loanForRepay.s.balance, loanForRepay.a.currency)}. Record what they paid back.`}
            </p>
          )}
          <AmountInput id="f-amt" value={amount} onChange={setAmount} symbol={sym(loanForRepay?.a)} label="Amount paid" />
          <div className="two">
            {accountSelect('f-acct', loanForRepay?.s.status === 'owe' ? 'Paid from' : 'Received into', accountId, setAccountId)}
            {dateField}
          </div>
          <div className="two">
            <Field label="Of which interest (optional)" htmlFor="f-int" hint="For bank EMIs. The rest reduces the loan.">
              <input id="f-int" inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="0" />
            </Field>
            {feeField}
          </div>
        </>
      ) : (
        <div className="empty">
          <p>No open loans. You owe nobody, and nobody owes you.</p>
        </div>
      );
      break;
    case 'writeoff':
      fields = openLoans.length ? (
        <>
          <Field label="Loan" htmlFor="f-loan">
            <select id="f-loan" value={loanId} onChange={(e) => setLoanId(e.target.value)}>
              {openLoans.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.a.name} ({x.s.status === 'owe' ? 'you owe' : 'owes you'} {fmtMoney(Math.abs(x.s.balance), x.a.currency)})
                </option>
              ))}
            </select>
          </Field>
          <p className="hint">
            {loanForRepay?.s.status === 'owed'
              ? `Clears the ${fmtMoney(loanForRepay.s.balance, loanForRepay.a.currency)} ${loanForRepay.a.name} still owes you, and records it as spending.`
              : loanForRepay
                ? `Use this if ${loanForRepay.a.name} forgave what you owe. It's recorded as a gift (income).`
                : ''}
          </p>
          {loanForRepay?.s.status === 'owed' && (
            <label className="check-row">
              <input type="checkbox" checked={asGift} onChange={(e) => setAsGift(e.target.checked)} />
              <span>Record it as a gift instead of a written-off loan</span>
            </label>
          )}
          {dateField}
        </>
      ) : (
        <div className="empty">
          <p>No open loans to write off.</p>
        </div>
      );
      break;
    case 'correction':
      fields = (
        <>
          {accountSelect('f-acct', 'Account', accountId, (v) => {
            setAccountId(v);
            setReal(amountInputValue(bals.get(v) ?? 0));
          })}
          <p className="hint">
            The app says <b>{acct?.name}</b> has <b className="num">{fmtMoney(bals.get(accountId) ?? 0, acct?.currency)}</b>. Type what it really has. The difference is recorded as a correction and is not counted as spending.
          </p>
          <AmountInput id="f-real" value={real} onChange={setReal} symbol={sym(acct)} label="Real balance" autoFocus />
          {parseAmount(real, true) !== null && (
            <p className="hint">Correction: {fmtMoney((parseAmount(real, true) ?? 0) - (bals.get(accountId) ?? 0), acct?.currency, { sign: true })}</p>
          )}
          {dateField}
        </>
      );
      break;
  }

  return (
    <form className="col" style={{ gap: 14 }} onSubmit={(e) => void submit(e)}>
      {fields}
      {error && <p className="error-text" role="alert">{error}</p>}
      {warnings && (
        <div className="banner" role="alert">
          <span>{warnings.join(' ')} Save anyway?</span>
          <button type="button" className="btn small" onClick={(e) => void submit(e as unknown as FormEvent, true)}>Save anyway</button>
        </div>
      )}
      {!(kind === 'repay' || kind === 'writeoff') || openLoans.length ? (
        <button className="btn block" type="submit" disabled={busy}>
          {kind === 'writeoff' ? 'Write off' : 'Save'}
        </button>
      ) : null}
    </form>
  );
}

/** Starts "my own rate" from the given date (closing any open period the day before). */
export function ownRateChange(settings: Settings, settingsId: string | null, rate: number, from: string): Change[] {
  if (!settingsId) return [];
  const prevDay = new Date(Date.parse(`${from}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const periods = settings.ownRates
    .filter((p) => p.from < from)
    .map((p) => (p.to === null || p.to >= from ? { ...p, to: prevDay } : p));
  return [{ id: settingsId, type: 'settings', value: { ...settings, rateMode: 'own', ownRates: [...periods, { rate, from, to: null }] } }];
}
