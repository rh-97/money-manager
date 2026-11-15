import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { derivedId } from '@mm/shared';
import { fetchSession, logout as apiLogout, unlock, type Session } from './lib/auth.ts';
import { fmtMoney, setNumberFormat, todayDhaka } from './lib/format.ts';
import { ConflictError, Vault, type Change } from './lib/vault.ts';
import { ApiError } from './lib/api.ts';
import { forgetDevice, keepDeviceUnlockedWhileUsed, openRememberedDevice, rememberDevice } from './lib/remember.ts';
import { DEFAULT_CATEGORIES, defaultSettings } from './money/defaults.ts';
import type { Entry } from './money/types.ts';
import { ForcePasswordScreen, LoginScreen, RecoverScreen, SetupAuthScreen, UnlockScreen, errorText, type Unlocked } from './screens/Auth.tsx';
import { AppCtx, describeEntry, useApp, type AddPreset, type AppCtxValue } from './ui/ctx.tsx';
import { Icon } from './ui/icons.tsx';
import { Sheet, Spinner, ToastProvider, TooltipLayer, useToast, useViewport } from './ui/kit.tsx';
import { HomeScreen } from './screens/Home.tsx';
import { HistoryScreen } from './screens/History.tsx';
import { LoanDetail, LoansScreen } from './screens/Loans.tsx';
import { AccountDetail, AccountsScreen } from './screens/Accounts.tsx';
import { StatsScreen } from './screens/Stats.tsx';
import { SettingsScreen } from './screens/Settings.tsx';
import { SetupDataScreen } from './screens/SetupData.tsx';
import { AccountsLockScreen } from './screens/AccountsPin.tsx';
import { AddSheet } from './screens/AddSheet.tsx';
import { EntrySheet } from './screens/EntrySheet.tsx';

type Phase =
  | { phase: 'boot' }
  | { phase: 'login'; username?: string }
  | { phase: 'unlock'; session: Session }
  | { phase: 'setup'; session: Session; loginKey: string }
  | { phase: 'recover' }
  | { phase: 'force'; unlocked: Unlocked }
  | { phase: 'app'; unlocked: Unlocked };

export function App() {
  return (
    <ToastProvider>
      <TooltipLayer />
      <Root />
    </ToastProvider>
  );
}

function Root() {
  const [state, setState] = useState<Phase>({ phase: 'boot' });

  useEffect(() => {
    void (async () => {
      const s = await fetchSession();
      if (!s) return setState({ phase: 'login' });
      if (!s.user.setupDone) return setState({ phase: 'login', username: s.user.username });
      // Reopened within the hour on a device that stayed unlocked: no password needed.
      const dataKey = s.user.mustChangePassword ? null : await openRememberedDevice(s.user.id);
      setState(dataKey ? { phase: 'app', unlocked: { session: s, dataKey, keys: null } } : { phase: 'unlock', session: s });
    })();
  }, []);

  const afterUnlock = (u: Unlocked) => {
    if (u.session.user.mustChangePassword) return setState({ phase: 'force', unlocked: u });
    void rememberDevice(u.session.user.id, u.dataKey);
    setState({ phase: 'app', unlocked: u });
  };
  const toLogin = () => {
    void forgetDevice().then(apiLogout);
    setState({ phase: 'login' });
  };
  const lock = (session: Session) => {
    void forgetDevice();
    setState({ phase: 'unlock', session });
  };

  switch (state.phase) {
    case 'boot':
      return (
        <div className="center-screen">
          <Spinner />
        </div>
      );
    case 'login':
      return (
        <LoginScreen
          initialUsername={state.username}
          onForgot={() => setState({ phase: 'recover' })}
          onLoggedIn={async ({ session, keys, password }) => {
            if (!session.user.setupDone) return setState({ phase: 'setup', session, loginKey: keys.loginKey });
            const { dataKey } = await unlock(session, password);
            afterUnlock({ session, dataKey, keys });
          }}
        />
      );
    case 'unlock':
      return <UnlockScreen session={state.session} onUnlocked={afterUnlock} onSwitchUser={toLogin} />;
    case 'setup':
      return <SetupAuthScreen session={state.session} currentLoginKey={state.loginKey} onDone={afterUnlock} />;
    case 'recover':
      return <RecoverScreen onDone={afterUnlock} onCancel={() => setState({ phase: 'login' })} />;
    case 'force':
      return <ForcePasswordScreen unlocked={state.unlocked} onDone={afterUnlock} />;
    case 'app':
      return <Loader unlocked={state.unlocked} onLogout={toLogin} onLock={lock} />;
  }
}

