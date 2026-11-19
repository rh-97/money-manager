import { useMemo, useState, type FormEvent } from 'react';
import { amountInputValue, fmtMoney, parseAmount } from '../lib/format.ts';
import { accountLabel } from '../money/calc.ts';
import { correction, systemCategoryId } from '../money/actions.ts';
import { crossCurrency, interestAllowed, pickCurrency, planFromTo, problems, sentences, warnings, type FromToInput, type Pick } from '../money/fromto.ts';
import type { Settings } from '../money/types.ts';
import { useApp, useBalances, type AddPreset, type Change } from '../ui/ctx.tsx';
import { ACCOUNT_ICONS, Icon } from '../ui/icons.tsx';
import { AmountInput, Field, Sheet } from '../ui/kit.tsx';

/** The last of my accounts used as a source, so the next entry starts there (this device only). */
const LAST_FROM = 'mm-last-from';
const readLastFrom = (): string | null => {
  try {
    return localStorage.getItem(LAST_FROM);
  } catch {
    return null;
  }
};

/** The Add screen (spec 6.1): money moves From one or more sources To one destination. */
export function AddSheet({ preset, onClose }: { preset: AddPreset; onClose: () => void }) {
  const { wide } = useApp();
  const [fixing, setFixing] = useState(preset.kind === 'correction');
  if (fixing)
    return (
      <Sheet title="Fix a balance" onClose={onClose} onBack={preset.kind === 'correction' ? undefined : () => setFixing(false)} wide={wide}>
        <CorrectionForm accountId={preset.accountId} onDone={onClose} />
      </Sheet>
    );
  return (
    <Sheet title="Add" onClose={onClose} wide={wide} label="Add an entry">
      <FromToForm preset={preset} onFix={() => setFixing(true)} onDone={onClose} />
    </Sheet>
  );
}

interface Line {
  pick: Pick | null;
  amount: string;
  fee: string;
  /** Added by the app because a person owes less than the amount. */
  auto?: boolean;
}

