/**
 * The plaintext shape of each encrypted record (spec 15.3). These only ever
 * exist in the browser; the server stores them encrypted.
 *
 * Money is always an integer in the smallest unit (paisa or cents).
 */

export type Currency = 'BDT' | 'USD';

export type MoneyAccountType = 'bank' | 'wallet' | 'ewallet' | 'cash' | 'card' | 'savings' | 'other';
export type LoanAccountType = 'person' | 'bank' | 'organization' | 'other';

export interface Account {
  kind: 'money' | 'loan';
  type: MoneyAccountType | LoanAccountType;
  /** Money accounts: the account's name. Loan accounts: the person or organization. */
  name: string;
  /** Loan accounts: what the loan is for (e.g. "Fridge"), shown as its headline. */
  purpose?: string;
  currency: Currency;
  /**
   * Money accounts: the balance on the start date (negative for a credit card that is owed).
   * Loan accounts: positive = they owe me, negative = I owe them.
   */
  startingBalance: number;
  startDate: string; // YYYY-MM-DD
  includeInTotal: boolean;
  /** Money accounts: listed among Home's account cards. Unset = same as includeInTotal (how it worked before). */
  showOnHome?: boolean;
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
/** offset: two loans with the same person in opposite directions cancelled against each other (7.9). */
export type LoanAction = 'lend' | 'borrow' | 'repay' | 'writeoff' | 'offset';

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
  /** Records saved together from one Add (a split payment, or income paid straight to an expense) share this id and show as one in lists. */
  groupId?: string;
  /** Made by combining two entries (6.7): the ids of the originals, kept for "Undo combine". */
  combinedFrom?: string[];
  /** An original that was combined into another entry; hidden from Recently deleted. */
  combinedInto?: string;
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
  /** Card contrast level 0-5 (lib/contrast.ts); unset = the default level. */
  contrast?: number;
  rateMode: 'auto' | 'own';
  ownRates: OwnRatePeriod[];
  setupStep: number; // 0 = done; otherwise the next step of first-time setup to show
  /** The day the user started recording (setup step 3); default start date for new accounts. */
  startDate?: string;
  /** Accounts tab PIN: a keyed check value (see pinCheck) and the PIN's length. Absent = no PIN. */
  accountsPin?: { check: string; length: number };
  createdAt: string;
}

export interface RecordMap {
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
  entries: Map<string, Entry>;
  settings: Settings;
}