/** Loads and decrypts all records, creates first-time records, then shows the app. */
function Loader({ unlocked, onLogout, onLock }: { unlocked: Unlocked; onLogout: () => void; onLock: (s: Session) => void }) {
  const vault = useMemo(() => new Vault(unlocked.dataKey), [unlocked.dataKey]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await vault.start();
        const l = vault.getLedger();
        if (!l.settingsId) {
          // First time: default categories and settings (setup continues at step 3).
          // Fixed ids: if another device (or a second run) already created them, the save conflicts harmlessly.
          const key = unlocked.dataKey;
          const changes: Change[] = DEFAULT_CATEGORIES.map((c, i) => ({ id: derivedId(key, `category:${i}`), type: 'category', value: { ...c, sortOrder: i } }));
          changes.push({ id: derivedId(key, 'settings'), type: 'settings', value: defaultSettings() });
          try {
            await vault.save(changes);
          } catch (err) {
            if (!(err instanceof ConflictError)) throw err;
            await vault.pull();
          }
        }
        // Recently deleted: erase entries deleted more than 30 days ago.
        const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
        const old = [...vault.getLedger().entries].filter(([, e]) => e.deletedAt && e.deletedAt < cutoff).map(([id]) => ({ id, delete: true as const }));
        if (old.length) await vault.save(old).catch(() => {});
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    })();
    return () => {
      cancelled = true;
      vault.stop();
    };
  }, [vault, unlocked.dataKey]);

  if (error)
    return (
      <div className="center-screen">
        <div className="empty">
          <p className="h2">Couldn't load your data</p>
          <p>{error}</p>
          <button className="btn" onClick={() => location.reload()}>Try again</button>
        </div>
      </div>
    );
  if (!ready)
    return (
      <div className="center-screen">
        <span>
          <Spinner /> Decrypting your data…
        </span>
      </div>
    );
  return <MainApp vault={vault} unlocked={unlocked} onLogout={onLogout} onLock={onLock} />;
}

function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const go = useCallback((p: string) => {
    if (p !== location.pathname) history.pushState(null, '', p);
    setPath(p);
    window.scrollTo(0, 0);
  }, []);
  return [path, go];
}

/** The Accounts tab locks again after this long without use (when a PIN is set). */
const ACCOUNTS_IDLE_MS = 5 * 60_000;

const NAV: [string, string, string][] = [
  ['/', 'Home', 'home'],
  ['/history', 'History', 'list'],
  ['/loans', 'Loans', 'loans'],
  ['/stats', 'Stats', 'chart'],
  ['/accounts', 'Accounts', 'wallet'],
];

