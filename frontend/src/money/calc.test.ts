import { beforeAll, describe, expect, it } from 'vitest';
import { cryptoReady } from '@mm/shared';
import { accountLabel, balances, combinePlan, shownOnHome, dailySpending, groupByPerson, insights, loanSummary, loanTitle, monthlySeries, offsetPlan, periodStats, rateOn, totals, type Ledger } from './calc.ts';
import { cancelOut, combine, uncombine, correction, expenseOrIncome, repay, transfer, writeOff } from './actions.ts';
import { DEFAULT_CATEGORIES, defaultSettings } from './defaults.ts';
import type { Account, Category, Entry } from './types.ts';

beforeAll(async () => {
  await cryptoReady();
});

const tk = (n: number): number => n * 100; // taka to paisa

function account(p: Partial<Account> & Pick<Account, 'name'>): Account {
  return { kind: 'money', type: 'bank', currency: 'BDT', startingBalance: 0, startDate: '2026-11-01', includeInTotal: true, archived: false, slot: 1, sortOrder: 0, ...p };
}

function ledger(accounts: Record<string, Account>): Ledger & { add: (items: { id: string; value: Entry }[]) => void; cat: (name: string) => string } {
  const categories = new Map<string, Category>(DEFAULT_CATEGORIES.map((c, i) => [`cat${i}`, { ...c, sortOrder: i }]));
  const l = {
    accounts: new Map(Object.entries(accounts)),
    categories,
    entries: new Map<string, Entry>(),
    settings: defaultSettings(),
    rates: [
      { date: '2026-11-01', usdToBdt: 120, source: 'test' },
      { date: '2026-11-10', usdToBdt: 122, source: 'test' },
    ],
    add(items: { id: string; value: Entry }[]) {
      for (const i of items) l.entries.set(i.id, i.value);
    },
    cat(name: string) {
      return [...categories].find(([, c]) => c.name === name)![0];
    },
  };
  return l;
}

describe('balances', () => {
  it('records an expense paid by a friend as spending and as money I owe them', () => {
    const l = ledger({
      city: account({ name: 'City', startingBalance: tk(10000) }),
      rahim: account({ name: 'Rahim', kind: 'loan', type: 'person' }),
    });
    l.add(expenseOrIncome({ kind: 'expense', date: '2026-11-05', amount: tk(1200), accountId: 'rahim', categoryId: l.cat('Eating Out'), note: 'Dinner' }));
    expect(periodStats(l, '2026-11-01', '2026-11-30').spent).toBe(tk(1200));
    expect(loanSummary(l, 'rahim')).toMatchObject({ status: 'owe', balance: -tk(1200) });
    const t = totals(l, '2026-11-15');
    expect(t.moneyHave).toBe(tk(10000));
    expect(t.iOwe).toBe(tk(1200));
  });

  it('applies expenses, income and transfers with a fee', () => {
    const l = ledger({ bkash: account({ name: 'bKash', type: 'wallet', startingBalance: tk(15000) }), cash: account({ name: 'Cash', type: 'cash' }) });
    l.add(expenseOrIncome({ kind: 'expense', date: '2026-11-02', amount: tk(1250), accountId: 'bkash', categoryId: l.cat('Food') }));
    l.add(expenseOrIncome({ kind: 'income', date: '2026-11-03', amount: tk(3000), accountId: 'bkash', categoryId: l.cat('Freelance') }));
    l.add(transfer(l.categories, { date: '2026-11-04', amount: tk(10000), from: 'bkash', to: 'cash', fee: tk(185) }));
    const b = balances(l);
    expect(b.get('bkash')).toBe(tk(15000 - 1250 + 3000 - 10000 - 185));
    expect(b.get('cash')).toBe(tk(10000));
    const s = periodStats(l, '2026-11-01', '2026-11-30');
    expect(s.spent).toBe(tk(1250 + 185)); // the fee counts, the transfer does not
    expect(s.income).toBe(tk(3000));
    expect(s.byCategory.get(l.cat('Fees & Charges'))).toBe(tk(185));
  });

  it('records a currency exchange with both amounts', () => {
    const l = ledger({ usd: account({ name: 'Dollars', currency: 'USD', startingBalance: 50000 }), city: account({ name: 'City Bank' }) });
    l.add(transfer(l.categories, { date: '2026-11-05', amount: 10000, from: 'usd', to: 'city', toAmount: tk(12150) }));
    const b = balances(l);
    expect(b.get('usd')).toBe(40000);
    expect(b.get('city')).toBe(tk(12150));
  });

  it('keeps balance corrections out of spending', () => {
    const l = ledger({ bkash: account({ name: 'bKash', startingBalance: tk(5200) }) });
    l.add(correction({ date: '2026-11-09', accountId: 'bkash', current: tk(5200), real: tk(4950) }));
    expect(balances(l).get('bkash')).toBe(tk(4950));
    expect(periodStats(l, '2026-11-01', '2026-11-30').spent).toBe(0);
  });

  it('ignores deleted entries', () => {
    const l = ledger({ a: account({ name: 'A', startingBalance: tk(100) }) });
    const [e] = expenseOrIncome({ kind: 'expense', date: '2026-11-02', amount: tk(40), accountId: 'a', categoryId: l.cat('Transport') });
    l.add([{ id: e!.id, value: { ...e!.value, deletedAt: '2026-11-03T00:00:00Z' } }]);
    expect(balances(l).get('a')).toBe(tk(100));
  });
});

