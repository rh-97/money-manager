import { useState, type FormEvent, type ReactNode } from 'react';
import { WrongKeyError, type api, type PasswordKeys } from '@mm/shared';
import { ApiError } from '../lib/api.ts';
import { completeRecovery, completeSetup, changePassword, login, MIN_PASSWORD, startRecovery, unlock, type Session } from '../lib/auth.ts';
import { Busy, Field, useViewport } from '../ui/kit.tsx';
import { Icon } from '../ui/icons.tsx';

export interface Unlocked {
  session: Session;
  dataKey: Uint8Array;
  keys: PasswordKeys;
  /** Shown once, right after first-time setup. */
  recoveryKey?: string;
  firstSetup?: boolean;
}

const errorText = (err: unknown): string =>
  err instanceof WrongKeyError ? 'That password is not correct.' : err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';

/** Phone: centred card. Wide: split card with a brand panel (from the approved mockup). */
function AuthFrame({ panel, children }: { panel?: ReactNode; children: ReactNode }) {
  const { wide } = useViewport();
  const brand = (
    <div className="brand" style={wide ? undefined : { justifyContent: 'center', padding: 0 }}>
      <span className="brand-mark">৳</span>Money Manager
    </div>
  );
  if (!wide) {
    return (
      <div className="stage phone">
        <div className="auth">
          {brand}
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="stage">
      <div className="auth-split">
        <aside className="auth-panel">
          {brand}
          {panel ?? <DefaultPanel />}
        </aside>
        <div className="auth-form">{children}</div>
      </div>
    </div>
  );
}

function DefaultPanel() {
  return (
    <>
      <h2>Your money, in one calm place.</h2>
      <ul className="auth-points">
        <li>
          <Icon name="wallet" />
          <span>
            <b>Every account together</b>Banks, bKash, cash and cards, in taka and dollars.
          </span>
        </li>
        <li>
          <Icon name="loans" />
          <span>
            <b>Loans you can't forget</b>See who owes whom at a glance.
          </span>
        </li>
        <li>
          <Icon name="lock" />
          <span>
            <b>Private by design</b>Encrypted on your device. The server can't read it.
          </span>
        </li>
      </ul>
    </>
  );
}

function PasswordPair({ value, setValue, confirm, setConfirm }: { value: string; setValue: (v: string) => void; confirm: string; setConfirm: (v: string) => void }) {
  return (
    <>
      <Field label="New password" htmlFor="np" hint={`At least ${MIN_PASSWORD} characters. A short sentence is easy to remember and hard to guess.`}>
        <input id="np" type="password" autoComplete="new-password" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Field label="Type it again" htmlFor="np2">
        <input id="np2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
    </>
  );
}

function checkNewPassword(pw: string, again: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw !== again) return 'The two passwords do not match.';
  return null;
}

// ---------- Log in ----------

export function LoginScreen({ initialUsername, onLoggedIn, onForgot }: { initialUsername?: string; onLoggedIn: (r: { session: Session; keys: PasswordKeys; password: string }) => void; onForgot: () => void }) {
  const [username, setUsername] = useState(initialUsername ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForgot, setShowForgot] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) return setError('Enter your username and password.');
    setBusy(true);
    try {
      const r = await login(username, password);
      onLoggedIn({ ...r, password });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <form className="auth-card" onSubmit={submit}>
        <h1 className="h1" style={{ fontSize: 22 }}>Log in</h1>
        <Field label="Username" htmlFor="l-user">
          <input id="l-user" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="e.g. ayesha" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="l-pass">
          <input id="l-pass" type="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="error-text" role="alert">{error}</p>}
        <Busy busy={busy} className="btn block" type="submit">
          {busy ? 'Unlocking…' : 'Log in'}
        </Busy>
        <button type="button" className="link" onClick={() => setShowForgot((v) => !v)} aria-expanded={showForgot}>
          Forgot password?
        </button>
        {showForgot && (
          <div className="hint" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span>
              <b>Have your recovery key?</b> Use it to set a new password yourself.{' '}
              <button type="button" className="link" style={{ color: 'var(--accent)' }} onClick={onForgot}>
                Use recovery key
              </button>
            </span>
            <span>
              <b>Chose "the admin can help"?</b> Ask the admin for a temporary password.
            </span>
          </div>
        )}
        <p className="lockline">
          <Icon name="lock" />
          <span>Your data is encrypted on this device before it is sent. The server can't read it.</span>
        </p>
      </form>
    </AuthFrame>
  );
}

// ---------- Unlock (session still valid, data key forgotten) ----------

