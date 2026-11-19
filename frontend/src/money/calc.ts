/**
 * All money calculations (spec sections 4 to 9). Pure functions over the
 * decrypted records: nothing here is ever stored, everything is recomputed.
 * Amounts are integers in the smallest unit (paisa / cents).
 */
import type { api } from '@mm/shared';
import { FALLBACK_RATE } from './defaults.ts';
import type { Account, Category, Currency, Entry, Settings } from './types.ts';

export interface Ledger {
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
  entries: Map<string, Entry>;
  settings: Settings;
  rates: api.RateRow[];
}

export type IdEntry = [string, Entry];

// ---------- Basics ----------

export function liveEntries(l: Ledger): IdEntry[] {
  return [...l.entries.entries()]
    .filter(([, e]) => !e.deletedAt)
    .sort(([, a], [, b]) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
}

/** Income paid straight to an expense touches no account: both records use this placeholder account id. */
export const DIRECT = 'direct';

/** How an entry changes each account it touches (in that account's currency). */
export function effects(e: Entry): { accountId: string; delta: number }[] {
  if (e.accountId === DIRECT) return [];
  switch (e.kind) {
    case 'expense':
      return [{ accountId: e.accountId, delta: -e.amount }];
    case 'income':
    case 'correction':
      return [{ accountId: e.accountId, delta: e.amount }];
    case 'transfer':
      return [
        { accountId: e.accountId, delta: -e.amount },
        { accountId: e.toAccountId!, delta: e.toAmount ?? e.amount },
      ];
  }
}

export function balances(l: Ledger, upTo?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, a] of l.accounts) if (!upTo || a.startDate <= upTo) out.set(id, a.startingBalance);
  for (const [, e] of liveEntries(l)) {
    if (upTo && e.date > upTo) break;
    for (const { accountId, delta } of effects(e)) if (out.has(accountId)) out.set(accountId, out.get(accountId)! + delta);
  }
  return out;
}

// ---------- Dollar rate ----------

export interface RateInfo {
  rate: number;
  source: 'own' | 'auto' | 'fallback';
  date?: string;
}

export function rateOn(l: Ledger, date: string): RateInfo {
  const own = l.settings.ownRates.find((p) => p.from <= date && (p.to === null || date <= p.to));
  if (own) return { rate: own.rate, source: 'own', date: own.from };
  let best: api.RateRow | undefined;
  for (const r of l.rates) if (r.date <= date && (!best || r.date > best.date)) best = r;
  if (!best) for (const r of l.rates) if (!best || r.date < best.date) best = r;
  return best ? { rate: best.usdToBdt, source: 'auto', date: best.date } : { rate: FALLBACK_RATE, source: 'fallback' };
}

export function toBDT(l: Ledger, minor: number, currency: Currency, date: string): number {
  return currency === 'BDT' ? minor : Math.round(minor * rateOn(l, date).rate);
}

// ---------- Totals ----------

export interface Totals {
  moneyHave: number;
  owedToMe: number;
  iOwe: number;
  netWorth: number;
}

export function totals(l: Ledger, today: string, upTo?: string): Totals {
  const bal = balances(l, upTo);
  const date = upTo ?? today;
  let moneyHave = 0;
  let owedToMe = 0;
  let iOwe = 0;
  for (const [id, a] of l.accounts) {
    const b = bal.get(id);
    if (b === undefined) continue;
    const v = toBDT(l, b, a.currency, date);
    // Accounts and loans switched off for Home ("include in total") are left out here.
    if (!a.includeInTotal) continue;
    if (a.kind === 'money') moneyHave += v;
    else if (v > 0) owedToMe += v;
    else iOwe += -v;
  }
  return { moneyHave, owedToMe, iOwe, netWorth: moneyHave + owedToMe - iOwe };
}

// ---------- Spending and income ----------

/** Expenses and income count; transfers (including loans) and corrections do not. */
export const counts = (e: Entry): boolean => e.kind === 'expense' || e.kind === 'income';