describe('totals and dollar rate', () => {
  it('converts dollars at the rate for the date and counts credit cards as negative', () => {
    const l = ledger({
      city: account({ name: 'City', startingBalance: tk(100000) }),
      usd: account({ name: 'Dollars', currency: 'USD', startingBalance: 32000 }), // $320.00
      card: account({ name: 'Card', type: 'card', startingBalance: tk(-8750) }),
      held: account({ name: 'Held', startingBalance: tk(5000), includeInTotal: false }),
      rahim: account({ name: 'Rahim', kind: 'loan', type: 'person', startingBalance: tk(-6000) }),
      karim: account({ name: 'Karim', kind: 'loan', type: 'person', startingBalance: tk(3000) }),
      later: account({ name: 'Uncle', kind: 'loan', type: 'person', startingBalance: tk(-50000), includeInTotal: false }),
    });
    const t = totals(l, '2026-11-15');
    expect(t.moneyHave).toBe(tk(100000) + 32000 * 122 - tk(8750));
    expect(t.iOwe).toBe(tk(6000));
    expect(t.owedToMe).toBe(tk(3000));
    expect(t.netWorth).toBe(t.moneyHave + tk(3000) - tk(6000));
  });

  it('prefers my own rate for its period, then the latest automatic rate', () => {
    const l = ledger({});
    expect(rateOn(l, '2026-11-05')).toMatchObject({ rate: 120, source: 'auto' });
    expect(rateOn(l, '2026-11-15')).toMatchObject({ rate: 122, source: 'auto' });
    l.settings.ownRates = [{ rate: 125, from: '2026-11-12', to: null }];
    expect(rateOn(l, '2026-11-15')).toMatchObject({ rate: 125, source: 'own' });
    expect(rateOn(l, '2026-11-11')).toMatchObject({ rate: 122, source: 'auto' });
  });

  it('falls back to an estimate when no rate exists', () => {
    const l = ledger({});
    l.rates = [];
    expect(rateOn(l, '2026-11-15').source).toBe('fallback');
  });
});