function MainApp({ vault, unlocked, onLogout, onLock }: { vault: Vault; unlocked: Unlocked; onLogout: () => void; onLock: (s: Session) => void }) {
  const ledger = useSyncExternalStore(vault.subscribe, vault.getLedger);
  const [session, setSession] = useState(unlocked.session);
  const [fullPath, go] = usePath();
  const path = fullPath.split('?')[0]!;
  const { wide, xl } = useViewport();
  const toast = useToast();
  const [add, setAdd] = useState<AddPreset | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictError | null>(null);
  // Wide screens: the side menu can shrink to icons. Remembered on this device only.
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem('mm-nav-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggleNav = () =>
    setNavCollapsed((v) => {
      try {
        localStorage.setItem('mm-nav-collapsed', v ? '0' : '1');
      } catch {
        /* storage blocked */
      }
      return !v;
    });
  const [recoveryKeyNotice] = useState(unlocked.recoveryKey);
  // Accounts PIN (spec 3.5): opened by the right PIN, locked again on leaving the tab,
  // when the app goes to the background, or after 5 idle minutes.
  const [accountsOpen, setAccountsOpen] = useState(false);
  const inAccounts = path === '/accounts' || path.startsWith('/accounts/');
  useEffect(() => {
    if (!inAccounts) setAccountsOpen(false);
  }, [inAccounts]);
  useEffect(() => {
    if (!accountsOpen) return;
    let idle = setTimeout(() => setAccountsOpen(false), ACCOUNTS_IDLE_MS);
    const used = () => {
      clearTimeout(idle);
      idle = setTimeout(() => setAccountsOpen(false), ACCOUNTS_IDLE_MS);
    };
    const hidden = () => document.visibilityState === 'hidden' && setAccountsOpen(false);
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const e of events) window.addEventListener(e, used, { passive: true });
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clearTimeout(idle);
      for (const e of events) window.removeEventListener(e, used);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [accountsOpen]);
  const today = todayDhaka();

  // Apply the user's look (synced in their settings) and remember it for the login screen.
  const { style, theme, numberFormat } = ledger.settings;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.style = style;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    setNumberFormat(numberFormat);
    try {
      localStorage.setItem('mm-look', JSON.stringify({ style, theme }));
    } catch {
      /* private mode */
    }
  }, [style, theme, numberFormat]);

  const save = useCallback(
    async (changes: Change[], okMessage?: string) => {
      try {
        await vault.save(changes);
        if (okMessage) toast(okMessage);
        return true;
      } catch (err) {
        if (err instanceof ConflictError) setConflict(err);
        else if (err instanceof ApiError && err.status === 401) {
          toast('Your session ended. Please log in again.');
          onLogout();
        } else toast(errorText(err));
        return false;
      }
    },
    [vault, toast, onLogout],
  );

  const ctx: AppCtxValue = {
    vault,
    ledger,
    session,
    dataKey: unlocked.dataKey,
    today,
    wide,
    xl,
    path,
    go,
    openAdd: (p) => setAdd(p ?? {}),
    openEntry: setEntryId,
    save,
    setSession,
    logout: () => {
      vault.stop();
      onLogout();
    },
    lock: () => {
      vault.stop();
      onLock(session);
    },
    accountsOpen,
    openAccounts: () => setAccountsOpen(true),
    lockAccounts: () => setAccountsOpen(false),
  };

  useEffect(() => keepDeviceUnlockedWhileUsed(), []);

  const setupStep = ledger.settings.setupStep;
  let screen;
  if (setupStep > 0) screen = <SetupDataScreen step={setupStep} recoveryKeyShown={Boolean(recoveryKeyNotice)} />;
  else if (path === '/') screen = <HomeScreen />;
  else if (path === '/history') screen = <HistoryScreen />;
  else if (path === '/loans') screen = <LoansScreen />;
  else if (path.startsWith('/loans/')) screen = <LoanDetail id={path.slice(7)} />;
  else if (path === '/stats') screen = <StatsScreen />;
  else if (inAccounts && ledger.settings.accountsPin && !accountsOpen) screen = <AccountsLockScreen />;
  else if (path === '/accounts') screen = <AccountsScreen />;
  else if (path.startsWith('/accounts/')) screen = <AccountDetail id={path.slice(10)} />;
  else if (path === '/settings') screen = <SettingsScreen />;
  else screen = <HomeScreen />;

  const section = '/' + (path.split('/')[1] ?? '');
  const overdueDot = false; // due dates arrive with extra 4
  const nav = setupStep > 0 ? null : wide ? (
    <nav className="side" aria-label="Main">
      <div className="brand">
        <span className="brand-mark">৳</span>
        <span className="side-label">Money Manager</span>
        <button
          className="side-toggle"
          onClick={toggleNav}
          aria-expanded={!navCollapsed}
          aria-label={navCollapsed ? 'Expand the menu' : 'Collapse the menu'}
          data-tip={navCollapsed ? 'Expand the menu' : 'Collapse the menu'}
        >
          <Icon name={navCollapsed ? 'chev' : 'back'} />
        </button>
      </div>
      {[...NAV, ['/settings', 'Settings', 'settings'] as [string, string, string]].map(([p, label, icon]) => (
        <button
          key={p}
          className="side-link"
          aria-current={section === p ? 'page' : 'false'}
          aria-label={navCollapsed ? label : undefined}
          data-tip={navCollapsed ? label : undefined}
          onClick={() => go(p)}
        >
          <Icon name={icon} />
          <span className="side-label">{label}</span>
          {p === '/loans' && overdueDot && <span className="dot" />}
        </button>
      ))}
      <button className="btn side-add" onClick={() => setAdd({})} aria-label={navCollapsed ? 'Add' : undefined} data-tip={navCollapsed ? 'Add' : undefined}>
        <Icon name="plus" />
        <span className="side-label">Add</span>
      </button>
    </nav>
  ) : null;

  const tab = ([p, label, icon]: [string, string, string]) => (
    <button key={p} className="tab" aria-current={section === p ? 'page' : 'false'} onClick={() => go(p)}>
      <Icon name={icon} />
      {label}
    </button>
  );

  return (
    <AppCtx.Provider value={ctx}>
      <div className={`stage ${setupStep > 0 ? (wide ? '' : 'phone') : wide ? `wide${navCollapsed ? ' nav-collapsed' : ''}` : 'phone'}`}>
        <div className="app">
          {nav}
          <main>{screen}</main>
          {!wide && setupStep === 0 && (
            <nav className="tabbar" aria-label="Main">
              {NAV.slice(0, 2).map(tab)}
              <button className="tab-add" onClick={() => setAdd({})} aria-label="Add entry">
                <Icon name="plus" />
              </button>
              {NAV.slice(2, 4).map(tab)}
            </nav>
          )}
        </div>
      </div>
      {add && <AddSheet preset={add} onClose={() => setAdd(null)} />}
      {entryId && <EntrySheet id={entryId} onClose={() => setEntryId(null)} />}
      {conflict && <ConflictDialog conflict={conflict} onDone={() => setConflict(null)} />}
    </AppCtx.Provider>
  );
}

