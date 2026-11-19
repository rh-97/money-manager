/**
 * The Add screen's model (spec 6.1): every entry is money moving From one or more
 * sources To one destination. This turns those choices into the records to save,
 * the sentence that describes them, and any warnings. Pure functions: no saving here.
 */
import { randomId } from '@mm/shared';
import { balances, DIRECT, loanSummary, personKey, type Ledger } from './calc.ts';
import { systemCategoryId, type NewEntry } from './actions.ts';
import type { Account, Currency, Entry, LoanAction } from './types.ts';
import { fmtMoney } from '../lib/format.ts';

export { DIRECT };

export type Pick = { type: 'acct'; id: string } | { type: 'loan'; id: string } | { type: 'income' } | { type: 'expense' } | { type: 'new' };

export interface SourceLine {
  pick: Pick | null;
  /** Minor units. */
  amount: number;
  /** Minor units; only for one of my own accounts. */
  fee: number;
}

export interface NewLoan {
  name: string;
  purpose?: string;
}

export interface FromToInput {
  sources: SourceLine[];
  to: Pick | null;
  date: string;
  today: string;
  note?: string;
  expenseCategoryId?: string;
  incomeCategoryId?: string;
  /** Amount arriving, when the destination's currency differs from the source's. */
  received?: number;
  /** Part of a repayment that is interest (one source only). */
  interest?: number;
  newFrom?: NewLoan;
  newTo?: NewLoan;
}

export interface FromToPlan {
  accounts: { id: string; value: Account }[];
  entries: NewEntry[];
}

const stamp = (): string => new Date().toISOString();
const isOwn = (p: Pick | null): p is { type: 'acct'; id: string } => p?.type === 'acct';
const sameTarget = (a: Pick | null, b: Pick | null) => !!a && !!b && (a.type === 'acct' || a.type === 'loan') && a.type === b.type && 'id' in b && a.id === b.id;

/** The currency a pick holds money in; null for Income, Expense and a new loan (it takes the other side's). */
export function pickCurrency(l: Ledger, p: Pick | null): Currency | null {
  if (p && (p.type === 'acct' || p.type === 'loan')) return l.accounts.get(p.id)?.currency ?? null;
  return null;
}

/** A typed name that matches someone already in Loans uses their spelling, so the loans group together. */
export function canonicalName(l: Ledger, typed: string): string {
  const t = typed.trim().replace(/\s+/g, ' ');
  for (const a of l.accounts.values()) if (a.kind === 'loan' && personKey(a.name) === personKey(t)) return a.name.trim();
  return t;
}

function fromCurrency(l: Ledger, i: FromToInput): Currency {
  for (const s of i.sources) {
    const c = pickCurrency(l, s.pick);
    if (c) return c;
  }
  return pickCurrency(l, i.to) ?? 'BDT';
}

export function crossCurrency(l: Ledger, i: FromToInput): boolean {
  const to = pickCurrency(l, i.to);
  return !!to && to !== fromCurrency(l, i);
}

