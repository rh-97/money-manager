import { beforeAll, describe, expect, it } from 'vitest';
import { cryptoReady } from '@mm/shared';
import { balances, dailySpending, insights, loanSummary, monthlySeries, periodStats, rateOn, totals, type Ledger } from './calc.ts';
import { correction, expenseOrIncome, repay, transfer, writeOff } from './actions.ts';
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
    l.add(expenseOrIncome({ kind: 'expense', date: '2026-11-02', amount: tk(1250), accountId: 'bkash', categoryId: l.cat('Food & Groceries') }));
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

describe('stats', () => {
  it('builds monthly series, daily spending and insights', () => {
    const l = ledger({ a: account({ name: 'A', startingBalance: tk(100000), startDate: '2026-09-01' }) });
    const food = l.cat('Food & Groceries');
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
    expect(ins.some((i) => i.before === 'Food & Groceries is up ' && i.strong === '30%')).toBe(true);
    expect(ins.some((i) => i.after.includes('more than all of October'))).toBe(true);
  });
});