function ConflictDialog({ conflict, onDone }: { conflict: ConflictError; onDone: () => void }) {
  const { vault, ledger, wide } = useApp();
  const toast = useToast();
  const first = conflict.changes[0]!;
  const theirs = conflict.theirs.get(first.id);
  const describe = (value: unknown, type: string): string => {
    if (value === null || value === undefined) return 'Deleted';
    if (type === 'entry') {
      const e = value as Entry;
      const v = describeEntry(ledger, e);
      const cur = ledger.accounts.get(e.accountId)?.currency ?? 'BDT';
      return `${v.title} · ${fmtMoney(e.amount, cur)} · ${e.deletedAt ? 'deleted' : e.date}`;
    }
    return (value as { name?: string }).name ?? 'Settings';
  };
  const mine = 'delete' in first ? null : first.value;
  return (
    <Sheet title="Changed on another device" onClose={() => { vault.acceptTheirs(conflict); onDone(); }} wide={wide}>
      <p className="hint">This was changed on another device a moment ago. Which version do you want to keep?</p>
      <div className="conflict-grid">
        <div className="card">
          <b>Yours</b>
          <span className="small-muted">{describe(mine, 'delete' in first ? 'entry' : first.type)}</span>
        </div>
        <div className="card">
          <b>Other device</b>
          <span className="small-muted">{describe(theirs?.value ?? null, theirs?.type ?? 'entry')}</span>
        </div>
      </div>
      {conflict.changes.length > 1 && <p className="small-muted">This change affects {conflict.changes.length} records together.</p>}
      <div className="two">
        <button className="btn ghost" onClick={() => { vault.acceptTheirs(conflict); onDone(); }}>Keep theirs</button>
        <button
          className="btn"
          onClick={async () => {
            try {
              await vault.overwriteWithMine(conflict);
              toast('Saved your version');
            } catch (err) {
              toast(errorText(err));
            }
            onDone();
          }}
        >
          Keep mine
        </button>
      </div>
    </Sheet>
  );
}