describe('loans', () => {
  function loanLedger() {
    return ledger({
      city: account({ name: 'City Bank', startingBalance: tk(50000) }),
      bkash: account({ name: 'bKash', startingBalance: tk(20000) }),
      rahim: account({ name: 'Rahim', kind: 'loan', type: 'person' }),
    });
  }

  it('borrows and repays in parts until settled (spec 7.2)', () => {
    const l = loanLedger();
    l.add(transfer(l.categories, { date: '2026-11-01', amount: tk(10000), from: 'rahim', to: 'city', loanAction: 'borrow' }));
    let s = loanSummary(l, 'rahim');
    expect(s).toMatchObject({ balance: tk(-10000), status: 'owe', cycleAmount: tk(10000), repaid: 0 });
    l.add(repay(l.categories, { date: '2026-11-15', loanId: 'rahim', moneyId: 'bkash', loanBalance: s.balance, amount: tk(4000) }));
    s = loanSummary(l, 'rahim');
    expect(s).toMatchObject({ balance: tk(-6000), repaid: tk(4000) });
    l.add(repay(l.categories, { date: '2026-12-01', loanId: 'rahim', moneyId: 'city', loanBalance: s.balance, amount: tk(6000) }));
    s = loanSummary(l, 'rahim');
    expect(s.status).toBe('settled');
    expect(balances(l).get('city')).toBe(tk(50000 + 10000 - 6000));
    // borrowing again reuses the same account and starts a new cycle
    l.add(transfer(l.categories, { date: '2027-03-10', amount: tk(3000), from: 'rahim', to: 'bkash', loanAction: 'borrow' }));
    s = loanSummary(l, 'rahim');
    expect(s).toMatchObject({ balance: tk(-3000), cycleAmount: tk(3000), repaid: 0 });
    expect(s.timeline).toHaveLength(4);
  });

  it('settles the oldest loan first', () => {
    const l = loanLedger();
    l.add(transfer(l.categories, { date: '2026-11-01', amount: tk(5000), from: 'city', to: 'rahim', loanAction: 'lend' }));
    l.add(transfer(l.categories, { date: '2026-11-05', amount: tk(2000), from: 'city', to: 'rahim', loanAction: 'lend' }));
    l.add(repay(l.categories, { date: '2026-11-10', loanId: 'rahim', moneyId: 'bkash', loanBalance: tk(7000), amount: tk(6000) }));
    const s = loanSummary(l, 'rahim');
    expect(s.balance).toBe(tk(1000));
    expect(s.openItems).toHaveLength(1);
    expect(s.openItems[0]).toMatchObject({ date: '2026-11-05', amount: tk(2000), remaining: tk(1000), direction: 1 });
  });

  it('flips direction when both sides lend to each other', () => {
    const l = loanLedger();
    l.add(transfer(l.categories, { date: '2026-11-01', amount: tk(3000), from: 'city', to: 'rahim', loanAction: 'lend' }));
    l.add(transfer(l.categories, { date: '2026-11-02', amount: tk(5000), from: 'rahim', to: 'city', loanAction: 'borrow' }));
    const s = loanSummary(l, 'rahim');
    expect(s).toMatchObject({ balance: tk(-2000), status: 'owe', cycleAmount: tk(2000) });
  });

  it('treats an opening balance as an existing loan without touching money accounts', () => {
    const l = loanLedger();
    l.accounts.set('karim', account({ name: 'Karim', kind: 'loan', type: 'person', startingBalance: tk(5000), startDate: '2026-10-02' }));
    expect(loanSummary(l, 'karim')).toMatchObject({ balance: tk(5000), status: 'owed' });
    expect(balances(l).get('city')).toBe(tk(50000));
  });

  it('splits interest out of an EMI as an expense', () => {
    const l = loanLedger();
    l.add(transfer(l.categories, { date: '2026-03-10', amount: tk(200000), from: 'rahim', to: 'city', loanAction: 'borrow' }));
    l.add(repay(l.categories, { date: '2026-11-05', loanId: 'rahim', moneyId: 'city', loanBalance: tk(-200000), amount: tk(9200), interest: tk(2325) }));
    expect(loanSummary(l, 'rahim').balance).toBe(tk(-200000 + 6875));
    expect(balances(l).get('city')).toBe(tk(50000 + 200000 - 9200));
    expect(periodStats(l, '2026-11-01', '2026-11-30').byCategory.get(l.cat('Interest Paid'))).toBe(tk(2325));
  });

  it('records interest received as income', () => {
    const l = loanLedger();
    l.add(transfer(l.categories, { date: '2026-10-01', amount: tk(5000), from: 'city', to: 'rahim', loanAction: 'lend' }));
    l.add(repay(l.categories, { date: '2026-11-01', loanId: 'rahim', moneyId: 'bkash', loanBalance: tk(5000), amount: tk(5500), interest: tk(500) }));
    expect(loanSummary(l, 'rahim').status).toBe('settled');
    expect(periodStats(l, '2026-11-01', '2026-11-30').income).toBe(tk(500));
  });

  it('refuses to repay more than is owed', () => {
    const l = loanLedger();
    expect(() => repay(l.categories, { date: '2026-11-01', loanId: 'rahim', moneyId: 'city', loanBalance: tk(-1000), amount: tk(1500) })).toThrow(/more than/);
  });

  it('writes off a loan as spending and settles it', () => {
    const l = loanLedger();
    l.add(transfer(l.categories, { date: '2026-11-01', amount: tk(1500), from: 'city', to: 'rahim', loanAction: 'lend' }));
    l.add(writeOff(l.categories, { date: '2026-11-20', loanId: 'rahim', loanBalance: tk(1500), asGift: false }));
    expect(loanSummary(l, 'rahim').status).toBe('settled');
    const s = periodStats(l, '2026-11-01', '2026-11-30');
    expect(s.spent).toBe(tk(1500));
    expect(s.byCategory.get(l.cat('Written-off Loans'))).toBe(tk(1500));
  });

  it('excludes lending and borrowing from income and spending', () => {
    const l = loanLedger();
    l.add(transfer(l.categories, { date: '2026-11-01', amount: tk(5000), from: 'city', to: 'rahim', loanAction: 'lend' }));
    l.add(transfer(l.categories, { date: '2026-11-02', amount: tk(9000), from: 'rahim', to: 'city', loanAction: 'borrow' }));
    expect(periodStats(l, '2026-11-01', '2026-11-30')).toMatchObject({ spent: 0, income: 0 });
  });
});

