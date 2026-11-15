import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { applyContrast, clampContrast, CONTRAST_MAX, CONTRAST_NAMES } from '../lib/contrast.ts';
import { derivePasswordKeys, randomId, type api } from '@mm/shared';
import { changePassword, changeRecovery, MIN_PASSWORD } from '../lib/auth.ts';
import { fmtDate, fmtMoney, parseAmount } from '../lib/format.ts';
import { rateOn } from '../money/calc.ts';
import type { Category, Settings } from '../money/types.ts';
import { describeEntry, useApp, type Change } from '../ui/ctx.tsx';
import { Icon } from '../ui/icons.tsx';
import { Busy, Field } from '../ui/kit.tsx';
import { errorText } from './Auth.tsx';
import { ownRateChange } from './AddSheet.tsx';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="h2">{title}</h2>
      {children}
    </section>
  );
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function SettingsScreen() {
  const { ledger, wide, save, session, logout, lock } = useApp();
  const s = ledger.settings;
  // Quick taps in a row (e.g. style, then theme) are merged, so the second doesn't undo the first.
  const pending = useRef<Partial<Settings>>({});
  const update = (patch: Partial<Settings>) => {
    if (!ledger.settingsId) return;
    pending.current = { ...pending.current, ...patch };
    const value = { ...s, ...pending.current };
    void save([{ id: ledger.settingsId, type: 'settings', value }]).finally(() => {
      for (const k of Object.keys(patch) as (keyof Settings)[]) if (pending.current[k] === patch[k]) delete pending.current[k];
    });
  };

  // Card contrast: dragging previews at once; the level is saved 400 ms after the last change.
  const saved = clampContrast(s.contrast);
  const [contrast, setContrast] = useState(saved);
  useEffect(() => setContrast(saved), [saved]);
  useEffect(() => {
    if (contrast === saved) return;
    const t = setTimeout(() => update({ contrast }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contrast]);

  const look = (
    <Section title="Look">
      <div className="rows">
        <div className="row setting-row">
          <span className="row-main">
            <span className="row-title">Style</span>
            <span className="row-sub">Colour, or Ink (black and white)</span>
          </span>
          <Seg label="Style" value={s.style} options={[['colour', 'Colour'], ['ink', 'Ink']]} onChange={(v) => void update({ style: v })} />
        </div>
        <div className="row setting-row">
          <span className="row-main">
            <span className="row-title">Theme</span>
            <span className="row-sub">Light, dark, or follow the device</span>
          </span>
          <Seg label="Theme" value={s.theme} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']]} onChange={(v) => void update({ theme: v })} />
        </div>
        <div className="row setting-row">
          <span className="row-main">
            <span className="row-title">Number format</span>
            <span className="row-sub">{s.numberFormat === 'bd' ? '৳1,00,000 (lakh)' : '৳100,000'}</span>
          </span>
          <Seg label="Number format" value={s.numberFormat} options={[['bd', 'Lakh'], ['intl', 'International']]} onChange={(v) => void update({ numberFormat: v })} />
        </div>
        <div className="row setting-row">
          <span className="row-main">
            <span className="row-title">Card contrast</span>
            <span className="row-sub">How clearly cards stand out from the background</span>
          </span>
          <span className="contrast-dial">
            <input
              type="range"
              min={0}
              max={CONTRAST_MAX}
              step={1}
              value={contrast}
              aria-label="Card contrast"
              aria-valuetext={CONTRAST_NAMES[contrast]}
              onChange={(e) => {
                const v = Number(e.target.value);
                setContrast(v);
                applyContrast(v); // preview straight away; saved a moment after the last move
              }}
            />
            <span className="contrast-name">{CONTRAST_NAMES[contrast]}</span>
          </span>
        </div>
      </div>
    </Section>
  );

  const left = (
    <>
      {look}
      <DollarRate />
      <Categories />
    </>
  );
  const right = (
    <>
      <PasswordSection />
      <RecoverySection />
      <RecentlyDeleted />
      <Section title="Account">
        <div className="kv">
          <span className="muted">Username</span>
          <span>{session.user.username}</span>
        </div>
        <div className="kv">
          <span className="muted">Name</span>
          <span>{session.user.displayName}</span>
        </div>
        <div className="list-actions">
          <button className="btn ghost small" onClick={() => void update({ setupStep: 3 })}>Run setup again</button>
          <button className="btn ghost small" onClick={lock}>Lock now</button>
          <button className="btn ghost small" onClick={logout}>
            <Icon name="logout" /> Log out
          </button>
        </div>
        <p className="small-muted">Your data is encrypted on this device. The server only stores unreadable data.</p>
        <p className="small-muted">This device stays unlocked for an hour after you last use the app. After that, or after "Lock now", it asks for your password again.</p>
      </Section>
    </>
  );
  return (
    <div className="screen">
      <header className="top">
        <div>
          <p className="eyebrow">{session.user.displayName}</p>
          <h1 className="h1">Settings</h1>
        </div>
      </header>
      {wide ? (
        <div className="wide-grid">
          <div className="col">{left}</div>
          <div className="col">{right}</div>
        </div>
      ) : (
        <>
          {left}
          {right}
        </>
      )}
    </div>
  );
}

function DollarRate() {
  const { ledger, today, save } = useApp();
  const s = ledger.settings;
  const current = rateOn(ledger, today);
  const latestAuto = [...ledger.rates].sort((a, b) => b.date.localeCompare(a.date))[0];
  const [own, setOwn] = useState(current.source === 'own' ? String(current.rate) : '');
  const [error, setError] = useState<string | null>(null);

  async function useOwn(e: FormEvent) {
    e.preventDefault();
    const minor = parseAmount(own);
    if (!minor || minor < 5000 || minor > 50000) return setError('Enter a rate like 122.40 (taka per dollar).');
    setError(null);
    await save(ownRateChange(s, ledger.settingsId, minor / 100, today), 'Using your rate');
  }
  async function useAuto() {
    if (!ledger.settingsId) return;
    const prevDay = new Date(Date.parse(`${today}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
    const ownRates = s.ownRates.map((p) => (p.to === null ? { ...p, to: prevDay < p.from ? p.from : prevDay } : p));
    await save([{ id: ledger.settingsId, type: 'settings', value: { ...s, rateMode: 'auto', ownRates } }], 'Using the automatic rate');
  }

  return (
    <Section title="Dollar rate">
      <p className="sentence">
        $1 = <b className="num">৳{current.rate.toFixed(2)}</b>{' '}
        <span className="small-muted">
          · {current.source === 'own' ? `your rate since ${fmtDate(current.date!)}` : current.source === 'auto' ? `automatic · ${current.date === today ? 'updated today' : `from ${fmtDate(current.date!)}`}` : 'estimate: no rate fetched yet'}
        </span>
      </p>
      {current.source === 'own' ? (
        <button className="btn ghost small" onClick={() => void useAuto()}>
          Switch back to automatic{latestAuto ? ` (৳${latestAuto.usdToBdt.toFixed(2)})` : ''}
        </button>
      ) : null}
      <form className="inline-form" onSubmit={(e) => void useOwn(e)}>
        <Field label="Use my own rate (৳ per $)" htmlFor="own-rate">
          <input id="own-rate" inputMode="decimal" value={own} onChange={(e) => setOwn(e.target.value)} placeholder="e.g. 123.50" />
        </Field>
        <button className="btn small" type="submit">Use</button>
      </form>
      <p className="hint" style={{ marginTop: -4 }}>For example what your bank or money changer actually gives you.</p>
      {error && <p className="error-text">{error}</p>}
    </Section>
  );
}

function Categories() {
  const { ledger, save } = useApp();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const list = [...ledger.categories].filter(([, c]) => c.kind === kind).sort(([, a], [, b]) => a.sortOrder - b.sortOrder);
  const put = (id: string, c: Category, msg?: string) => save([{ id, type: 'category', value: c }], msg);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const slot = 1 + (ledger.categories.size % 6);
    if (await put(randomId(), { kind, name: newName.trim(), slot, icon: kind === 'income' ? 'in' : 'dots', hidden: false, sortOrder: ledger.categories.size }, `${newName.trim()} added`)) setNewName('');
  }

  return (
    <Section title="Categories">
      <div>
        <Seg label="Kind" value={kind} options={[['expense', 'Spending'], ['income', 'Income']]} onChange={setKind} />
      </div>
      <div className="rows">
        {list.map(([id, c]) => (
          <div key={id} className="row">
            <span className="swatch" style={{ width: 10, height: 10, borderRadius: 3, background: c.slot ? `var(--c${c.slot})` : 'var(--c-other)' }} />
            {renaming === id ? (
              <form
                className="row-main inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (renameText.trim()) void put(id, { ...c, name: renameText.trim() }, 'Renamed').then(() => setRenaming(null));
                }}
              >
                <input className="textarea" aria-label="New name" value={renameText} onChange={(e) => setRenameText(e.target.value)} autoFocus />
                <button className="btn small" type="submit">Save</button>
              </form>
            ) : (
              <span className="row-main">
                <span className="row-title" style={{ fontWeight: 500, opacity: c.hidden ? 0.5 : 1 }}>{c.name}</span>
                {c.hidden && <span className="row-sub">Hidden from the add form</span>}
              </span>
            )}
            {renaming !== id && (
              <>
                <button className="link" onClick={() => { setRenaming(id); setRenameText(c.name); }}>Rename</button>
                {!c.system && <button className="link" onClick={() => void put(id, { ...c, hidden: !c.hidden })}>{c.hidden ? 'Show' : 'Hide'}</button>}
              </>
            )}
          </div>
        ))}
      </div>
      <form className="inline-form" onSubmit={(e) => void add(e)}>
        <Field label={`New ${kind === 'expense' ? 'spending' : 'income'} category`} htmlFor="new-cat">
          <input id="new-cat" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Pets" />
        </Field>
        <button className="btn small" type="submit">Add</button>
      </form>
      <p className="small-muted">Categories are hidden rather than deleted, so past entries keep their category.</p>
    </Section>
  );
}

function PasswordSection() {
  const { session, dataKey, setSession } = useApp();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < MIN_PASSWORD) return setMsg({ ok: false, text: `Use at least ${MIN_PASSWORD} characters.` });
    if (pw !== pw2) return setMsg({ ok: false, text: 'The two new passwords do not match.' });
    setBusy(true);
    setMsg(null);
    try {
      await new Promise((r) => setTimeout(r, 40));
      const currentKey = derivePasswordKeys(current, session.user.salt, session.user.kdf).loginKey;
      const r = await changePassword({ currentLoginKey: currentKey, dataKey, newPassword: pw });
      setSession(r.session);
      setCurrent('');
      setPw('');
      setPw2('');
      setMsg({ ok: true, text: 'Password changed. Other devices have been logged out.' });
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    }
    setBusy(false);
  }
  return (
    <Section title="Password">
      <form className="col" style={{ gap: 10 }} onSubmit={(e) => void submit(e)}>
        <Field label="Current password" htmlFor="pw-cur">
          <input id="pw-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <div className="two">
          <Field label="New password" htmlFor="pw-new">
            <input id="pw-new" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="Type it again" htmlFor="pw-new2">
            <input id="pw-new2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
        </div>
        {msg && <p className={msg.ok ? 'ok-text' : 'error-text'}>{msg.text}</p>}
        <Busy busy={busy} className="btn small" type="submit">Change password</Busy>
      </form>
    </Section>
  );
}

function RecoverySection() {
  const { session, dataKey, setSession } = useApp();
  const adminReady = Boolean(session.adminRecoveryPublicKey);
  const [current, setCurrent] = useState('');
  const [mode, setMode] = useState<api.RecoveryMode>(session.user.recoveryMode ?? 'self');
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply(makeKey: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (!current) throw new Error('Type your password first.');
      await new Promise((r) => setTimeout(r, 40));
      const currentKey = derivePasswordKeys(current, session.user.salt, session.user.kdf).loginKey;
      const needKey = makeKey || (mode === 'self' && !session.user.hasPersonalRecovery);
      const r = await changeRecovery({ currentLoginKey: currentKey, dataKey, mode, newKey: needKey, adminPub: session.adminRecoveryPublicKey });
      setCurrent('');
      setSession(r.session);
      setNewKey(r.recoveryKey);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  const changed = mode !== session.user.recoveryMode;
  return (
    <Section title="If you forget your password">
      <button className="choice" aria-pressed={mode === 'admin'} disabled={!adminReady} onClick={() => setMode('admin')}>
        <span className="t">The admin can help me</span>
        <span className="d">{adminReady ? 'The admin can give you a new password and nothing is lost. The admin can technically read your data.' : 'Not available until the admin sets up admin recovery.'}</span>
      </button>
      <button className="choice" aria-pressed={mode === 'self'} onClick={() => setMode('self')}>
        <span className="t">Only I can recover</span>
        <span className="d">Nobody else can read your data. You need your recovery key.</span>
      </button>
      <p className="small-muted">Personal recovery key: {session.user.hasPersonalRecovery ? 'set up' : 'none yet'}.</p>
      <Field label="Your password, to confirm" htmlFor="rec-pw">
        <input id="rec-pw" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      {error && <p className="error-text">{error}</p>}
      <div className="list-actions">
        {changed && (
          <Busy busy={busy} className="btn small" onClick={() => void apply(false)}>
            Save choice
          </Busy>
        )}
        <Busy busy={busy} className="btn ghost small" onClick={() => void apply(true)}>
          Make a new recovery key
        </Busy>
      </div>
      {newKey && (
        <div className="col" style={{ gap: 8 }}>
          <p className="hint">Your new recovery key. Write it down now: it's shown only once, and the old key no longer works.</p>
          <div className="keybox num">
            {newKey.split('-').map((g, i) => (
              <span key={i}>{g}</span>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function RecentlyDeleted() {
  const { ledger, save } = useApp();
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const deleted = useMemo(() => [...ledger.entries].filter(([, e]) => e.deletedAt && !e.parentId).sort(([, a], [, b]) => b.deletedAt!.localeCompare(a.deletedAt!)), [ledger]);
  const withChildren = (id: string) => [...ledger.entries].filter(([cid, c]) => cid === id || c.parentId === id);
  const restore = (id: string) => save(withChildren(id).map(([cid, c]) => ({ id: cid, type: 'entry' as const, value: { ...c, deletedAt: undefined } })), 'Restored');
  const eraseAll = () => {
    const ids = new Set(deleted.flatMap(([id]) => withChildren(id).map(([cid]) => cid)));
    const changes: Change[] = [...ids].map((id) => ({ id, delete: true as const }));
    return changes.length ? save(changes, 'Erased for good') : Promise.resolve(true);
  };
  return (
    <Section title="Recently deleted">
      {deleted.length ? (
        <>
          <div className="rows">
            {deleted.map(([id, e]) => {
              const v = describeEntry(ledger, e);
              return (
                <div key={id} className="row">
                  {v.icon}
                  <span className="row-main">
                    <span className="row-title">{v.title}</span>
                    <span className="row-sub">
                      {fmtDate(e.date)} · {fmtMoney(e.amount, ledger.accounts.get(e.accountId)?.currency)}
                    </span>
                  </span>
                  <button className="btn small ghost" onClick={() => void restore(id)}>
                    <Icon name="undo" /> Restore
                  </button>
                </div>
              );
            })}
          </div>
          <p className="small-muted">Deleted entries are erased for good after 30 days.</p>
          {confirmEmpty ? (
            <div className="banner">
              <span>Erase {deleted.length} entries for good? This can't be undone.</span>
              <button className="btn small danger" onClick={() => void eraseAll().then(() => setConfirmEmpty(false))}>Erase</button>
            </div>
          ) : (
            <button className="link" onClick={() => setConfirmEmpty(true)}>Empty now</button>
          )}
        </>
      ) : (
        <p className="muted">Nothing here. Deleted entries stay here for 30 days.</p>
      )}
    </Section>
  );
}