export interface PeriodStats {
  income: number;
  spent: number;
  byCategory: Map<string, number>;
}

export function periodStats(l: Ledger, from: string, to: string): PeriodStats {
  const byCategory = new Map<string, number>();
  let income = 0;
  let spent = 0;
  for (const [, e] of liveEntries(l)) {
    if (e.date < from || e.date > to || !counts(e)) continue;
    const a = l.accounts.get(e.accountId);
    const v = toBDT(l, e.amount, a?.currency ?? 'BDT', e.date);
    if (e.kind === 'income') income += v;
    else {
      spent += v;
      const key = e.categoryId ?? 'none';
      byCategory.set(key, (byCategory.get(key) ?? 0) + v);
    }
  }
  return { income, spent, byCategory };
}

export function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthlySeries(l: Ledger, endMonth: string, count: number): { month: string; income: number; spent: number }[] {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = addMonths(endMonth, -i);
    const [from, to] = monthRange(month);
    const s = periodStats(l, from, to);
    out.push({ month, income: s.income, spent: s.spent });
  }
  return out;
}

export function dailySpending(l: Ledger, month: string): number[] {
  const [from, to] = monthRange(month);
  const days = new Array<number>(Number(to.slice(8))).fill(0);
  for (const [, e] of liveEntries(l)) {
    if (e.kind !== 'expense' || e.date < from || e.date > to) continue;
    const a = l.accounts.get(e.accountId);
    days[Number(e.date.slice(8)) - 1]! += toBDT(l, e.amount, a?.currency ?? 'BDT', e.date);
  }
  return days;
}

export function topExpenses(l: Ledger, from: string, to: string, n: number): IdEntry[] {
  return liveEntries(l)
    .filter(([, e]) => e.kind === 'expense' && e.date >= from && e.date <= to)
    .sort(([, a], [, b]) => toBDT(l, b.amount, l.accounts.get(b.accountId)?.currency ?? 'BDT', b.date) - toBDT(l, a.amount, l.accounts.get(a.accountId)?.currency ?? 'BDT', a.date))
    .slice(0, n);
}

/** Money I have and net worth at the end of each month (today for the current month). */
export function balanceHistory(l: Ledger, endMonth: string, count: number, today: string): { month: string; moneyHave: number; netWorth: number; iOwe: number; owedToMe: number }[] {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = addMonths(endMonth, -i);
    const end = monthRange(month)[1];
    const t = totals(l, today, end < today ? end : today);
    out.push({ month, ...t });
  }
  return out;
}

/** A short sentence: before + strong (shown in bold) + after. */
export interface Insight {
  before: string;
  strong: string;
  after: string;
}

export function insights(l: Ledger, today: string, fmt: (minor: number) => string): Insight[] {
  const month = today.slice(0, 7);
  const prev = addMonths(month, -1);
  const [mFrom] = monthRange(month);
  const now = periodStats(l, mFrom, today);
  const [pFrom, pTo] = monthRange(prev);
  const last = periodStats(l, pFrom, pTo);
  const out: Insight[] = [];
  const prevName = monthName(prev);
  if (last.spent > 0) {
    const diff = last.spent - now.spent;
    out.push(
      diff >= 0
        ? { before: 'You spent ', strong: fmt(diff), after: ` less than all of ${prevName} so far.` }
        : { before: 'You already spent ', strong: fmt(-diff), after: ` more than all of ${prevName}.` },
    );
  }
  let best: { name: string; pct: number } | null = null;
  for (const [cat, v] of now.byCategory) {
    const before = last.byCategory.get(cat) ?? 0;
    if (before < 50000 || v <= before) continue; // ignore tiny categories (under ৳500)
    const pct = Math.round(((v - before) / before) * 100);
    if (pct >= 15 && (!best || pct > best.pct)) best = { name: l.categories.get(cat)?.name ?? 'Other', pct };
  }
  if (best) out.push({ before: `${best.name} is up `, strong: `${best.pct}%`, after: ` on ${prevName}.` });
  const fees = [...now.byCategory].filter(([c]) => l.categories.get(c)?.system === 'fees').reduce((s, [, v]) => s + v, 0);
  if (fees > 0) out.push({ before: 'Fees and charges cost you ', strong: fmt(fees), after: ' this month.' });
  return out;
}

