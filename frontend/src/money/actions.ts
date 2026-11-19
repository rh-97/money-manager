/**
 * Turns what the user typed into the entries to save (spec 6 and 7).
 * Each function returns new records; fees, interest and write-offs are separate
 * child entries linked by parentId, so stats count them as real spending/income.
 */
import { randomId } from '@mm/shared';
import type { CombinePlan, Ledger, OffsetPair } from './calc.ts';
import type { Category, Entry, LoanAction, SystemCategory } from './types.ts';

export interface NewEntry {
  id: string;
  value: Entry;
}

const stamp = (): string => new Date().toISOString();

export function systemCategoryId(categories: Map<string, Category>, system: SystemCategory): string | undefined {
  for (const [id, c] of categories) if (c.system === system) return id;
  return undefined;
}

export function expenseOrIncome(p: { kind: 'expense' | 'income'; date: string; amount: number; accountId: string; categoryId: string; note?: string }): NewEntry[] {
  return [{ id: randomId(), value: { kind: p.kind, date: p.date, amount: p.amount, accountId: p.accountId, categoryId: p.categoryId, note: p.note || undefined, createdAt: stamp() } }];
}

/** Transfers, exchanges, lending and borrowing. A fee comes out of the paying money account. */
export function transfer(
  categories: Map<string, Category>,
  p: {
    date: string;
    amount: number;
    from: string;
    to: string;
    toAmount?: number;
    fee?: number;
    feeAccountId?: string;
    loanAction?: LoanAction;
    note?: string;
  },
): NewEntry[] {
  const id = randomId();
  const out: NewEntry[] = [
    {
      id,
      value: {
        kind: 'transfer',
        date: p.date,
        amount: p.amount,
        accountId: p.from,
        toAccountId: p.to,
        toAmount: p.toAmount && p.toAmount !== p.amount ? p.toAmount : undefined,
        loanAction: p.loanAction,
        note: p.note || undefined,
        createdAt: stamp(),
      },
    },
  ];
  if (p.fee && p.fee > 0) {
    out.push({
      id: randomId(),
      value: { kind: 'expense', date: p.date, amount: p.fee, accountId: p.feeAccountId ?? p.from, categoryId: systemCategoryId(categories, 'fees'), note: 'Fee', parentId: id, createdAt: stamp() },
    });
  }
  return out;
}

/**
 * Repayment on a loan account. The direction comes from the loan balance:
 * balance < 0 means I owe them, so money goes out; balance > 0 means they pay me back.
 * `amount` is the total paid; `interest` is the part of it that is interest.
 */
export function repay(
  categories: Map<string, Category>,
  p: { date: string; loanId: string; moneyId: string; loanBalance: number; amount: number; interest?: number; fee?: number; note?: string },
): NewEntry[] {
  const interest = Math.max(0, p.interest ?? 0);
  const principal = p.amount - interest;
  if (principal <= 0) throw new Error('The interest part must be less than the amount paid.');
  if (principal > Math.abs(p.loanBalance)) throw new Error('That is more than what is left on this loan.');
  const iOwe = p.loanBalance < 0;
  const out = transfer(categories, {
    date: p.date,
    amount: principal,
    from: iOwe ? p.moneyId : p.loanId,
    to: iOwe ? p.loanId : p.moneyId,
    fee: p.fee,
    feeAccountId: p.moneyId,
    loanAction: 'repay',
    note: p.note,
  });
  if (interest > 0) {
    out.push({
      id: randomId(),
      value: {
        kind: iOwe ? 'expense' : 'income',
        date: p.date,
        amount: interest,
        accountId: p.moneyId,
        categoryId: systemCategoryId(categories, iOwe ? 'interest_paid' : 'interest'),
        note: 'Interest',
        parentId: out[0]!.id,
        createdAt: stamp(),
      },
    });
  }
  return out;
}

/** Clears what is left on a loan. Owed to me: an expense (or gift). I owe: income (the lender forgave it). */
export function writeOff(categories: Map<string, Category>, p: { date: string; loanId: string; loanBalance: number; asGift: boolean; note?: string }): NewEntry[] {
  if (p.loanBalance === 0) throw new Error('This loan is already settled.');
  const owedToMe = p.loanBalance > 0;
  const giftCategory = [...categories].find(([, c]) => c.kind === 'expense' && c.name === 'Gifts & Donations')?.[0];
  const categoryId = owedToMe ? (p.asGift ? giftCategory : systemCategoryId(categories, 'writeoff')) : systemCategoryId(categories, 'gift');
  return [
    {
      id: randomId(),
      value: {
        kind: owedToMe ? 'expense' : 'income',
        date: p.date,
        amount: Math.abs(p.loanBalance),
        accountId: p.loanId,
        categoryId,
        loanAction: 'writeoff',
        note: p.note || (owedToMe ? 'Written off' : 'Forgiven by lender'),
        createdAt: stamp(),
      },
    },
  ];
}

export function correction(p: { date: string; accountId: string; current: number; real: number }): NewEntry[] {
  const amount = p.real - p.current;
  if (amount === 0) throw new Error('The balance already matches.');
  return [{ id: randomId(), value: { kind: 'correction', date: p.date, amount, accountId: p.accountId, note: 'Balance correction', createdAt: stamp() } }];
}

/**
 * Cancels out loans with the same person in opposite directions (7.9). No money moves:
 * each pair is a transfer from the loan they owe me on to the loan I owe them on, so both
 * go down by the same amount. The first entry is the parent, so deleting it undoes all.
 */
export function cancelOut(pairs: OffsetPair[], date: string): NewEntry[] {
  const out: NewEntry[] = [];
  for (const p of pairs) {
    out.push({
      id: randomId(),
      value: {
        kind: 'transfer',
        date,
        amount: p.amount,
        accountId: p.from,
        toAccountId: p.to,
        loanAction: 'offset',
        parentId: out[0]?.id,
        createdAt: stamp(),
      },
    });
  }
  return out;
}

/**
 * Saves a combine (6.7): the two originals move out of sight (kept for "Undo combine"),
 * and the direct entry, plus any leftover, takes their place.
 */
export function combine(l: Ledger, plan: Extract<CombinePlan, { ok: true }>): { id: string; value: Entry }[] {
  const stamp = new Date().toISOString();
  const combinedId = randomId();
  const out: { id: string; value: Entry }[] = [{ id: combinedId, value: plan.combined }];
  if (plan.leftover) out.push({ id: randomId(), value: plan.leftover });
  for (const id of [plan.inflowId, plan.outflowId]) out.push({ id, value: { ...l.entries.get(id)!, deletedAt: stamp, combinedInto: combinedId } });
  return out;
}

/** Undoes a combine: the originals come back and the entries made from them are removed. */
export function uncombine(l: Ledger, combinedId: string): ({ id: string; value: Entry } | { id: string; delete: true })[] | null {
  const e = l.entries.get(combinedId);
  const from = e?.combinedFrom;
  if (!from || !from.every((id) => l.entries.has(id))) return null;
  const made = [...l.entries].filter(([, x]) => x.combinedFrom && x.combinedFrom.join() === from.join()).map(([id]) => ({ id, delete: true as const }));
  const restored = from.map((id) => {
    const { combinedInto: _c, deletedAt: _d, ...rest } = l.entries.get(id)!;
    return { id, value: rest as Entry };
  });
  return [...restored, ...made];
}
