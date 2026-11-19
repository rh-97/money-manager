import { beforeAll, describe, expect, it } from 'vitest';
import { cryptoReady } from '@mm/shared';
import { balances, loanSummary, periodStats, totals, type Ledger } from './calc.ts';
import { DEFAULT_CATEGORIES, defaultSettings } from './defaults.ts';
import { DIRECT, planFromTo, problems, sentences, warnings, type FromToInput, type Pick as FtPick } from './fromto.ts';
import type { Account, Category, Entry } from './types.ts';

beforeAll(async () => {
  await cryptoReady();
});

const tk = (n: number) => n * 100;
const DAY = '2026-11-20';

function account(p: Partial<Account> & { name: string }): Account {
  return { kind: 'money', type: 'bank', currency: 'BDT', startingBalance: 0, startDate: '2026-11-01', includeInTotal: true, archived: false, slot: 1, sortOrder: 0, ...p };
}
const loan = (name: string, startingBalance: number, purpose?: string, extra: Partial<Account> = {}) => account({ name, kind: 'loan', type: 'person', startingBalance, purpose, ...extra });

function ledger(): Ledger & { cat: (n: string) => string } {
  const categories = new Map<string, Category>(DEFAULT_CATEGORIES.map((c, i) => [`cat${i}`, { ...c, sortOrder: i }]));
  const accounts = new Map<string, Account>(
    Object.entries({
      city: account({ name: 'City Bank', startingBalance: tk(50000) }),
      bkash: account({ name: 'bKash', startingBalance: tk(3000) }),
      cash: account({ name: 'Cash', type: 'cash', startingBalance: tk(1500) }),
      usd: account({ name: 'Dollar account', currency: 'USD', startingBalance: 32000 }),
      bike: loan('Rafi', tk(7000), 'Bike repair'),
      rent: loan('Rafi', tk(-4000), 'Rent share'),
      tuition: loan('Nabila', tk(4000), 'Tuition'),
      laptop: loan('Sajid', tk(-6000), 'Laptop'),
      uncle: loan('Uncle', tk(-20000), 'Bike'),
      brac: loan('BRAC Bank', tk(-10000), 'Home loan', { type: 'bank' }),
    }),
  );
  const l = { accounts, categories, entries: new Map<string, Entry>(), settings: defaultSettings(), rates: [{ date: '2026-11-01', usdToBdt: 122, source: 'test' }] };
  return Object.assign(l, { cat: (n: string) => [...categories].find(([, c]) => c.name === n)![0] });
}

const acct = (id: string): FtPick => ({ type: 'acct', id });
const lo = (id: string): FtPick => ({ type: 'loan', id });
const input = (p: Partial<FromToInput>): FromToInput => ({ sources: [], to: null, date: DAY, today: DAY, ...p });
function save(l: Ledger, i: FromToInput) {
  expect(problems(l, i)).toEqual([]);
  const plan = planFromTo(l, i);
  for (const a of plan.accounts) l.accounts.set(a.id, a.value);
  for (const e of plan.entries) l.entries.set(e.id, e.value);
  return plan;
}
const month = (l: Ledger) => periodStats(l, '2026-11-01', '2026-11-30');