export function monthName(month: string, long = true): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: long ? 'long' : 'short', timeZone: 'UTC' });
}

// ---------- Loans (spec section 7) ----------

export interface LoanItem {
  entryId: string | null; // null for the opening balance
  date: string;
  direction: 1 | -1; // +1 = they owe me, -1 = I owe them
  amount: number;
  remaining: number;
}

export interface LoanSummary {
  balance: number; // + they owe me, - I owe them
  status: 'owed' | 'owe' | 'settled';
  /** Total lent/borrowed since the account was last settled. */
  cycleAmount: number;
  repaid: number;
  openItems: LoanItem[];
  timeline: IdEntry[];
}

/** Applies every movement to a loan account, settling the oldest open items first. */
export function loanSummary(l: Ledger, accountId: string): LoanSummary {
  const account = l.accounts.get(accountId);
  if (!account) throw new Error('Unknown loan account');
  const queue: LoanItem[] = [];
  let balance = 0;
  let cycleAmount = 0;
  const timeline: IdEntry[] = [];

  const apply = (delta: number, entryId: string | null, date: string): void => {
    let d = delta;
    while (d !== 0) {
      const head = queue[0];
      if (head && Math.sign(d) === -head.direction) {
        const used = Math.min(Math.abs(d), head.remaining);
        head.remaining -= used;
        d -= Math.sign(d) * used;
        balance -= head.direction * used;
        if (head.remaining === 0) queue.shift();
        if (balance === 0) cycleAmount = 0;
      } else {
        const item: LoanItem = { entryId, date, direction: Math.sign(d) as 1 | -1, amount: Math.abs(d), remaining: Math.abs(d) };
        queue.push(item);
        balance += d;
        cycleAmount += Math.abs(d);
        d = 0;
      }
    }
  };

  if (account.startingBalance) apply(account.startingBalance, null, account.startDate);
  for (const [id, e] of liveEntries(l)) {
    const hits = effects(e).filter((x) => x.accountId === accountId);
    if (!hits.length) continue;
    timeline.push([id, e]);
    for (const h of hits) apply(h.delta, id, e.date);
  }
  return {
    balance,
    status: balance > 0 ? 'owed' : balance < 0 ? 'owe' : 'settled',
    cycleAmount,
    repaid: cycleAmount - Math.abs(balance),
    openItems: queue,
    timeline,
  };
}

/** Entries touching one account, newest first. */
export function accountHistory(l: Ledger, accountId: string): IdEntry[] {
  return liveEntries(l)
    .filter(([, e]) => e.accountId === accountId || e.toAccountId === accountId)
    .reverse();
}

// ---------- Loan reasons, people and cancelling out (spec 7.1, 7.9) ----------

/** A loan's headline: what it's for, or the person's name when no reason is given. */
export const loanTitle = (a: Account): string => a.purpose?.trim() || a.name;

/** "Fridge · Rafi" for a loan with a reason; just the name otherwise (and for money accounts). */
export const accountLabel = (a: Account): string => (a.kind === 'loan' && a.purpose?.trim() ? `${a.purpose.trim()} · ${a.name}` : a.name);

/** Loans are grouped by person: names match ignoring capitals and extra spaces. */
export const personKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

export interface PersonGroup<T> {
  key: string;
  name: string;
  rows: T[];
}