/** What stops the entry from being saved, in plain words. Empty when it's ready. */
export function problems(l: Ledger, i: FromToInput): string[] {
  const out: string[] = [];
  if (!i.sources.length || i.sources.some((s) => !s.pick)) out.push(i.sources.length > 1 ? 'Choose every source (From).' : 'Choose where the money comes from (From).');
  if (!i.to) out.push('Choose where the money goes (To).');
  if (i.sources.some((s) => !s.amount)) out.push(i.sources.length > 1 ? 'Enter an amount for each source.' : 'Enter the amount.');
  if (i.sources.filter((s) => s.pick?.type === 'income').length > 1) out.push('Income can only be picked once.');
  if (i.sources.filter((s) => s.pick?.type === 'new').length > 1) out.push('Only one new loan can be a source.');
  if (i.sources.some((s) => sameTarget(s.pick, i.to))) out.push('The same account can’t be on both sides.');
  const curs = new Set(i.sources.map((s) => pickCurrency(l, s.pick)).filter(Boolean));
  if (curs.size > 1) out.push('Sources in taka and dollars can’t be mixed in one entry.');
  if (crossCurrency(l, i) && i.sources.length > 1) out.push('A currency exchange can only have one source.');
  if (crossCurrency(l, i) && !i.received) out.push(`Enter the amount received in ${pickCurrency(l, i.to) === 'USD' ? 'dollars' : 'taka'}.`);
  if (i.to?.type === 'expense' && !i.expenseCategoryId) out.push('Pick what it was spent on.');
  if (i.sources.some((s) => s.pick?.type === 'income') && !i.incomeCategoryId) out.push('Pick what kind of income it is.');
  if (i.sources.some((s) => s.pick?.type === 'new') && !i.newFrom?.name.trim()) out.push('Type who the new loan (From) is with.');
  if (i.to?.type === 'new' && !i.newTo?.name.trim()) out.push('Type who the new loan (To) is with.');
  if (i.interest && i.sources.length === 1 && i.interest >= (i.sources[0]?.amount ?? 0)) out.push('The interest part must be less than the amount paid.');
  return out;
}

/** Interest only makes sense for a repayment between one of my accounts and a loan, with one source. */
export function interestAllowed(l: Ledger, i: FromToInput): boolean {
  if (i.sources.length !== 1) return false;
  const from = i.sources[0]!.pick;
  const to = i.to;
  if (isOwn(from) && to?.type === 'loan') return loanSummary(l, to.id).balance < 0;
  if (from?.type === 'loan' && isOwn(to)) return loanSummary(l, from.id).balance > 0;
  return false;
}

