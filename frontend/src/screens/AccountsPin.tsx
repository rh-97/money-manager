import { useEffect, useRef, useState, type FormEvent } from 'react';
import { pinCheck, WrongKeyError } from '@mm/shared';
import { unlock } from '../lib/auth.ts';
import { FREE_TRIES, isValidPin, loadFails, nextFails, PIN_MAX, PIN_MIN, storeFails, type PinFails } from '../lib/pin.ts';
import type { Settings } from '../money/types.ts';
import { useApp } from '../ui/ctx.tsx';
import { Chip, Icon } from '../ui/icons.tsx';
import { Busy, Field, Sheet } from '../ui/kit.tsx';
import { errorText } from './Auth.tsx';

/** A PIN box: digits only, shown as dots, number keypad on phones, never saved by password managers. */
function PinInput({ id, value, onChange, maxLength = PIN_MAX, autoFocus, disabled }: { id: string; value: string; onChange: (v: string) => void; maxLength?: number; autoFocus?: boolean; disabled?: boolean }) {
  return (
    <input
      id={id}
      className="pin-input"
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      data-1p-ignore=""
      data-lpignore="true"
      maxLength={maxLength}
      autoFocus={autoFocus}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, maxLength))}
    />
  );
}

/** Wrong-try state shared by every place that checks the PIN, with a live countdown while waiting. */
function usePinTries() {
  const [fails, setFails] = useState<PinFails>(loadFails);
  const [now, setNow] = useState(() => Date.now());
  const waitLeft = Math.max(0, fails.until - now);
  useEffect(() => {
    if (fails.until <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fails.until]);
  const fail = () => {
    const f = nextFails(loadFails(), Date.now());
    storeFails(f);
    setFails(f);
    setNow(Date.now());
    const left = FREE_TRIES - f.count;
    return left > 0 ? `Wrong PIN. ${left} more ${left === 1 ? 'try' : 'tries'} before you have to wait.` : 'Wrong PIN.';
  };
  const clear = () => {
    storeFails({ count: 0, until: 0 });
    setFails({ count: 0, until: 0 });
  };
  const secs = Math.ceil(waitLeft / 1000);
  const waitText = waitLeft > 0 ? `Too many wrong tries. Try again in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}.` : '';
  return { waiting: waitLeft > 0, waitText, fail, clear };
}

/** Saves the settings with the PIN set, changed or (undefined) removed. */
function useSavePin() {
  const { ledger, save } = useApp();
  return (pin: Settings['accountsPin'], okMessage: string) => {
    if (!ledger.settingsId) return Promise.resolve(false);
    const { accountsPin: _old, ...rest } = ledger.settings;
    const value: Settings = pin ? { ...rest, accountsPin: pin } : rest;
    return save([{ id: ledger.settingsId, type: 'settings', value }], okMessage);
  };
}

/** Shown instead of the Accounts tab while it is locked with a PIN. */
export function AccountsLockScreen() {
  const { ledger, dataKey, openAccounts, session } = useApp();
  const pin = ledger.settings.accountsPin!;
  const savePin = useSavePin();
  const tries = usePinTries();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLDivElement>(null);
  // Put the cursor back in the PIN box when a wait ends.
  useEffect(() => {
    if (!tries.waiting && !forgot) input.current?.querySelector('input')?.focus();
  }, [tries.waiting, forgot]);

  const tryPin = (p: string) => {
    if (tries.waiting) return;
    if (pinCheck(dataKey, p) === pin.check) {
      tries.clear();
      openAccounts();
      return;
    }
    setValue('');
    setError(tries.fail());
    input.current?.classList.remove('shake');
    void input.current?.offsetWidth; // restart the shake animation
    input.current?.classList.add('shake');
  };

  const usePassword = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!password) return setError('Type your password first.');
    setBusy(true);
    setError('');
    try {
      await unlock(session, password);
      tries.clear();
      openAccounts();
      await savePin(undefined, 'PIN turned off. You can set a new one at the bottom of Accounts.');
    } catch (err) {
      setError(err instanceof WrongKeyError ? 'That password is not right.' : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <header className="top">
        <div>
          <p className="eyebrow">Locked</p>
          <h1 className="h1">Accounts</h1>
        </div>
      </header>
      <section className="card pin-lock">
        <Chip icon="lock" />
        {!forgot ? (
          <>
            <p className="h2">Enter your PIN</p>
            <p className="hint">Accounts is locked so other people using this device can't look in.</p>
            <div ref={input} className="pin-wrap">
              <label className="sr-only" htmlFor="pin-open">PIN</label>
              <PinInput
                id="pin-open"
                autoFocus
                maxLength={pin.length}
                disabled={tries.waiting}
                value={value}
                onChange={(v) => {
                  setValue(v);
                  if (error && !tries.waiting) setError('');
                  if (v.length === pin.length) tryPin(v);
                }}
              />
            </div>
            <p className={`pin-msg${error || tries.waiting ? ' err' : ''}`} role="status" aria-live="polite">
              {tries.waitText || error || `${pin.length} digits`}
            </p>
            <button className="link" onClick={() => (setForgot(true), setError(''))}>
              Forgot your PIN?
            </button>
          </>
        ) : (
          <form className="col pin-forgot" onSubmit={usePassword}>
            <p className="h2">Use your password instead</p>
            <p className="hint">Your account password opens Accounts and turns the PIN off. You can then set a new PIN.</p>
            <Field label="Your password" htmlFor="pin-pw">
              <input id="pin-pw" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <p className="pin-msg err" role="alert">{error}</p>}
            <div className="two">
              <button type="button" className="btn ghost" onClick={() => (setForgot(false), setError(''), setPassword(''))}>
                Back to PIN
              </button>
              <Busy busy={busy} className="btn" type="submit">
                Open Accounts
              </Busy>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

type SheetMode = 'set' | 'change' | 'off';

/** The PIN area at the bottom of the Accounts tab. */
export function PinCard() {
  const { ledger } = useApp();
  const [mode, setMode] = useState<SheetMode | null>(null);
  const on = Boolean(ledger.settings.accountsPin);
  return (
    <section className="card pin-card">
      <div className="row pin-row">
        <Chip icon="lock" />
        <span className="row-main">
          <span className="row-title">PIN lock: {on ? 'on' : 'off'}</span>
          <span className="row-sub">
            {on
              ? 'Accounts asks for your PIN every time you open it, on all your devices.'
              : 'Ask for a PIN every time Accounts is opened, so friends using your phone can’t look in.'}
          </span>
        </span>
        <span className="pin-card-actions">
          {on ? (
            <>
              <button className="btn small ghost" onClick={() => setMode('change')}>Change PIN</button>
              <button className="btn small ghost" onClick={() => setMode('off')}>Turn off</button>
            </>
          ) : (
            <button className="btn small" onClick={() => setMode('set')}>
              <Icon name="lock" /> Set a PIN
            </button>
          )}
        </span>
      </div>
      {mode && <PinSheet mode={mode} onClose={() => setMode(null)} />}
    </section>
  );
}

function PinSheet({ mode, onClose }: { mode: SheetMode; onClose: () => void }) {
  const { ledger, dataKey, wide, openAccounts } = useApp();
  const savePin = useSavePin();
  const tries = usePinTries();
  const current = ledger.settings.accountsPin;
  const [old, setOld] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError('');
    if (mode !== 'set') {
      if (tries.waiting) return;
      if (!current || pinCheck(dataKey, old) !== current.check) {
        setOld('');
        return setError(tries.fail());
      }
      tries.clear();
    }
    if (mode !== 'off') {
      if (!isValidPin(pin)) return setError(`Use ${PIN_MIN} to ${PIN_MAX} digits.`);
      if (pin !== pin2) return setError('The two PINs don’t match.');
    }
    setBusy(true);
    // Stay inside Accounts: setting the PIN shouldn't lock you out of the page you're on.
    openAccounts();
    const ok =
      mode === 'off'
        ? await savePin(undefined, 'PIN turned off')
        : await savePin({ check: pinCheck(dataKey, pin), length: pin.length }, mode === 'set' ? 'PIN set. Accounts will ask for it each time you open it.' : 'PIN changed');
    setBusy(false);
    if (ok) onClose();
  };

  const title = mode === 'set' ? 'Set a PIN for Accounts' : mode === 'change' ? 'Change your PIN' : 'Turn off the PIN';
  return (
    <Sheet title={title} onClose={onClose} wide={wide}>
      <form className="col" onSubmit={submit}>
        {mode === 'set' && (
          <p className="hint">
            {PIN_MIN} to {PIN_MAX} digits. Use one that isn’t your phone’s unlock code. The PIN applies on all your devices. If you forget it, your password opens Accounts.
          </p>
        )}
        {mode === 'off' && <p className="hint">Accounts will open without a PIN again, on all your devices.</p>}
        {mode !== 'set' && (
          <Field label="Current PIN" htmlFor="pin-old">
            <PinInput id="pin-old" autoFocus value={old} onChange={setOld} disabled={tries.waiting} />
          </Field>
        )}
        {mode !== 'off' && (
          <div className="two">
            <Field label={mode === 'change' ? 'New PIN' : 'PIN'} htmlFor="pin-new">
              <PinInput id="pin-new" autoFocus={mode === 'set'} value={pin} onChange={setPin} />
            </Field>
            <Field label="Type it again" htmlFor="pin-new2">
              <PinInput id="pin-new2" value={pin2} onChange={setPin2} />
            </Field>
          </div>
        )}
        {(error || tries.waitText) && (
          <p className="pin-msg err" role="alert">
            {tries.waitText || error}
          </p>
        )}
        <Busy busy={busy} className={`btn${mode === 'off' ? ' danger' : ''}`} type="submit" disabled={tries.waiting && mode !== 'set'}>
          {mode === 'set' ? 'Set PIN' : mode === 'change' ? 'Change PIN' : 'Turn off PIN'}
        </Busy>
      </form>
    </Sheet>
  );
}
