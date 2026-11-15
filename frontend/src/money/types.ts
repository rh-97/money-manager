/**
 * The plaintext shape of each encrypted record (spec 15.3). These only ever
 * exist in the browser; the server stores them encrypted.
 *
 * Money is always an integer in the smallest unit (paisa or cents).
 */

export type Currency = 'BDT' | 'USD';

export type MoneyAccountType = 'bank' | 'wallet' | 'cash' | 'card' | 'savings' | 'other';
export type LoanAccountType = 'person' | 'bank' | 'organization' | 'other';

export interface Account {
  kind: 'money' | 'loan';
  type: MoneyAccountType | LoanAccountType;
  name: string;
  currency: Currency;
  /**
   * Money accounts: the balance on the start date (negative for a credit card that is owed).
   * Loan accounts: positive = they owe me, negative = I owe them.
   */
  startingBalance: number;
  startDate: string; // YYYY-MM-DD
  includeInTotal: boolean;
  /** Show dots instead of the balance until tapped (for people looking over your shoulder). */
  hideBalance?: boolean;
  archived: boolean;
  slot: number; // colour slot 1-6
  note?: string;
  phone?: string;
  interestRate?: number; // savings, percent per year
  maturityDate?: string; // savings
  sortOrder: number;
}

export type SystemCategory = 'fees' | 'interest_paid' | 'writeoff' | 'interest' | 'gift';

export interface Category {
  kind: 'expense' | 'income';
  name: string;
  slot: number; // colour slot 0-6 (0 = grey)
  icon: string;
  hidden: boolean;
  sortOrder: number;
  system?: SystemCategory;
}

/**
 * - expense / income: one money (or loan, for write-offs) account and a category
 * - transfer: from accountId to toAccountId (lend, borrow, repay and exchange are transfers)
 * - correction: a signed adjustment to one money account, not counted as spending or income
 */
export type EntryKind = 'expense' | 'income' | 'transfer' | 'correction';
export type LoanAction = 'lend' | 'borrow' | 'repay' | 'writeoff';

export interface Entry {
  kind: EntryKind;
  date: string; // YYYY-MM-DD
  /** Positive amount in the source account's currency. Corrections are signed. */
  amount: number;
  accountId: string;
  toAccountId?: string;
  /** Amount received, in the destination currency, when currencies differ. */
  toAmount?: number;
  categoryId?: string;
  note?: string;
  /** Set on fee, interest and write-off child entries; they are deleted with the parent. */
  parentId?: string;
  /** What a loan-related entry means, for display. */
  loanAction?: LoanAction;
  createdAt: string; // ISO time, orders entries within a day
  /** Set when moved to Recently deleted. */
  deletedAt?: string;
}

export interface OwnRatePeriod {
  rate: number; // BDT per USD
  from: string; // YYYY-MM-DD
  to: string | null; // null = still in use
}

export interface Settings {
  style: 'colour' | 'ink';
  theme: 'light' | 'dark' | 'system';
  numberFormat: 'bd' | 'intl';
  rateMode: 'auto' | 'own';
  ownRates: OwnRatePeriod[];
  setupStep: number; // 0 = done; otherwise the next step of first-time setup to show
  /** The day the user started recording (setup step 3); default start date for new accounts. */
  startDate?: string;
  createdAt: string;
}

export interface RecordMap {
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
  entries: Map<string, Entry>;
  settings: Settings;
}