describe('From / To (6.1)', () => {
  it('splits a dinner: Rafi pays what he owes, Cash pays the rest; one group, spending counted once', () => {
    const l = ledger();
    const plan = save(l, input({ sources: [{ pick: lo('bike'), amount: tk(7000), fee: 0 }, { pick: acct('cash'), amount: tk(3000), fee: 0 }], to: { type: 'expense' }, expenseCategoryId: l.cat('Eating Out'), note: 'Dinner' }));
    expect(plan.entries).toHaveLength(2);
    expect(new Set(plan.entries.map((e) => e.value.groupId)).size).toBe(1);
    expect(loanSummary(l, 'bike').status).toBe('settled');
    expect(balances(l).get('cash')).toBe(tk(-1500));
    expect(month(l).spent).toBe(tk(10000));
  });

  it('takes a separate fee from each account that charges one', () => {
    const l = ledger();
    const plan = save(l, input({ sources: [{ pick: acct('city'), amount: tk(4000), fee: tk(15) }, { pick: acct('bkash'), amount: tk(1000), fee: tk(20) }], to: { type: 'expense' }, expenseCategoryId: l.cat('Food') }));
    const fees = plan.entries.filter((e) => e.value.note === 'Fee');
    expect(fees.map((e) => [e.value.accountId, e.value.amount])).toEqual([['city', tk(15)], ['bkash', tk(20)]]);
    expect(fees.every((f) => f.value.parentId && !f.value.groupId)).toBe(true);
    expect(balances(l).get('city')).toBe(tk(50000 - 4015));
    expect(balances(l).get('bkash')).toBe(tk(3000 - 1020));
    expect(month(l).spent).toBe(tk(5035));
  });

  it('a friend who owes me pays someone I owe: no money account changes', () => {
    const l = ledger();
    const before = totals(l, DAY);
    save(l, input({ sources: [{ pick: lo('tuition'), amount: tk(1500), fee: 0 }], to: lo('laptop') }));
    expect(loanSummary(l, 'tuition').balance).toBe(tk(2500));
    expect(loanSummary(l, 'laptop').balance).toBe(tk(-4500));
    expect(totals(l, DAY)).toMatchObject({ moneyHave: before.moneyHave, netWorth: before.netWorth });
  });

  it('income paid to my uncle counts as income and lowers what I owe him', () => {
    const l = ledger();
    save(l, input({ sources: [{ pick: { type: 'income' }, amount: tk(15000), fee: 0 }], to: lo('uncle'), incomeCategoryId: l.cat('Freelance') }));
    expect(loanSummary(l, 'uncle').balance).toBe(tk(-5000));
    expect(month(l).income).toBe(tk(15000));
  });

  it('income paid straight to an expense: earned and spent, no account touched', () => {
    const l = ledger();
    const before = [...balances(l)];
    const plan = save(l, input({ sources: [{ pick: { type: 'income' }, amount: tk(12000), fee: 0 }], to: { type: 'expense' }, incomeCategoryId: l.cat('Salary'), expenseCategoryId: l.cat('Rent') }));
    expect(plan.entries.map((e) => [e.value.kind, e.value.accountId])).toEqual([['income', DIRECT], ['expense', DIRECT]]);
    expect(plan.entries[0]!.value.groupId).toBe(plan.entries[1]!.value.groupId);
    expect(month(l)).toMatchObject({ income: tk(12000), spent: tk(12000) });
    expect([...balances(l)].filter(([id]) => id !== DIRECT)).toEqual(before);
  });

  it('a new loan in From: Rafi pays a dinner and I owe him, under the existing Rafi', () => {
    const l = ledger();
    const plan = save(l, input({ sources: [{ pick: { type: 'new' }, amount: tk(5000), fee: 0 }], to: { type: 'expense' }, expenseCategoryId: l.cat('Eating Out'), newFrom: { name: '  rafi ' }, note: 'Dinner' }));
    expect(plan.accounts[0]!.value).toMatchObject({ name: 'Rafi', purpose: 'Dinner', kind: 'loan' });
    expect(loanSummary(l, plan.accounts[0]!.id).balance).toBe(tk(-5000));
  });

  it('a new loan in To: lending from City Bank', () => {
    const l = ledger();
    const plan = save(l, input({ sources: [{ pick: acct('city'), amount: tk(20000), fee: 0 }], to: { type: 'new' }, newTo: { name: 'Karim', purpose: 'Fridge' } }));
    expect(plan.entries[0]!.value).toMatchObject({ kind: 'transfer', loanAction: 'lend', accountId: 'city' });
    expect(loanSummary(l, plan.accounts[0]!.id).balance).toBe(tk(20000));
  });

  it('a bank EMI with interest: the interest part is spending, the rest lowers the loan', () => {
    const l = ledger();
    const plan = save(l, input({ sources: [{ pick: acct('city'), amount: tk(5000), fee: 0 }], to: lo('brac'), interest: tk(1000) }));
    expect(plan.entries[0]!.value).toMatchObject({ loanAction: 'repay', amount: tk(4000) });
    expect(loanSummary(l, 'brac').balance).toBe(tk(-6000));
    expect(month(l).spent).toBe(tk(1000));
  });

  it('writing off what Nabila owes counts as spending and settles the loan', () => {
    const l = ledger();
    const writeoff = [...l.categories].find(([, c]) => c.system === 'writeoff')![0];
    const plan = save(l, input({ sources: [{ pick: lo('tuition'), amount: tk(4000), fee: 0 }], to: { type: 'expense' }, expenseCategoryId: writeoff }));
    expect(plan.entries[0]!.value.loanAction).toBe('writeoff');
    expect(loanSummary(l, 'tuition').status).toBe('settled');
  });

  it('exchanges dollars into taka', () => {
    const l = ledger();
    save(l, input({ sources: [{ pick: acct('usd'), amount: 10000, fee: 0 }], to: acct('city'), received: tk(12240) }));
    expect(balances(l).get('usd')).toBe(22000);
    expect(balances(l).get('city')).toBe(tk(62240));
  });

  it('explains what can’t be saved, and warns before saving when something looks off', () => {
    const l = ledger();
    expect(problems(l, input({ sources: [{ pick: acct('cash'), amount: tk(10), fee: 0 }], to: acct('cash') }))).toContain('The same account can’t be on both sides.');
    expect(problems(l, input({ sources: [{ pick: acct('usd'), amount: 100, fee: 0 }, { pick: acct('cash'), amount: tk(1), fee: 0 }], to: { type: 'expense' }, expenseCategoryId: 'x' }))).toContain('Sources in taka and dollars can’t be mixed in one entry.');
    expect(problems(l, input({ sources: [{ pick: acct('cash'), amount: tk(10), fee: 0 }], to: { type: 'expense' } }))).toContain('Pick what it was spent on.');
    const w = warnings(l, input({ sources: [{ pick: lo('bike'), amount: tk(10000), fee: 0 }], to: { type: 'expense' } }));
    expect(w[0]).toMatch(/owes you only ৳7,000 on Bike repair\. After this you'd owe them ৳3,000/);
    expect(warnings(l, input({ sources: [{ pick: acct('cash'), amount: tk(2000), fee: 0 }], to: { type: 'expense' } }))[0]).toMatch(/Cash would go below zero/);
  });

  it('describes the entry in a sentence', () => {
    const l = ledger();
    const name = (id?: string) => (id ? (l.categories.get(id)?.name ?? '') : '');
    expect(sentences(l, input({ sources: [{ pick: lo('tuition'), amount: tk(1500), fee: 0 }], to: lo('laptop') }), name)).toEqual(['Nabila pays Sajid ৳1,500 for you.']);
    expect(sentences(l, input({ sources: [{ pick: acct('bkash'), amount: tk(500), fee: tk(5) }], to: { type: 'expense' }, expenseCategoryId: l.cat('Bills & Utilities') }), name)).toEqual([
      'You spend ৳500 on Bills & Utilities from bKash.',
      'Plus a ৳5 fee from bKash (Fees & charges).',
    ]);
  });
});