/** Groups rows by the loan's person, keeping the order of each person's first row. */
export function groupByPerson<T extends { a: Account }>(rows: T[]): PersonGroup<T>[] {
  const groups = new Map<string, PersonGroup<T>>();
  for (const r of rows) {
    const key = personKey(r.a.name);
    const g = groups.get(key);
    if (g) g.rows.push(r);
    else groups.set(key, { key, name: r.a.name.trim(), rows: [r] });
  }
  return [...groups.values()];
}

export interface OffsetPair {
  /** The loan the person owes me on (its balance goes down). */
  from: string;
  /** The loan I owe the person on (what I owe goes down). */
  to: string;
  amount: number;
  currency: Currency;
}

/**
 * How to cancel out a person's loans in opposite directions (7.9): the smaller side
 * is cancelled in full against the other, oldest loans first, one currency at a time.
 * Returns no pairs when there is nothing to cancel.
 */
export function offsetPlan(l: Ledger, loanIds: string[]): OffsetPair[] {
  const pairs: OffsetPair[] = [];
  const rows = loanIds
    .map((id) => ({ id, a: l.accounts.get(id)!, s: loanSummary(l, id) }))
    .filter((r) => r.a && !r.a.archived && r.s.balance !== 0)
    .sort((x, y) => (x.s.openItems[0]?.date ?? x.a.startDate).localeCompare(y.s.openItems[0]?.date ?? y.a.startDate));
  for (const currency of ['BDT', 'USD'] as Currency[]) {
    const owed = rows.filter((r) => r.a.currency === currency && r.s.balance > 0).map((r) => ({ id: r.id, left: r.s.balance }));
    const owe = rows.filter((r) => r.a.currency === currency && r.s.balance < 0).map((r) => ({ id: r.id, left: -r.s.balance }));
    let i = 0;
    let j = 0;
    while (i < owed.length && j < owe.length) {
      const amount = Math.min(owed[i]!.left, owe[j]!.left);
      pairs.push({ from: owed[i]!.id, to: owe[j]!.id, amount, currency });
      owed[i]!.left -= amount;
      owe[j]!.left -= amount;
      if (owed[i]!.left === 0) i++;
      if (owe[j]!.left === 0) j++;
    }
  }
  return pairs;
}

/** Whether a money account is listed on Home (4.1). Accounts saved before the switch existed follow "count in the Home total". */
export const shownOnHome = (a: Account): boolean => a.showOnHome ?? a.includeInTotal;

// ---------- Combining two entries (spec 6.7) ----------

const OUTSIDE = 'outside';

/** Where an entry's money comes from and goes to; OUTSIDE for spending and income. Null when it can't be combined. */
function ends(e: Entry): { from: string; to: string } | null {
  if (e.kind === 'expense') return { from: e.accountId, to: OUTSIDE };
  if (e.kind === 'income') return { from: OUTSIDE, to: e.accountId };
  if (e.kind === 'transfer' && e.toAccountId) return { from: e.accountId, to: e.toAccountId };
  return null;
}

export type CombinePlan =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** The account the money only passed through. */
      middle: string;
      amount: number;
      inflowId: string;
      outflowId: string;
      /** The direct entry that replaces the two. */
      combined: Entry;
      /** What's left of the larger entry, if the amounts differ. */
      leftover: Entry | null;
    };

/**
 * Two entries where money came into an account and went straight out again become one
 * direct entry (and a leftover when the amounts differ). Balances and totals never change:
 * the middle account's in and out cancel each other.
 */
