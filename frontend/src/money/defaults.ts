import type { Category, Settings } from './types.ts';

/** Default categories for a new user (spec section 8). Users can rename, hide or add. */
export const DEFAULT_CATEGORIES: Omit<Category, 'sortOrder'>[] = [
  { kind: 'expense', name: 'Food & Groceries', slot: 1, icon: 'cart', hidden: false },
  { kind: 'expense', name: 'Eating Out', slot: 4, icon: 'cup', hidden: false },
  { kind: 'expense', name: 'Transport', slot: 5, icon: 'bus', hidden: false },
  { kind: 'expense', name: 'Rent', slot: 6, icon: 'home', hidden: false },
  { kind: 'expense', name: 'Bills & Utilities', slot: 3, icon: 'bolt', hidden: false },
  { kind: 'expense', name: 'Mobile & Internet', slot: 6, icon: 'wifi', hidden: false },
  { kind: 'expense', name: 'Shopping', slot: 2, icon: 'bag', hidden: false },
  { kind: 'expense', name: 'Clothing', slot: 2, icon: 'bag', hidden: false },
  { kind: 'expense', name: 'Health', slot: 5, icon: 'heart', hidden: false },
  { kind: 'expense', name: 'Education', slot: 1, icon: 'book', hidden: false },
  { kind: 'expense', name: 'Family', slot: 4, icon: 'person', hidden: false },
  { kind: 'expense', name: 'Gifts & Donations', slot: 5, icon: 'gift', hidden: false },
  { kind: 'expense', name: 'Entertainment', slot: 6, icon: 'star', hidden: false },
  { kind: 'expense', name: 'Travel', slot: 3, icon: 'plane', hidden: false },
  { kind: 'expense', name: 'Personal Care', slot: 4, icon: 'heart', hidden: false },
  { kind: 'expense', name: 'Fees & Charges', slot: 0, icon: 'percent', hidden: false, system: 'fees' },
  { kind: 'expense', name: 'Interest Paid', slot: 0, icon: 'percent', hidden: false, system: 'interest_paid' },
  { kind: 'expense', name: 'Written-off Loans', slot: 0, icon: 'gift', hidden: false, system: 'writeoff' },
  { kind: 'expense', name: 'Other', slot: 0, icon: 'dots', hidden: false },
  { kind: 'income', name: 'Salary', slot: 3, icon: 'in', hidden: false },
  { kind: 'income', name: 'Business', slot: 1, icon: 'in', hidden: false },
  { kind: 'income', name: 'Freelance', slot: 6, icon: 'in', hidden: false },
  { kind: 'income', name: 'Interest', slot: 4, icon: 'percent', hidden: false, system: 'interest' },
  { kind: 'income', name: 'Gift', slot: 5, icon: 'gift', hidden: false, system: 'gift' },
  { kind: 'income', name: 'Other', slot: 0, icon: 'dots', hidden: false },
];

export function defaultSettings(): Settings {
  return {
    style: 'colour',
    theme: 'system',
    numberFormat: 'bd',
    rateMode: 'auto',
    ownRates: [],
    setupStep: 3,
    createdAt: new Date().toISOString(),
  };
}

/** Used only when no dollar rate has ever been fetched or set. Shown as an estimate. */
export const FALLBACK_RATE = 122;