function FromToForm({ preset, onFix, onDone }: { preset: AddPreset; onFix: () => void; onDone: () => void }) {
  const { ledger, today, save } = useApp();
  const bals = useBalances();
  const accounts = useMemo(() => [...ledger.accounts].sort(([, a], [, b]) => a.sortOrder - b.sortOrder), [ledger.accounts]);
  const money = accounts.filter(([, a]) => a.kind === 'money' && !a.archived);
  const openLoans = accounts.filter(([id, a]) => a.kind === 'loan' && !a.archived && (bals.get(id) ?? 0) !== 0);
  const people = [...new Set(accounts.filter(([, a]) => a.kind === 'loan').map(([, a]) => a.name.trim()))];

  // ---------- Starting point: defaults, or what the button that opened this implies ----------
  const initial = useMemo(() => {
    const last = readLastFrom();
    const ownStart: Pick | null = money.length ? { type: 'acct', id: money.some(([id]) => id === last) ? last! : money[0]![0] } : null;
    const loanBal = preset.loanId ? (bals.get(preset.loanId) ?? 0) : 0;
    const loanPick: Pick | null = preset.loanId ? { type: 'loan', id: preset.loanId } : null;
    const s = { from: ownStart as Pick | null, to: { type: 'expense' } as Pick | null, total: '', expCat: '', incCat: '' };
    switch (preset.kind) {
      case 'expense':
        if (preset.accountId) s.from = { type: 'acct', id: preset.accountId };
        break;
      case 'income':
        s.from = { type: 'income' };
        s.to = null;
        break;
      case 'transfer':
      case 'exchange':
        s.to = null;
        break;
      case 'lend':
        s.to = loanPick ?? { type: 'new' };
        break;
      case 'borrow':
        s.from = loanPick ?? { type: 'new' };
        s.to = ownStart;
        break;
      case 'repay':
        if (loanBal < 0) s.to = loanPick;
        else [s.from, s.to] = [loanPick, ownStart];
        s.total = amountInputValue(Math.abs(loanBal));
        break;
      case 'writeoff':
        if (loanBal > 0) {
          s.from = loanPick;
          s.expCat = systemCategoryId(ledger.categories, 'writeoff') ?? '';
        } else {
          s.from = { type: 'income' };
          s.to = loanPick;
          s.incCat = systemCategoryId(ledger.categories, 'gift') ?? '';
        }
        s.total = amountInputValue(Math.abs(loanBal));
        break;
    }
    return s;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [lines, setLines] = useState<Line[]>([{ pick: initial.from, amount: '', fee: '' }]);
  const [total, setTotal] = useState(initial.total);
  const [to, setTo] = useState<Pick | null>(initial.to);
  const [expCat, setExpCat] = useState(initial.expCat);
  const [incCat, setIncCat] = useState(initial.incCat);
  const [received, setReceived] = useState('');
  const [interest, setInterest] = useState('');
  const [useRate, setUseRate] = useState(true);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [newFrom, setNewFrom] = useState({ name: '', purpose: '' });
  const [newTo, setNewTo] = useState({ name: '', purpose: '' });
  const [allCats, setAllCats] = useState(false);
  const [picking, setPicking] = useState<{ side: 'from' | 'to'; index: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const multi = lines.length > 1;

  // ---------- The input the money model works on ----------
  const input: FromToInput = {
    sources: lines.map((x, i) => ({ pick: x.pick, amount: (multi ? parseAmount(x.amount) : i === 0 ? parseAmount(total) : 0) ?? 0, fee: x.pick?.type === 'acct' ? (parseAmount(x.fee) ?? 0) : 0 })),
    to,
    date,
    today,
    note: note.trim() || undefined,
    expenseCategoryId: to?.type === 'expense' ? expCat || undefined : undefined,
    incomeCategoryId: lines.some((x) => x.pick?.type === 'income') ? incCat || undefined : undefined,
    received: parseAmount(received) ?? undefined,
    interest: parseAmount(interest) ?? undefined,
    newFrom: lines.some((x) => x.pick?.type === 'new') ? newFrom : undefined,
    newTo: to?.type === 'new' ? newTo : undefined,
  };
  const catName = (id?: string) => (id ? (ledger.categories.get(id)?.name ?? '') : '');
  const errs = problems(ledger, input);
  const warns = errs.length ? [] : warnings(ledger, input);
  const said = sentences(ledger, input, catName);
  const cur = input.sources.map((s) => pickCurrency(ledger, s.pick)).find(Boolean) ?? pickCurrency(ledger, to) ?? 'BDT';
  const sym = cur === 'USD' ? '$' : '৳';
  const cross = crossCurrency(ledger, input);
  const showInterest = interestAllowed(ledger, input);
  const hasIncome = lines.some((x) => x.pick?.type === 'income');
  const hasNewFrom = lines.some((x) => x.pick?.type === 'new');
  const fromLoanOwesMe = lines.some((x) => x.pick?.type === 'loan' && (bals.get(x.pick.id) ?? 0) > 0);

  // ---------- Categories: most used first; "Written off" only when a person who owes you is a source ----------
  const usage = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of ledger.entries.values()) if (e.categoryId && !e.parentId) n.set(e.categoryId, (n.get(e.categoryId) ?? 0) + 1);
    return n;
  }, [ledger]);
  const catsOf = (kind: 'expense' | 'income') =>
    [...ledger.categories]
      .filter(([cid, c]) => c.kind === kind && !c.hidden && (c.system !== 'writeoff' || fromLoanOwesMe || cid === expCat) && c.system !== 'fees' && c.system !== 'interest_paid' && c.system !== 'interest')
      .sort(([ia, a], [ib, b]) => (usage.get(ib) ?? 0) - (usage.get(ia) ?? 0) || a.sortOrder - b.sortOrder);
  const catChips = (label: string, kind: 'expense' | 'income', value: string, set: (v: string) => void) => {
    const list = catsOf(kind);
    const shown = allCats ? list : list.slice(0, 8).concat(list.slice(8).filter(([cid]) => cid === value));
    return (
      <div className="field">
        <label>{label}</label>
        <div className="cat-pick">
          {shown.map(([cid, c]) => (
            <button key={cid} type="button" aria-pressed={value === cid} onClick={() => set(value === cid ? '' : cid)}>
              <span className="swatch" style={{ width: 8, height: 8, borderRadius: 2, background: c.slot ? `var(--c${c.slot})` : 'var(--c-other)' }} />
              {c.name}
            </button>
          ))}
          {!allCats && list.length > shown.length && (
            <button type="button" onClick={() => setAllCats(true)}>
              More…
            </button>
          )}
        </div>
      </div>
    );
  };

  // ---------- Lines: auto split, add, remove ----------
  /** If the only source is a person who owes you less than the amount, fill in what they owe and add a line for the rest. */
  const autoSplit = (ls: Line[], t: string): Line[] | null => {
    if (ls.length !== 1) return null;
    const p = ls[0]!.pick;
    const amt = parseAmount(t) ?? 0;
    if (p?.type !== 'loan' || !amt) return null;
    const owed = bals.get(p.id) ?? 0;
    if (owed <= 0 || amt <= owed) return null;
    return [
      { pick: p, amount: amountInputValue(owed), fee: '' },
      { pick: null, amount: amountInputValue(amt - owed), fee: '', auto: true },
    ];
  };
  const applySplit = (ls: Line[], t: string) => {
    const split = autoSplit(ls, t);
    setLines(split ?? ls);
  };
  const addLine = () => setLines((ls) => [...(ls.length === 1 ? [{ ...ls[0]!, amount: total }] : ls), { pick: null, amount: '', fee: '' }]);
  const removeLine = (i: number) =>
    setLines((ls) => {
      const next = ls.filter((_, j) => j !== i);
      if (next.length === 1) {
        setTotal(next[0]!.amount);
        return [{ ...next[0]!, amount: '' }];
      }
      return next;
    });
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // ---------- Picking ----------
  const samePick = (a: Pick | null, b: Pick | null) => !!a && !!b && a.type === b.type && ('id' in a ? 'id' in b && a.id === b.id : true);
  const label = (p: Pick | null, side: 'from' | 'to'): { title: string; sub: string; icon: string; tone?: string } => {
    if (!p) return { title: 'Choose…', sub: side === 'from' ? 'an account, a person, Income or a new loan' : 'an account, a person, Expense or a new loan', icon: 'dots' };
    if (p.type === 'income') return { title: 'Income', sub: 'salary, freelance, a gift…', icon: 'in', tone: 'pos' };
    if (p.type === 'expense') return { title: 'Expense', sub: 'shops, bills, gifts, charity…', icon: 'out', tone: 'neg' };
    if (p.type === 'new') return { title: '+ New loan', sub: side === 'from' ? 'they pay or lend for you; you owe them' : 'you lend to them; they owe you', icon: 'plus' };
    const a = ledger.accounts.get(p.id);
    if (!a) return { title: 'Deleted', sub: '', icon: 'dots' };
    const b = bals.get(p.id) ?? 0;
    if (a.kind === 'loan') return { title: accountLabel(a), sub: b === 0 ? 'settled' : b > 0 ? `owes you ${fmtMoney(b, a.currency)}` : `you owe ${fmtMoney(-b, a.currency)}`, icon: ACCOUNT_ICONS[a.type] ?? 'person' };
    return { title: a.name, sub: a.hideBalance ? 'balance hidden' : fmtMoney(b, a.currency), icon: ACCOUNT_ICONS[a.type] ?? 'wallet' };
  };
  const choose = (p: Pick) => {
    if (!picking) return;
    if (picking.side === 'to') setTo(p);
    else {
      const next = lines.map((x, j) => (j === picking.index ? { ...x, pick: p, auto: false } : x));
      applySplit(next, total);
    }
    setPicking(null);
  };
  const pickButton = (p: Pick | null, side: 'from' | 'to', index: number) => {
    const v = label(p, side);
    return (
      <button type="button" className={`pick-btn${p ? '' : ' empty'}`} onClick={() => setPicking({ side, index })} aria-label={`${side === 'from' ? 'From' : 'To'}: ${v.title}`}>
        <span className={`pick-ic${v.tone ? ` ${v.tone}` : ''}`}>
          <Icon name={v.icon} />
        </span>
        <span className="pick-main">
          <span className="pick-title">{v.title}</span>
          <span className="pick-sub">{v.sub}</span>
        </span>
        <Icon name="chev" />
      </button>
    );
  };

  if (picking) {
    const side = picking.side;
    const others = side === 'from' ? [to] : lines.map((x) => x.pick);
    const incomeTaken = side === 'from' && lines.some((x, j) => j !== picking.index && x.pick?.type === 'income');
    const newTaken = side === 'from' && lines.some((x, j) => j !== picking.index && x.pick?.type === 'new');
    const current = side === 'from' ? lines[picking.index]?.pick : to;
    // A settled loan that a button opened this with stays listed so it can still be used.
    const extraLoan = current?.type === 'loan' && !openLoans.some(([id]) => id === current.id) ? [[current.id, ledger.accounts.get(current.id)!] as const] : [];
    const option = (p: Pick) => {
      const v = label(p, side);
      const taken = others.some((o) => samePick(o, p) && p.type !== 'new');
      const disabled = taken || (p.type === 'income' && incomeTaken) || (p.type === 'new' && newTaken);
      return (
        <button key={'id' in p ? p.id : p.type} type="button" className="pick-opt" disabled={disabled} aria-pressed={samePick(current ?? null, p)} onClick={() => choose(p)}>
          <span className={`pick-ic${v.tone ? ` ${v.tone}` : ''}`}>
            <Icon name={v.icon} />
          </span>
          <span className="pick-main">
            <span className="pick-title">{v.title}</span>
            <span className="pick-sub">{disabled ? (taken ? 'already on the other side' : 'already picked') : v.sub}</span>
          </span>
        </button>
      );
    };
    const settledCount = accounts.filter(([id, a]) => a.kind === 'loan' && !a.archived && (bals.get(id) ?? 0) === 0).length;
    return (
      <div className="col picker" style={{ gap: 4 }}>
        <button type="button" className="back" onClick={() => setPicking(null)}>
          <Icon name="back" /> {side === 'from' ? 'Where does the money come from?' : 'Where does the money go?'}
        </button>
        {option(side === 'from' ? { type: 'income' } : { type: 'expense' })}
        <p className="pick-group">My accounts</p>
        {money.map(([id]) => option({ type: 'acct', id }))}
        <p className="pick-group">People (open loans)</p>
        {[...openLoans, ...extraLoan].map(([id]) => option({ type: 'loan', id }))}
        {option({ type: 'new' })}
        {settledCount > 0 && <p className="small-muted" style={{ margin: '4px 8px' }}>{settledCount === 1 ? '1 settled loan is' : `${settledCount} settled loans are`} not listed. To reuse one, open it from Loans.</p>}
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (errs.length) return;
    setBusy(true);
    const plan = planFromTo(ledger, input);
    const changes: Change[] = [...plan.accounts.map((a) => ({ id: a.id, type: 'account' as const, value: a.value })), ...plan.entries.map((n) => ({ id: n.id, type: 'entry' as const, value: n.value }))];
    // An exchange between my own accounts can set my dollar rate from now on.
    const fromAcct = lines[0]?.pick?.type === 'acct' ? ledger.accounts.get(lines[0].pick.id) : undefined;
    if (cross && useRate && to?.type === 'acct' && fromAcct && input.received) {
      const sent = input.sources[0]!.amount;
      const bdtPerUsd = fromAcct.currency === 'USD' ? input.received / sent : sent / input.received;
      changes.push(...ownRateChange(ledger.settings, ledger.settingsId, Math.round(bdtPerUsd * 100) / 100, date));
    }
    const firstOwn = lines.find((x) => x.pick?.type === 'acct')?.pick;
    if (firstOwn && 'id' in firstOwn) {
      try {
        localStorage.setItem(LAST_FROM, firstOwn.id);
      } catch {
        /* storage blocked */
      }
    }
    const mains = plan.entries.filter((x) => !x.value.parentId).length;
    const ok = await save(changes, mains > 1 ? `Saved ${mains} records together` : (said[0] ?? 'Saved').replace(/\.$/, ''));
    setBusy(false);
    if (ok) onDone();
  }

  const touched = total || multi || note;
  return (
    <form className="col fromto" style={{ gap: 14 }} onSubmit={(e) => void submit(e)}>
      <div className="quick-row" role="group" aria-label="Quick start">
        <button
          type="button"
          onClick={() => {
            // Earned: only the source is implied; the destination is left for you to choose.
            setLines([{ pick: { type: 'income' }, amount: '', fee: '' }]);
            setTo(null);
          }}
        >
          <Icon name="in" /> Earned
        </button>
        <button type="button" onClick={onFix}>
          <Icon name="scale" /> Fix a balance
        </button>
      </div>
      {!multi && <AmountInput id="f-amt" value={total} onChange={setTotal} symbol={sym} autoFocus={!preset.kind || preset.kind === 'expense'} />}
      <div className="col" style={{ gap: 8 }}>
        <div className="side-head">
          <span className="side-label">From</span>
          {multi && <span className="small-muted num">Total {fmtMoney(input.sources.reduce((s, x) => s + x.amount, 0), cur)}</span>}
        </div>
        {lines.map((x, i) => (
          <div key={i} className={`src-line${multi ? '' : ' single'}`}>
            {pickButton(x.pick, 'from', i)}
            {multi && (
              <>
                <label className="mini amt">
                  <span>Amount</span>
                  <input inputMode="decimal" placeholder={`${sym}0`} value={x.amount} onChange={(e) => setLine(i, { amount: e.target.value })} aria-label={`Amount from source ${i + 1}`} />
                </label>
                {x.pick?.type === 'acct' && (
                  <label className="mini fee">
                    <span>Fee (optional)</span>
                    <input inputMode="decimal" placeholder="0" value={x.fee} onChange={(e) => setLine(i, { fee: e.target.value })} aria-label={`Fee for source ${i + 1}`} />
                  </label>
                )}
                <button type="button" className="icon-btn line-x" onClick={() => removeLine(i)} aria-label={`Remove source ${i + 1}`}>
                  <Icon name="x" />
                </button>
              </>
            )}
          </div>
        ))}
        <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={addLine}>
          <Icon name="plus" /> Add another source
        </button>
        {lines.some((x) => x.auto) && <p className="hint">The person owes you less than the amount, so the rest needs another source: one of your accounts, or a new loan if they paid it all.</p>}
        {hasNewFrom && (
          <div className="sub-box">
            <span className="side-label">New loan (From) · you'll owe them</span>
            <div className="two">
              <Field label="Who" htmlFor="nf-who">
                <input id="nf-who" list="loan-people" autoComplete="off" value={newFrom.name} onChange={(e) => setNewFrom({ ...newFrom, name: e.target.value })} placeholder="e.g. Rafi" />
              </Field>
              <Field label="What it's for" htmlFor="nf-why">
                <input id="nf-why" value={newFrom.purpose} onChange={(e) => setNewFrom({ ...newFrom, purpose: e.target.value })} placeholder={note || 'e.g. Dinner'} />
              </Field>
            </div>
          </div>
        )}
      </div>
      <div className="flow-down" aria-hidden="true">
        <Icon name="down" />
      </div>
      <div className="col" style={{ gap: 8 }}>
        <span className="side-label">To</span>
        {pickButton(to, 'to', 0)}
        {to?.type === 'new' && (
          <div className="sub-box">
            <span className="side-label">New loan (To) · they'll owe you</span>
            <div className="two">
              <Field label="Who" htmlFor="nt-who">
                <input id="nt-who" list="loan-people" autoComplete="off" value={newTo.name} onChange={(e) => setNewTo({ ...newTo, name: e.target.value })} placeholder="e.g. Rafi" />
              </Field>
              <Field label="What it's for" htmlFor="nt-why">
                <input id="nt-why" value={newTo.purpose} onChange={(e) => setNewTo({ ...newTo, purpose: e.target.value })} placeholder={note || 'e.g. Fridge'} />
              </Field>
            </div>
          </div>
        )}
      </div>
      {hasIncome && catChips('What kind of income', 'income', incCat, setIncCat)}
      {to?.type === 'expense' && catChips('Spent on', 'expense', expCat, setExpCat)}
      {cross && (
        <>
          <Field label={`Amount received (${pickCurrency(ledger, to) === 'USD' ? '$' : '৳'})`} htmlFor="f-recv">
            <input id="f-recv" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} placeholder="0" />
          </Field>
          {to?.type === 'acct' && lines[0]?.pick?.type === 'acct' && (
            <label className="check-row">
              <input type="checkbox" checked={useRate} onChange={(e) => setUseRate(e.target.checked)} />
              <span>Use this exchange's rate as my dollar rate from now on</span>
            </label>
          )}
        </>
      )}
      {showInterest && (
        <Field label="Of which interest (optional)" htmlFor="f-int" hint="For bank EMIs. The rest pays down the loan.">
          <input id="f-int" inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="0" />
        </Field>
      )}
      <div className="two">
        <Field label="Date" htmlFor="f-date">
          <input id="f-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {!multi && lines[0]?.pick?.type === 'acct' ? (
          <Field label="Fee (optional)" htmlFor="f-fee">
            <input id="f-fee" inputMode="decimal" value={lines[0].fee} onChange={(e) => setLine(0, { fee: e.target.value })} placeholder="0" />
          </Field>
        ) : (
          <span />
        )}
      </div>
      <Field label="Note (optional)" htmlFor="f-note">
        <input id="f-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Dinner with family" />
      </Field>
      <div className="say" aria-live="polite">
        {said.length === 0 ? (
          <p className="small-muted" style={{ margin: 0 }}>Choose From and To, and a sentence here will say what you are recording.</p>
        ) : said.length === 1 ? (
          <p className="say-lead">{said[0]}</p>
        ) : (
          <>
            <p className="say-lead">This records {said.length} things:</p>
            <ul>
              {said.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      {warns.map((w, i) => (
        <p key={i} className="banner warn-line" role="status">
          <Icon name="alert" /> {w}
        </p>
      ))}
      {errs.length > 0 && touched && <p className="error-text">{errs[0]}</p>}
      <button className="btn block" type="submit" disabled={busy || errs.length > 0}>
        {warns.length ? 'Save anyway' : 'Save'}
      </button>
      <datalist id="loan-people">
        {people.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </form>
  );
}

/** Fix a balance: tell the app what an account really holds; the difference is a correction, not spending. */
function CorrectionForm({ accountId: preset, onDone }: { accountId?: string; onDone: () => void }) {
  const { ledger, today, save } = useApp();
  const bals = useBalances();
  const money = [...ledger.accounts].filter(([, a]) => a.kind === 'money' && !a.archived).sort(([, a], [, b]) => a.sortOrder - b.sortOrder);
  const [accountId, setAccountId] = useState(preset ?? money[0]?.[0] ?? '');
  const acct = ledger.accounts.get(accountId);
  const [real, setReal] = useState(() => amountInputValue(bals.get(accountId) ?? 0));
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const current = bals.get(accountId) ?? 0;
  const r = parseAmount(real, true);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (r === null) return setError('Enter the real balance.');
    try {
      const entries = correction({ date, accountId, current, real: r });
      if (await save(entries.map((n) => ({ id: n.id, type: 'entry' as const, value: n.value })), `${acct?.name} corrected by ${fmtMoney(r - current, acct?.currency, { sign: true })}`)) onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="col" style={{ gap: 14 }} onSubmit={(e) => void submit(e)}>
      <Field label="Account" htmlFor="c-acct">
        <select
          id="c-acct"
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
            setReal(amountInputValue(bals.get(e.target.value) ?? 0));
          }}
        >
          {money.map(([id, a]) => (
            <option key={id} value={id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <p className="hint">
        The app says <b>{acct?.name}</b> has <b className="num">{fmtMoney(current, acct?.currency)}</b>. Type what it really has. The difference is recorded as a correction and is not counted as spending.
      </p>
      <AmountInput id="c-real" value={real} onChange={setReal} symbol={acct?.currency === 'USD' ? '$' : '৳'} label="Real balance" autoFocus />
      {r !== null && r !== current && <p className="hint">Correction: {fmtMoney(r - current, acct?.currency, { sign: true })}</p>}
      <Field label="Date" htmlFor="c-date">
        <input id="c-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn block" type="submit">
        Save correction
      </button>
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