describe('loan reasons, people and cancelling out (7.1, 7.9)', () => {
  const loan = (name: string, startingBalance: number, extra: Partial<Account> = {}) => account({ name, kind: 'loan', type: 'person', startingBalance, ...extra });

  it('shows the reason as the headline and groups loans by person', () => {
    const fridge = loan('Rafi', tk(-5000), { purpose: 'Fridge' });
    expect(loanTitle(fridge)).toBe('Fridge');
    expect(accountLabel(fridge)).toBe('Fridge · Rafi');
    expect(loanTitle(loan('Rafi', 0))).toBe('Rafi');
    expect(accountLabel(account({ name: 'City Bank', purpose: 'ignored' }))).toBe('City Bank');
    const groups = groupByPerson([{ a: fridge }, { a: loan('Karim', 0) }, { a: loan(' rafi ', 0, { purpose: 'Bike' }) }]);
    expect(groups.map((g) => [g.name, g.rows.length])).toEqual([['Rafi', 2], ['Karim', 1]]);
  });

  it('cancels the smaller side in full, oldest loans first, without touching money accounts', () => {
    const l = ledger({
      city: account({ name: 'City Bank', startingBalance: tk(10000) }),
      fridge: loan('Rafi', tk(-5000), { purpose: 'Fridge', startDate: '2026-10-01' }), // I owe 5,000
      phone: loan('Rafi', tk(-1000), { purpose: 'Phone', startDate: '2026-11-05' }), // I owe 1,000
      bike: loan('Rafi', tk(3000), { purpose: 'Bike', startDate: '2026-10-15' }), // he owes me 3,000
    });
    const plan = offsetPlan(l, ['fridge', 'phone', 'bike']);
    expect(plan).toEqual([{ from: 'bike', to: 'fridge', amount: tk(3000), currency: 'BDT' }]);
    const entries = cancelOut(plan, '2026-11-16');
    l.add(entries);
    expect(loanSummary(l, 'bike').status).toBe('settled');
    expect(loanSummary(l, 'fridge')).toMatchObject({ balance: tk(-2000), repaid: tk(3000) });
    expect(loanSummary(l, 'phone').balance).toBe(tk(-1000));
    expect(balances(l).get('city')).toBe(tk(10000));
    expect(periodStats(l, '2026-11-01', '2026-11-30')).toMatchObject({ spent: 0, income: 0 });
    expect(offsetPlan(l, ['fridge', 'phone', 'bike'])).toEqual([]);
  });

  it('spreads across several loans, links the entries, and never mixes currencies', () => {
    const l = ledger({
      a: loan('Rafi', tk(-2000), { startDate: '2026-10-01' }),
      b: loan('Rafi', tk(-2000), { startDate: '2026-10-02' }),
      c: loan('Rafi', tk(3000), { startDate: '2026-10-03' }),
      usd: loan('Rafi', 5000, { currency: 'USD' }),
    });
    const plan = offsetPlan(l, ['a', 'b', 'c', 'usd']);
    expect(plan).toEqual([
      { from: 'c', to: 'a', amount: tk(2000), currency: 'BDT' },
      { from: 'c', to: 'b', amount: tk(1000), currency: 'BDT' },
    ]);
    const entries = cancelOut(plan, '2026-11-16');
    expect(entries[1]!.value.parentId).toBe(entries[0]!.id);
    expect(entries.every((e) => e.value.loanAction === 'offset')).toBe(true);
  });
});