export function combinePlan(l: Ledger, aId: string, bId: string): CombinePlan {
  const a = l.entries.get(aId);
  const b = l.entries.get(bId);
  if (!a || !b || a.deletedAt || b.deletedAt) return { ok: false, reason: 'One of these entries no longer exists.' };
  const hasChildren = (id: string) => [...l.entries.values()].some((c) => c.parentId === id && !c.deletedAt);
  for (const [id, e] of [[aId, a], [bId, b]] as const) {
    if (e.kind === 'correction') return { ok: false, reason: 'Balance corrections can’t be combined.' };
    if (e.parentId || hasChildren(id)) return { ok: false, reason: 'Entries with a fee or interest attached can’t be combined.' };
    if (e.loanAction === 'writeoff' || e.loanAction === 'offset') return { ok: false, reason: 'Write-offs and cancel-outs can’t be combined.' };
    if (e.toAmount !== undefined) return { ok: false, reason: 'Currency exchanges can’t be combined.' };
    if (e.groupId || e.accountId === DIRECT) return { ok: false, reason: 'Entries saved together (a split payment) can’t be combined.' };
  }
  const ea = ends(a)!;
  const eb = ends(b)!;
  let inflowId: string, outflowId: string, inflow: Entry, outflow: Entry, middle: string;
  if (ea.to !== OUTSIDE && ea.to === eb.from) [inflowId, inflow, outflowId, outflow, middle] = [aId, a, bId, b, ea.to];
  else if (eb.to !== OUTSIDE && eb.to === ea.from) [inflowId, inflow, outflowId, outflow, middle] = [bId, b, aId, a, eb.to];
  else return { ok: false, reason: 'These don’t pass through the same account: one has to bring money into an account and the other take it out of that same account.' };
  const src = ends(inflow)!.from;
  const dst = ends(outflow)!.to;
  if (src === OUTSIDE && dst === OUTSIDE) return { ok: false, reason: 'This is income and spending. They are already right as two entries, because both count in Stats.' };
  if (src === dst) return { ok: false, reason: 'The money went out and came back to the same place, so there is nothing to combine.' };
  const cur = (id: string) => (id === OUTSIDE ? null : (l.accounts.get(id)?.currency ?? null));
  const curs = [cur(src), cur(middle), cur(dst)].filter(Boolean);
  if (new Set(curs).size > 1) return { ok: false, reason: 'Taka and dollars can’t be combined.' };

  const amount = Math.min(inflow.amount, outflow.amount);
  const later = inflow.date > outflow.date ? inflow.date : outflow.date;
  const note = outflow.note || inflow.note;
  const base = { amount, createdAt: new Date().toISOString(), combinedFrom: [inflowId, outflowId] };
  let combined: Entry;
  if (dst === OUTSIDE) {
    combined = { ...base, kind: 'expense', date: outflow.date, accountId: src, categoryId: outflow.categoryId, note };
  } else if (src === OUTSIDE) {
    combined = { ...base, kind: 'income', date: inflow.date, accountId: dst, categoryId: inflow.categoryId, note: inflow.note || outflow.note };
  } else {
    const isLoan = (id: string) => l.accounts.get(id)?.kind === 'loan';
    const loanAction = isLoan(src) && isLoan(dst) ? undefined : isLoan(dst) ? outflow.loanAction : isLoan(src) ? inflow.loanAction : undefined;
    combined = { ...base, kind: 'transfer', date: later, accountId: src, toAccountId: dst, loanAction, note };
  }
  const rest = (e: Entry): Entry => ({ ...e, amount: e.amount - amount, createdAt: new Date().toISOString(), combinedFrom: [inflowId, outflowId], combinedInto: undefined });
  const leftover = inflow.amount > amount ? rest(inflow) : outflow.amount > amount ? rest(outflow) : null;
  for (const k of Object.keys(combined) as (keyof Entry)[]) if (combined[k] === undefined) delete combined[k];
  return { ok: true, middle, amount, inflowId, outflowId, combined, leftover };
}

/** Lists show records saved together (a split payment) once: the first part stands for the group. */
export function collapseGroups(list: IdEntry[]): IdEntry[] {
  const seen = new Set<string>();
  return list.filter(([, e]) => {
    if (!e.groupId) return true;
    if (seen.has(e.groupId)) return false;
    seen.add(e.groupId);
    return true;
  });
}

/** The live records saved together with this group id, oldest first. */
export function groupParts(l: Ledger, groupId: string): IdEntry[] {
  return liveEntries(l).filter(([, e]) => e.groupId === groupId);
}
