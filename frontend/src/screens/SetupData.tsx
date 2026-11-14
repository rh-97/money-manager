import { useState } from 'react';
import { fmtDate, fmtMoney } from '../lib/format.ts';
import { useApp, useBalances } from '../ui/ctx.tsx';
import { ACCOUNT_ICONS, Chip, Icon } from '../ui/icons.tsx';
import { Field } from '../ui/kit.tsx';
import { AccountSheet, typeLabel } from './Accounts.tsx';
import { SetupSteps } from './Auth.tsx';

/** First-time setup, steps 3 to 5 (spec section 5). Can be skipped and resumed from Settings. */
export function SetupDataScreen({ step }: { step: number; recoveryKeyShown: boolean }) {
  const { ledger, today, wide, save } = useApp();
  const bals = useBalances();
  const [startDate, setStartDate] = useState(ledger.settings.startDate ?? today);
  const [adding, setAdding] = useState<'money' | 'loan' | null>(null);
  const settingsId = ledger.settingsId;

  const setStep = (n: number, extra: Partial<typeof ledger.settings> = {}) =>
    settingsId ? save([{ id: settingsId, type: 'settings', value: { ...ledger.settings, ...extra, setupStep: n } }]) : Promise.resolve(false);

  const money = [...ledger.accounts].filter(([, a]) => a.kind === 'money');
  const loans = [...ledger.accounts].filter(([, a]) => a.kind === 'loan');

  let card;
  if (step === 3)
    card = (
      <div className="auth-card">
        <p className="eyebrow">Step 3 of 5</p>
        <h1 className="h1" style={{ fontSize: 22 }}>When do you start recording?</h1>
        <p className="hint">Usually today. Next you'll enter what each account had on this day, and anything you record afterwards adds to it.</p>
        <Field label="Start date" htmlFor="s-date">
          <input id="s-date" type="date" value={startDate} max={today} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <button className="btn block" onClick={() => void setStep(4, { startDate })}>Continue</button>
        <button className="link" onClick={() => void setStep(0, { startDate })}>Skip the rest of setup for now</button>
      </div>
    );
  else if (step === 4)
    card = (
      <div className="auth-card">
        <p className="eyebrow">Step 4 of 5</p>
        <h1 className="h1" style={{ fontSize: 22 }}>Your accounts</h1>
        <p className="hint">
          Add every place your money sits, with its balance on {fmtDate(ledger.settings.startDate ?? today)}: banks, bKash or Nagad, the cash in your wallet, the drawer, credit cards, FDRs.
        </p>
        <div className="setup-accounts">
          {money.map(([id, a]) => (
            <div key={id} className="row">
              <Chip icon={ACCOUNT_ICONS[a.type] ?? 'wallet'} slot={a.slot} />
              <span className="row-main">
                <span className="row-title">{a.name}</span>
                <span className="row-sub">{typeLabel(a)}</span>
              </span>
              <span className="row-amt num">{fmtMoney(bals.get(id) ?? 0, a.currency)}</span>
            </div>
          ))}
        </div>
        <button className="btn ghost block" onClick={() => setAdding('money')}>
          <Icon name="plus" /> Add an account
        </button>
        <div className="two">
          <button className="btn ghost" onClick={() => void setStep(3)}>Back</button>
          <button className="btn" onClick={() => void setStep(5)}>{money.length ? 'Continue' : 'Skip'}</button>
        </div>
      </div>
    );
  else
    card = (
      <div className="auth-card">
        <p className="eyebrow">Step 5 of 5</p>
        <h1 className="h1" style={{ fontSize: 22 }}>Existing loans</h1>
        <p className="hint">Does anyone already owe you money, or do you owe anyone (a person, a bank)? Add them here. This doesn't change your account balances, because that money moved before you started.</p>
        <div className="setup-accounts">
          {loans.map(([id, a]) => (
            <div key={id} className="row">
              <Chip icon={ACCOUNT_ICONS[a.type] ?? 'person'} />
              <span className="row-main">
                <span className="row-title">{a.name}</span>
                <span className="row-sub">{a.startingBalance > 0 ? 'owes you' : 'you owe'}</span>
              </span>
              <span className={`row-amt num ${a.startingBalance > 0 ? 'pos' : 'neg'}`}>{fmtMoney(Math.abs(bals.get(id) ?? 0), a.currency)}</span>
            </div>
          ))}
        </div>
        <button className="btn ghost block" onClick={() => setAdding('loan')}>
          <Icon name="plus" /> Add a person or organization
        </button>
        <div className="two">
          <button className="btn ghost" onClick={() => void setStep(4)}>Back</button>
          <button className="btn" onClick={() => void setStep(0)}>Finish</button>
        </div>
      </div>
    );

  return (
    <div className="screen">
      {wide ? (
        <div className="auth-split" style={{ marginTop: 0 }}>
          <aside className="auth-panel">
            <div className="brand">
              <span className="brand-mark">৳</span>Money Manager
            </div>
            <SetupSteps current={step - 1} />
          </aside>
          <div className="auth-form">{card}</div>
        </div>
      ) : (
        <div className="auth" style={{ paddingBlock: 16 }}>
          <div className="steps" aria-label={`Step ${step} of 5`}>
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={i <= step ? 'on' : ''} />
            ))}
          </div>
          {card}
        </div>
      )}
      {adding && <AccountSheet kind={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}