describe('Home account cards (4.1)', () => {
  it('follows "count in the Home total" until the account has its own setting', () => {
    expect(shownOnHome(account({ name: 'Cash', includeInTotal: true }))).toBe(true);
    expect(shownOnHome(account({ name: 'FDR', includeInTotal: false }))).toBe(false);
    expect(shownOnHome(account({ name: 'FDR', includeInTotal: false, showOnHome: true }))).toBe(true);
    expect(shownOnHome(account({ name: 'Nagad', includeInTotal: true, showOnHome: false }))).toBe(false);
  });
});

describe('people as accounts (6.6)', () => {
  const loan = (name: string, startingBalance: number, extra: Partial<Account> = {}) => account({ name, kind: 'loan', type: 'person', startingBalance, ...extra });

  it('a friend who owes me pays someone I owe: both loans move, my accounts and net worth do not', () => {
    const l = ledger({
      bkash: account({ name: 'bKash', startingBalance: tk(3000) }),
      nabila: loan('Nabila', tk(4000), { purpose: 'Tuition' }),
      sajid: loan('Sajid', tk(-6000), { purpose: 'Laptop' }),
    });
    const before = totals(l, '2026-11-20');
    l.add(repay(l.categories, { date: '2026-11-20', loanId: 'sajid', moneyId: 'nabila', loanBalance: tk(-6000), amount: tk(1500) }));
    expect(loanSummary(l, 'nabila').balance).toBe(tk(2500));
    expect(loanSummary(l, 'sajid').balance).toBe(tk(-4500));
    expect(balances(l).get('bkash')).toBe(tk(3000));
    expect(totals(l, '2026-11-20').netWorth).toBe(before.netWorth);
    expect(periodStats(l, '2026-11-01', '2026-11-30')).toMatchObject({ spent: 0, income: 0 });
  });

  it('a client pays my uncle: it counts as income and lowers what I owe him', () => {
    const l = ledger({ city: account({ name: 'City Bank' }), uncle: loan('Uncle', tk(-20000), { purpose: 'Bike' }) });
    l.add(expenseOrIncome({ kind: 'income', date: '2026-11-20', amount: tk(15000), accountId: 'uncle', categoryId: l.cat('Freelance') }));
    expect(loanSummary(l, 'uncle').balance).toBe(tk(-5000));
    expect(balances(l).get('city')).toBe(0);
    expect(periodStats(l, '2026-11-01', '2026-11-30').income).toBe(tk(15000));
  });
});