/** Turns the choices into the new loans and entries to save. Call only when problems() is empty. */
export function planFromTo(l: Ledger, i: FromToInput): FromToPlan {
  const accounts: FromToPlan['accounts'] = [];
  const cur = fromCurrency(l, i);
  const newLoan = (n: NewLoan, otherCur: Currency): string => {
    const id = randomId();
    const value: Account = {
      kind: 'loan',
      type: 'person',
      name: canonicalName(l, n.name),
      purpose: n.purpose?.trim() || i.note?.trim() || undefined,
      currency: otherCur,
      startingBalance: 0,
      startDate: i.date < i.today ? i.date : i.today,
      includeInTotal: true,
      archived: false,
      slot: 0,
      sortOrder: l.accounts.size + accounts.length,
    };
    accounts.push({ id, value });
    return id;
  };
  const toId = !i.to ? '' : i.to.type === 'new' ? newLoan(i.newTo!, cur) : 'id' in i.to ? i.to.id : i.to.type;
  const toCur = pickCurrency(l, i.to) ?? cur;
  let fromNewId: string | null = null;
  const bal = (id: string) => (l.accounts.get(id)?.kind === 'loan' ? loanSummary(l, id).balance : 0);
  const isLoan = (id: string) => l.accounts.get(id)?.kind === 'loan' || accounts.some((a) => a.id === id);
  const note = i.note?.trim() || undefined;
  const writeoffCat = systemCategoryId(l.categories, 'writeoff');

  const entries: NewEntry[] = [];
  const mains: string[] = [];
  const add = (value: Entry, main = true): string => {
    const id = randomId();
    for (const k of Object.keys(value) as (keyof Entry)[]) if (value[k] === undefined) delete value[k];
    entries.push({ id, value });
    if (main) mains.push(id);
    return id;
  };

  for (const s of i.sources) {
    const p = s.pick!;
    const fromId = p.type === 'new' ? (fromNewId ??= newLoan(i.newFrom!, toCur)) : 'id' in p ? p.id : p.type;
    const base = { date: i.date, amount: s.amount, note, createdAt: stamp() };
    let mainId: string;
    if (fromId === 'income' && toId === 'expense') {
      // Earned and spent in one go (e.g. the employer pays the rent): two records, no account.
      mainId = add({ ...base, kind: 'income', accountId: DIRECT, categoryId: i.incomeCategoryId });
      add({ ...base, kind: 'expense', accountId: DIRECT, categoryId: i.expenseCategoryId });
    } else if (fromId === 'income') {
      mainId = add({ ...base, kind: 'income', accountId: toId, categoryId: i.incomeCategoryId });
    } else if (toId === 'expense') {
      const writeoff = !!writeoffCat && i.expenseCategoryId === writeoffCat;
      mainId = add({ ...base, kind: 'expense', accountId: fromId, categoryId: i.expenseCategoryId, loanAction: writeoff ? 'writeoff' : undefined });
    } else {
      let loanAction: LoanAction | undefined;
      if (isLoan(toId) && !isLoan(fromId)) loanAction = bal(toId) < 0 ? 'repay' : 'lend';
      else if (isLoan(fromId) && !isLoan(toId)) loanAction = bal(fromId) > 0 ? 'repay' : 'borrow';
      const interest = i.sources.length === 1 && interestAllowed(l, i) ? (i.interest ?? 0) : 0;
      const principal = s.amount - interest;
      const cross = crossCurrency(l, i);
      mainId = add({ ...base, kind: 'transfer', amount: principal, accountId: fromId, toAccountId: toId, toAmount: cross ? i.received : undefined, loanAction });
      if (interest > 0) {
        const iOwe = isLoan(toId);
        add(
          {
            kind: iOwe ? 'expense' : 'income',
            date: i.date,
            amount: interest,
            accountId: iOwe ? fromId : toId,
            categoryId: systemCategoryId(l.categories, iOwe ? 'interest_paid' : 'interest'),
            note: 'Interest',
            parentId: mainId,
            createdAt: stamp(),
          },
          false,
        );
      }
    }
    if (isOwn(p) && s.fee > 0) {
      add({ kind: 'expense', date: i.date, amount: s.fee, accountId: p.id, categoryId: systemCategoryId(l.categories, 'fees'), note: 'Fee', parentId: mainId, createdAt: stamp() }, false);
    }
  }
  // Several records made at once (split payment, or earned-and-spent) show as one in lists.
  const groupNeeded = mains.length > 1 || entries.some((e) => e.value.accountId === DIRECT);
  if (groupNeeded) {
    const groupId = mains[0]!;
    for (const e of entries) if (!e.value.parentId) e.value.groupId = groupId;
  }
  return { accounts, entries };
}