export function UnlockScreen({ session, onUnlocked, onSwitchUser }: { session: Session; onUnlocked: (u: Unlocked) => void; onSwitchUser: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { dataKey, keys } = await unlock(session, password);
      onUnlocked({ session, dataKey, keys });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <AuthFrame>
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">Welcome back</p>
        <h1 className="h1" style={{ fontSize: 22 }}>{session.user.displayName}</h1>
        <p className="hint">Enter your password to unlock your money on this device.</p>
        <Field label="Password" htmlFor="u-pass">
          <input id="u-pass" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="error-text" role="alert">{error}</p>}
        <Busy busy={busy} className="btn block" type="submit">
          {busy ? 'Unlocking…' : 'Unlock'}
        </Busy>
        <button type="button" className="link" onClick={onSwitchUser}>
          Not {session.user.displayName}? Log out
        </button>
      </form>
    </AuthFrame>
  );
}

// ---------- First-time setup, steps 1 and 2 ----------

const SETUP_STEPS: [string, string][] = [
  ['Choose your password', 'Only you know it'],
  ['Recovery', 'If you forget your password'],
  ['Start date', 'When you start recording'],
  ['Your accounts', 'Banks, wallets, cash, cards'],
  ['Existing loans', 'Who owes whom today'],
];

export function SetupSteps({ current }: { current: number }) {
  return (
    <>
      <h2>Let's set up your money.</h2>
      <ul className="auth-points">
        {SETUP_STEPS.map(([t, d], i) => (
          <li key={t} className={i < current ? 'done' : i === current ? 'current' : ''}>
            <span className="n">{i < current ? '✓' : i + 1}</span>
            <span>
              <b>{t}</b>
              {d}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function StepBar({ current }: { current: number }) {
  return (
    <div className="steps" aria-label={`Step ${current + 1} of 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={i <= current ? 'on' : ''} />
      ))}
    </div>
  );
}

export function SetupAuthScreen({ session, currentLoginKey, onDone }: { session: Session; currentLoginKey: string; onDone: (u: Unlocked) => void }) {
  const { wide } = useViewport();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const adminReady = Boolean(session.adminRecoveryPublicKey);
  const [mode, setMode] = useState<api.RecoveryMode>(adminReady ? 'admin' : 'self');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Unlocked | null>(null);
  const [saved, setSaved] = useState(false);

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const r = await completeSetup({ session, currentLoginKey, newPassword: pw, mode });
      setResult({ session: r.session, dataKey: r.dataKey, keys: r.keys, recoveryKey: r.recoveryKey, firstSetup: true });
      setStep(2);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  const card = (() => {
    if (step === 0)
      return (
        <form
          className="auth-card"
          onSubmit={(e) => {
            e.preventDefault();
            const problem = checkNewPassword(pw, pw2);
            if (problem) return setError(problem);
            setError(null);
            setStep(1);
          }}
        >
          <p className="eyebrow">Step 1 of 5</p>
          <h1 className="h1" style={{ fontSize: 22 }}>Choose your password</h1>
          <p className="hint">This replaces the one-time password you were given. Nobody else, not even the admin, will know it.</p>
          <PasswordPair value={pw} setValue={setPw} confirm={pw2} setConfirm={setPw2} />
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn block" type="submit">Continue</button>
        </form>
      );
    if (step === 1)
      return (
        <div className="auth-card">
          <p className="eyebrow">Step 2 of 5</p>
          <h1 className="h1" style={{ fontSize: 22 }}>If you forget your password</h1>
          <p className="hint">Your money is locked with your password. Choose how you want to get back in if you forget it.</p>
          <button className="choice" aria-pressed={mode === 'admin'} disabled={!adminReady} onClick={() => setMode('admin')}>
            <span className="t">
              The admin can help me <span className="chip">{adminReady ? 'Recommended for family' : 'Not available yet'}</span>
            </span>
            <span className="d">
              {adminReady
                ? 'The admin can give you a new password and nothing is lost. This also means the admin can technically read your data.'
                : 'The admin has not set up admin recovery yet. You can switch to this later in Settings.'}
            </span>
          </button>
          <button className="choice" aria-pressed={mode === 'self'} onClick={() => setMode('self')}>
            <span className="t">Only I can recover</span>
            <span className="d">Nobody else can ever read your data. You will need your recovery key.</span>
          </button>
          {mode === 'self' && <p className="warnline">If you lose both your password and your recovery key, your data is gone for good.</p>}
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="two">
            <button className="btn ghost" onClick={() => setStep(0)}>Back</button>
            <Busy busy={busy} className="btn" onClick={finish}>
              {busy ? 'Locking…' : 'Continue'}
            </Busy>
          </div>
        </div>
      );
    const groups = (result?.recoveryKey ?? '').split('-');
    return (
      <div className="auth-card">
        <p className="eyebrow">Step 2 of 5</p>
        <h1 className="h1" style={{ fontSize: 22 }}>Your recovery key</h1>
        <p className="hint">
          Write this down or print it, and keep it somewhere safe. It's shown only once.{' '}
          {mode === 'admin' ? 'It lets you reset your password without the admin.' : 'It is the only way back in if you forget your password.'}
        </p>
        <div className="keybox num" aria-label="Recovery key">
          {groups.map((g, i) => (
            <span key={i}>{g}</span>
          ))}
        </div>
        <button className="btn ghost small" onClick={() => void navigator.clipboard?.writeText(result?.recoveryKey ?? '').catch(() => {})}>
          Copy
        </button>
        <label className="check-row">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>I've written down my recovery key and put it somewhere safe.</span>
        </label>
        <button className="btn block" disabled={!saved} onClick={() => result && onDone(result)}>
          Continue
        </button>
      </div>
    );
  })();

  return (
    <AuthFrame panel={<SetupSteps current={step === 2 ? 1 : step} />}>
      {!wide && <StepBar current={step === 2 ? 1 : step} />}
      {card}
    </AuthFrame>
  );
}

// ---------- Forced password change (after admin recovery) ----------

export function ForcePasswordScreen({ unlocked, onDone }: { unlocked: Unlocked; onDone: (u: Unlocked) => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = checkNewPassword(pw, pw2);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const r = await changePassword({ currentLoginKey: unlocked.keys.loginKey, dataKey: unlocked.dataKey, newPassword: pw });
      onDone({ ...unlocked, session: r.session, keys: r.keys });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <AuthFrame>
      <form className="auth-card" onSubmit={submit}>
        <h1 className="h1" style={{ fontSize: 22 }}>Choose a new password</h1>
        <p className="hint">You logged in with a temporary password. Choose your own to continue. Your data is safe.</p>
        <PasswordPair value={pw} setValue={setPw} confirm={pw2} setConfirm={setPw2} />
        {error && <p className="error-text" role="alert">{error}</p>}
        <Busy busy={busy} className="btn block" type="submit">Save password</Busy>
      </form>
    </AuthFrame>
  );
}

// ---------- Forgot password: personal recovery key ----------

export function RecoverScreen({ onDone, onCancel }: { onDone: (u: Unlocked) => void; onCancel: () => void }) {
  const [username, setUsername] = useState('');
  const [key, setKey] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [opened, setOpened] = useState<{ dataKey: Uint8Array; authKey: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setOpened(await startRecovery(username, key));
    } catch (err) {
      setError(err instanceof WrongKeyError ? err.message : errorText(err));
    }
    setBusy(false);
  }
  async function finish(e: FormEvent) {
    e.preventDefault();
    const problem = checkNewPassword(pw, pw2);
    if (problem || !opened) return setError(problem);
    setBusy(true);
    try {
      const r = await completeRecovery({ username, authKey: opened.authKey, dataKey: opened.dataKey, newPassword: pw });
      onDone({ session: r.session, dataKey: opened.dataKey, keys: r.keys });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <AuthFrame>
      {!opened ? (
        <form className="auth-card" onSubmit={check}>
          <h1 className="h1" style={{ fontSize: 22 }}>Use your recovery key</h1>
          <Field label="Username" htmlFor="r-user">
            <input id="r-user" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Recovery key" htmlFor="r-key" hint="32 characters. Dashes and capital letters don't matter.">
            <input id="r-key" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          {error && <p className="error-text" role="alert">{error}</p>}
          <Busy busy={busy} className="btn block" type="submit">Continue</Busy>
          <button type="button" className="link" onClick={onCancel}>Back to log in</button>
        </form>
      ) : (
        <form className="auth-card" onSubmit={finish}>
          <p className="ok-text">Recovery key accepted. Your data is safe.</p>
          <h1 className="h1" style={{ fontSize: 22 }}>Choose a new password</h1>
          <PasswordPair value={pw} setValue={setPw} confirm={pw2} setConfirm={setPw2} />
          {error && <p className="error-text" role="alert">{error}</p>}
          <Busy busy={busy} className="btn block" type="submit">Save and log in</Busy>
        </form>
      )}
    </AuthFrame>
  );
}

export { errorText };