describe('combining two entries (6.7)', () => {
  const loan = (name: string, startingBalance: number) => account({ name, kind: 'loan', type: 'person', startingBalance });
  const snapshot = (l: Ledger) => ({ bals: [...balances(l)].sort(), t: totals(l, '2026-11-30'), s: periodStats(l, '2026-11-01', '2026-11-30') });

  it('a repayment into Cash and a bill paid from Cash become "paid by Tanvir" plus the leftover, with no total changing', () => {
    const l = ledger({ cash: account({ name: 'Cash', startingBalance: tk(1000) }), tanvir: loan('Tanvir', tk(3000)) });
    l.add([{ id: 'in', value: transfer(l.categories, { date: '2026-11-10', amount: tk(3000), from: 'tanvir', to: 'cash', loanAction: 'repay' })[0]!.value }]);
    l.add([{ id: 'out', value: expenseOrIncome({ kind: 'expense', date: '2026-11-10', amount: tk(3500), accountId: 'cash', categoryId: l.cat('Bills & Utilities'), note: 'Electricity' })[0]!.value }]);
    const before = snapshot(l);
    const plan = combinePlan(l, 'out', 'in');
    expect(plan).toMatchObject({ ok: true, middle: 'cash', amount: tk(3000), inflowId: 'in', outflowId: 'out' });
    if (!plan.ok) return;
    expect(plan.combined).toMatchObject({ kind: 'expense', accountId: 'tanvir', amount: tk(3000), note: 'Electricity' });
    expect(plan.leftover).toMatchObject({ kind: 'expense', accountId: 'cash', amount: tk(500) });
    for (const c of combine(l, plan)) l.entries.set(c.id, c.value);
    expect(snapshot(l)).toEqual(before);
    expect(loanSummary(l, 'tanvir').status).toBe('settled');
    // Undo brings the two originals back
    const combinedId = [...l.entries].find(([, e]) => e.combinedFrom && e.accountId === 'tanvir')![0];
    for (const c of uncombine(l, combinedId)!) ('delete' in c ? l.entries.delete(c.id) : l.entries.set(c.id, c.value));
    expect(l.entries.get('in')!.deletedAt).toBeUndefined();
    expect([...l.entries.values()].filter((e) => !e.deletedAt)).toHaveLength(2);
    expect(snapshot(l)).toEqual(before);
  });

  it('two transfers through bKash become one person-to-person payment', () => {
    const l = ledger({ bkash: account({ name: 'bKash' }), nabila: loan('Nabila', tk(4000)), sajid: loan('Sajid', tk(-6000)) });
    l.add([{ id: 'a', value: transfer(l.categories, { date: '2026-11-20', amount: tk(4000), from: 'nabila', to: 'bkash', loanAction: 'repay' })[0]!.value }]);
    l.add([{ id: 'b', value: transfer(l.categories, { date: '2026-11-20', amount: tk(4000), from: 'bkash', to: 'sajid', loanAction: 'repay' })[0]!.value }]);
    const plan = combinePlan(l, 'a', 'b');
    expect(plan).toMatchObject({ ok: true, leftover: null, combined: { kind: 'transfer', accountId: 'nabila', toAccountId: 'sajid', amount: tk(4000) } });
  });

  it('refuses what would change a balance or a total', () => {
    const l = ledger({ cash: account({ name: 'Cash' }), city: account({ name: 'City Bank' }), rafi: loan('Rafi', 0) });
    const add = (id: string, e: Entry) => l.entries.set(id, e);
    add('borrow', transfer(l.categories, { date: '2026-11-20', amount: tk(1000), from: 'rafi', to: 'cash', loanAction: 'borrow' })[0]!.value);
    add('bill', expenseOrIncome({ kind: 'expense', date: '2026-11-20', amount: tk(1000), accountId: 'city', categoryId: l.cat('Health') })[0]!.value);
    add('salary', expenseOrIncome({ kind: 'income', date: '2026-11-20', amount: tk(1000), accountId: 'cash', categoryId: l.cat('Salary') })[0]!.value);
    add('lunch', expenseOrIncome({ kind: 'expense', date: '2026-11-20', amount: tk(1000), accountId: 'cash', categoryId: l.cat('Eating Out') })[0]!.value);
    add('lunch2', expenseOrIncome({ kind: 'expense', date: '2026-11-20', amount: tk(1000), accountId: 'cash', categoryId: l.cat('Eating Out') })[0]!.value);
    expect(combinePlan(l, 'borrow', 'bill')).toMatchObject({ ok: false, reason: expect.stringMatching(/same account/) });
    expect(combinePlan(l, 'salary', 'lunch')).toMatchObject({ ok: false, reason: expect.stringMatching(/income and spending/) });
    expect(combinePlan(l, 'lunch', 'lunch2')).toMatchObject({ ok: false });
  });
});

describe('stats', () => {
  it('builds monthly series, daily spending and insights', () => {
    const l = ledger({ a: account({ name: 'A', startingBalance: tk(100000), startDate: '2026-09-01' }) });
    const food = l.cat('Food');
    l.add(expenseOrIncome({ kind: 'expense', date: '2026-10-05', amount: tk(5000), accountId: 'a', categoryId: food }));
    l.add(expenseOrIncome({ kind: 'expense', date: '2026-11-03', amount: tk(6500), accountId: 'a', categoryId: food }));
    l.add(expenseOrIncome({ kind: 'income', date: '2026-11-01', amount: tk(82000), accountId: 'a', categoryId: l.cat('Salary') }));
    const series = monthlySeries(l, '2026-11', 3);
    expect(series.map((m) => m.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(series[2]).toMatchObject({ income: tk(82000), spent: tk(6500) });
    const daily = dailySpending(l, '2026-11');
    expect(daily).toHaveLength(30);
    expect(daily[2]).toBe(tk(6500));
    const ins = insights(l, '2026-11-15', (n) => String(n / 100));
    expect(ins.some((i) => i.before === 'Food is up ' && i.strong === '30%')).toBe(true);
    expect(ins.some((i) => i.after.includes('more than all of October'))).toBe(true);
  });
});