/** One sentence per source, plus fees: what the entry records, in plain words. */
export function sentences(l: Ledger, i: FromToInput, catName: (id?: string) => string): string[] {
  const out: string[] = [];
  const cur = fromCurrency(l, i);
  const name = (p: Pick | null, side: 'from' | 'to'): string => {
    if (!p) return '…';
    if (p.type === 'acct') return l.accounts.get(p.id)?.name ?? '';
    if (p.type === 'loan') return l.accounts.get(p.id)?.name.trim() ?? '';
    if (p.type === 'new') {
      const n = (side === 'from' ? i.newFrom : i.newTo)?.name ?? '';
      return n.trim() ? canonicalName(l, n) : 'someone new';
    }
    return '';
  };
  const spentOn = catName(i.expenseCategoryId) || 'an expense';
  const income = catName(i.incomeCategoryId) || 'income';
  const to = i.to;
  for (const s of i.sources) {
    const p = s.pick;
    if (!p || !to) continue;
    const amt = s.amount ? fmtMoney(s.amount, cur) : '…';
    const theyOweMe = p.type === 'loan' && loanSummary(l, p.id).balance > 0;
    const iOweTo = to.type === 'loan' && loanSummary(l, to.id).balance < 0;
    const toName = to.type === 'expense' ? spentOn : name(to, 'to');
    let line: string;
    if (p.type === 'income' && to.type === 'expense') line = `You earn ${amt} (${income}) and it's paid straight to ${spentOn}.`;
    else if (p.type === 'income' && to.type === 'acct') line = `You earn ${amt} (${income}) into ${toName}.`;
    else if (p.type === 'income') line = `You earn ${amt} (${income}), paid straight to ${toName} for you.`;
    else if (p.type === 'acct' && to.type === 'expense') line = `You spend ${amt} on ${spentOn} from ${name(p, 'from')}.`;
    else if (p.type === 'acct' && to.type === 'acct')
      line = crossCurrency(l, i) && i.received ? `You exchange ${amt} from ${name(p, 'from')} into ${fmtMoney(i.received, pickCurrency(l, to) ?? 'BDT')} in ${toName}.` : `You move ${amt} from ${name(p, 'from')} to ${toName}.`;
    else if (p.type === 'acct') line = iOweTo ? `You pay ${toName} back ${amt} from ${name(p, 'from')}.` : `You lend ${toName} ${amt} from ${name(p, 'from')}.`;
    else if (to.type === 'acct') line = theyOweMe ? `${name(p, 'from')} pays you back ${amt} into ${toName}.` : `You borrow ${amt} from ${name(p, 'from')} into ${toName}.`;
    else if (to.type === 'expense')
      line =
        i.expenseCategoryId && i.expenseCategoryId === systemCategoryId(l.categories, 'writeoff')
          ? `You write off ${amt} that ${name(p, 'from')} owed you. It counts as spending.`
          : theyOweMe
            ? `${name(p, 'from')} pays ${amt} for ${spentOn} for you, out of what they owe you.`
            : `${name(p, 'from')} pays ${amt} for ${spentOn} for you; you'll owe them.`;
    else line = `${name(p, 'from')} pays ${toName} ${amt} for you.`;
    out.push(line);
  }
  if (out.length)
    for (const s of i.sources) if (isOwn(s.pick) && s.fee > 0) out.push(`Plus a ${fmtMoney(s.fee, cur)} fee from ${name(s.pick, 'from')} (Fees & charges).`);
  if (out.length && i.interest && interestAllowed(l, i)) out.push(`Of that, ${fmtMoney(i.interest, cur)} is interest.`);
  return out;
}

/** Things worth a second look before saving ("Save anyway"). */
export function warnings(l: Ledger, i: FromToInput): string[] {
  const out: string[] = [];
  const bals = balances(l);
  if (i.date > i.today) out.push('The date is in the future.');
  const spentFrom = new Map<string, number>();
  for (const s of i.sources) {
    const p = s.pick;
    if (!p) continue;
    if (p.type === 'loan') {
      const owed = loanSummary(l, p.id).balance;
      const a = l.accounts.get(p.id)!;
      if (owed > 0 && s.amount > owed) out.push(`${a.name.trim()} owes you only ${fmtMoney(owed, a.currency)}${a.purpose ? ` on ${a.purpose}` : ''}. After this you'd owe them ${fmtMoney(s.amount - owed, a.currency)}.`);
    }
    if (isOwn(p)) spentFrom.set(p.id, (spentFrom.get(p.id) ?? 0) + s.amount + s.fee);
  }
  for (const [id, out_] of spentFrom) {
    const a = l.accounts.get(id)!;
    const now = bals.get(id) ?? 0;
    if (a.type !== 'card' && now >= 0 && now - out_ < 0) out.push(`${a.name} would go below zero (${fmtMoney(now - out_, a.currency)}).`);
  }
  if (i.to?.type === 'loan') {
    const owe = loanSummary(l, i.to.id).balance;
    const a = l.accounts.get(i.to.id)!;
    const total = i.sources.reduce((s, x) => s + x.amount, 0) - (interestAllowed(l, i) ? (i.interest ?? 0) : 0);
    if (owe < 0 && total > -owe) out.push(`You owe ${a.name.trim()} only ${fmtMoney(-owe, a.currency)}${a.purpose ? ` on ${a.purpose}` : ''}. After this they'd owe you ${fmtMoney(total + owe, a.currency)}.`);
  }
  return out;
}
