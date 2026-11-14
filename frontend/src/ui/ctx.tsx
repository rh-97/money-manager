import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Session } from '../lib/auth.ts';
import type { Change, Vault } from '../lib/vault.ts';
import { balances, type Ledger } from '../money/calc.ts';
import { fmtMoney } from '../lib/format.ts';
import type { Entry } from '../money/types.ts';
import { ACCOUNT_ICONS, Chip } from './icons.tsx';

export type AddKind = 'expense' | 'income' | 'transfer' | 'exchange' | 'lend' | 'borrow' | 'repay' | 'writeoff' | 'correction';
export interface AddPreset {
  kind?: AddKind;
  accountId?: string;
  loanId?: string;
}

export interface AppCtxValue {
  vault: Vault;
  ledger: Ledger & { settingsId: string | null };
  session: Session;
  loginKey: string;
  dataKey: Uint8Array;
  today: string;
  wide: boolean;
  xl: boolean;
  path: string;
  go: (path: string) => void;
  openAdd: (preset?: AddPreset) => void;
  openEntry: (id: string) => void;
  /** Saves changes; shows the conflict dialog or an error toast on failure. Returns true on success. */
  save: (changes: Change[], okMessage?: string) => Promise<boolean>;
  setSession: (s: Session) => void;
  setLoginKey: (k: string) => void;
  logout: () => void;
}

export const AppCtx = createContext<AppCtxValue | null>(null);
export function useApp(): AppCtxValue {
  const v = useContext(AppCtx);
  if (!v) throw new Error('useApp outside AppCtx');
  return v;
}

/** Current balance of every account, recomputed when records change. */
export function useBalances(): Map<string, number> {
  const { ledger } = useApp();
  return useMemo(() => balances(ledger), [ledger]);
}

/** How an entry is shown in lists: icon, title, subtitle and the signed amount. */
export function describeEntry(l: Ledger, e: Entry): { icon: ReactNode; title: string; sub: string; amount: ReactNode } {
  const acct = l.accounts.get(e.accountId);
  const to = e.toAccountId ? l.accounts.get(e.toAccountId) : undefined;
  const cur = acct?.currency ?? 'BDT';
  const cat = e.categoryId ? l.categories.get(e.categoryId) : undefined;
  const name = (id: string | undefined) => (id ? (l.accounts.get(id)?.name ?? 'Deleted account') : '');
  switch (e.kind) {
    case 'expense':
    case 'income': {
      const onLoan = acct?.kind === 'loan';
      return {
        icon: <Chip icon={e.kind === 'income' ? 'in' : (cat?.icon ?? 'dots')} slot={cat?.slot ?? 0} />,
        title: e.note || cat?.name || (e.kind === 'income' ? 'Income' : 'Expense'),
        sub: `${cat?.name ?? 'No category'} · ${onLoan ? `Loan: ${acct?.name}` : (acct?.name ?? '')}`,
        amount: <span className={e.kind === 'income' ? 'pos' : 'neg'}>{fmtMoney(e.kind === 'income' ? e.amount : -e.amount, cur, { sign: true })}</span>,
      };
    }
    case 'correction':
      return {
        icon: <Chip icon="scale" />,
        title: 'Balance correction',
        sub: `${acct?.name ?? ''} · not counted as spending`,
        amount: (
          <>
            {fmtMoney(e.amount, cur, { sign: true })}
            <small>Correction</small>
          </>
        ),
      };
    case 'transfer': {
      const fromLoan = acct?.kind === 'loan';
      const toLoan = to?.kind === 'loan';
      if (e.loanAction === 'lend' || e.loanAction === 'borrow' || e.loanAction === 'repay' || fromLoan || toLoan) {
        const loan = fromLoan ? acct : to;
        const money = fromLoan ? to : acct;
        const action = e.loanAction === 'lend' ? 'Lent to' : e.loanAction === 'borrow' ? 'Borrowed from' : fromLoan ? 'Repaid by' : 'Repaid';
        return {
          icon: <Chip icon={ACCOUNT_ICONS[loan?.type ?? 'person'] ?? 'person'} />,
          title: e.note || `${action} ${loan?.name ?? ''}`,
          sub: `Loan · ${fromLoan ? 'into' : 'from'} ${money?.name ?? ''}`,
          amount: (
            <>
              {fmtMoney(fromLoan ? (e.toAmount ?? e.amount) : -e.amount, fromLoan ? (to?.currency ?? cur) : cur, { sign: true })}
              <small>{e.loanAction === 'lend' ? 'Lent' : e.loanAction === 'borrow' ? 'Borrowed' : 'Loan repaid'}</small>
            </>
          ),
        };
      }
      const exchange = to && to.currency !== cur;
      return {
        icon: <Chip icon={exchange ? 'swap' : 'transfer'} />,
        title: e.note || (exchange ? 'Currency exchange' : 'Transfer'),
        sub: `${name(e.accountId)} → ${name(e.toAccountId)}`,
        amount: (
          <>
            {fmtMoney(e.amount, cur)}
            <small>{exchange ? `→ ${fmtMoney(e.toAmount ?? e.amount, to!.currency)}` : 'Transfer'}</small>
          </>
        ),
      };
    }
  }
}

export function EntryRow({ id, e }: { id: string; e: Entry }) {
  const { ledger, openEntry } = useApp();
  const v = describeEntry(ledger, e);
  return (
    <button className="row row-btn" onClick={() => openEntry(id)}>
      {v.icon}
      <span className="row-main">
        <span className="row-title">{v.title}</span>
        <span className="row-sub">{v.sub}</span>
      </span>
      <span className="row-amt num">{v.amount}</span>
    </button>
  );
}

export type { Change };
