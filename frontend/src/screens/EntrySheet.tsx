import { useState, type FormEvent } from 'react';
import { amountInputValue, fmtDate, fmtMoney, parseAmount } from '../lib/format.ts';
import type { Entry } from '../money/types.ts';
import { describeEntry, useApp, type Change } from '../ui/ctx.tsx';
import { Icon } from '../ui/icons.tsx';
import { AmountInput, Field, Sheet } from '../ui/kit.tsx';

export function EntrySheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { ledger, wide, save, openEntry } = useApp();
  const e = ledger.entries.get(id);
  const [editing, setEditing] = useState(false);
  if (!e) return null;
  const v = describeEntry(ledger, e);
  const acct = ledger.accounts.get(e.accountId);
  const to = e.toAccountId ? ledger.accounts.get(e.toAccountId) : undefined;
  const children = [...ledger.entries].filter(([, c]) => c.parentId === id && !c.deletedAt);
  const parent = e.parentId ? ledger.entries.get(e.parentId) : undefined;

  async function remove() {
    const stamp = new Date().toISOString();
    const changes: Change[] = [[id, e!] as [string, Entry], ...children].map(([cid, c]) => ({ id: cid, type: 'entry' as const, value: { ...c, deletedAt: stamp } }));
    if (await save(changes, 'Moved to Recently deleted')) onClose();
  }

  return (
    <Sheet title={editing ? 'Edit entry' : v.title} onClose={onClose} onBack={editing ? () => setEditing(false) : undefined} wide={wide} label="Entry">
      {editing ? (
        <EditForm id={id} e={e} onDone={onClose} />
      ) : (
        <>
          <div className="row" style={{ borderTop: 0 }}>
            {v.icon}
            <span className="row-main">
              <span className="row-title">{v.title}</span>
              <span className="row-sub">{v.sub}</span>
            </span>
            <span className="row-amt num" style={{ fontSize: 20 }}>
              {v.amount}
            </span>
          </div>
          <div>
            <div className="kv">
              <span className="muted">Date</span>
              <span>{fmtDate(e.date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</span>
            </div>
            <div className="kv">
              <span className="muted">{e.kind === 'transfer' ? 'From' : 'Account'}</span>
              <span>{acct?.name ?? 'Deleted account'}</span>
            </div>
            {to && (
              <div className="kv">
                <span className="muted">To</span>
                <span>
                  {to.name}
                  {e.toAmount ? ` (${fmtMoney(e.toAmount, to.currency)})` : ''}
                </span>
              </div>
            )}
            {e.categoryId && (
              <div className="kv">
                <span className="muted">Category</span>
                <span>{ledger.categories.get(e.categoryId)?.name ?? 'Deleted category'}</span>
              </div>
            )}
            {e.note && (
              <div className="kv">
                <span className="muted">Note</span>
                <span>{e.note}</span>
              </div>
            )}
            {children.map(([cid, c]) => (
              <div key={cid} className="kv">
                <span className="muted">{c.note || 'Linked'}</span>
                <button className="link" onClick={() => openEntry(cid)}>
                  {fmtMoney(c.amount, ledger.accounts.get(c.accountId)?.currency)} <Icon name="chev" />
                </button>
              </div>
            ))}
            {parent && (
              <p className="small-muted">
                Part of: {describeEntry(ledger, parent).title}.{' '}
                <button className="link" onClick={() => openEntry(e.parentId!)}>Open</button>
              </p>
            )}
            {(e.kind === 'transfer' || e.kind === 'correction') && <p className="small-muted">Not counted as spending or income.</p>}
          </div>
          <div className="two">
            <button className="btn ghost" onClick={() => setEditing(true)}>
              <Icon name="edit" /> Edit
            </button>
            <button className="btn ghost" onClick={() => void remove()}>
              <Icon name="trash" /> Delete
            </button>
          </div>
          {children.length > 0 && <p className="small-muted">Deleting also removes the linked {children.length === 1 ? 'entry' : 'entries'} above.</p>}
        </>
      )}
    </Sheet>
  );
}

function EditForm({ id, e, onDone }: { id: string; e: Entry; onDone: () => void }) {
  const { ledger, save } = useApp();
  const acct = ledger.accounts.get(e.accountId);
  const to = e.toAccountId ? ledger.accounts.get(e.toAccountId) : undefined;
  const [amount, setAmount] = useState(amountInputValue(Math.abs(e.amount)));
  const [toAmount, setToAmount] = useState(e.toAmount ? amountInputValue(e.toAmount) : '');
  const [date, setDate] = useState(e.date);
  const [note, setNote] = useState(e.note ?? '');
  const [categoryId, setCategoryId] = useState(e.categoryId ?? '');
  const [accountId, setAccountId] = useState(e.accountId);
  const [error, setError] = useState<string | null>(null);
  const cats = [...ledger.categories].filter(([cid, c]) => c.kind === (e.kind === 'income' ? 'income' : 'expense') && (!c.hidden || cid === e.categoryId));
  const sameKindAccounts = [...ledger.accounts].filter(([aid, a]) => a.kind === acct?.kind && a.currency === acct?.currency && (!a.archived || aid === e.accountId));

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const amt = parseAmount(amount);
    if (!amt) return setError('Enter an amount.');
    const value: Entry = { ...e, date, note: note.trim() || undefined, accountId };
    value.amount = e.kind === 'correction' && e.amount < 0 ? -amt : amt;
    if (e.kind === 'expense' || e.kind === 'income') value.categoryId = categoryId;
    if (e.toAmount !== undefined) {
      const t = parseAmount(toAmount);
      if (!t) return setError('Enter the amount received.');
      value.toAmount = t;
    }
    // Linked fees and interest follow the main entry's date.
    const changes: Change[] = [{ id, type: 'entry', value }];
    for (const [cid, c] of ledger.entries) if (c.parentId === id && c.date !== date) changes.push({ id: cid, type: 'entry', value: { ...c, date } });
    if (await save(changes, 'Saved')) onDone();
  }

  return (
    <form className="col" style={{ gap: 14 }} onSubmit={(ev) => void submit(ev)}>
      <AmountInput id="e-amt" value={amount} onChange={setAmount} symbol={acct?.currency === 'USD' ? '$' : '৳'} />
      {e.kind === 'correction' && <p className="hint">This correction {e.amount < 0 ? 'lowers' : 'raises'} the balance by this amount.</p>}
      {e.toAmount !== undefined && to && (
        <Field label={`Amount received (${to.currency === 'USD' ? '$' : '৳'})`} htmlFor="e-to">
          <input id="e-to" inputMode="decimal" value={toAmount} onChange={(ev) => setToAmount(ev.target.value)} />
        </Field>
      )}
      {(e.kind === 'expense' || e.kind === 'income') && (
        <div className="field">
          <label>Category</label>
          <div className="cat-pick">
            {cats.map(([cid, c]) => (
              <button key={cid} type="button" aria-pressed={categoryId === cid} onClick={() => setCategoryId(cid)}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="two">
        <Field label={e.kind === 'transfer' ? 'From' : 'Account'} htmlFor="e-acct">
          <select id="e-acct" value={accountId} onChange={(ev) => setAccountId(ev.target.value)}>
            {sameKindAccounts.map(([aid, a]) => (
              <option key={aid} value={aid}>{a.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Date" htmlFor="e-date">
          <input id="e-date" type="date" value={date} onChange={(ev) => setDate(ev.target.value)} />
        </Field>
      </div>
      <Field label="Note" htmlFor="e-note">
        <input id="e-note" value={note} onChange={(ev) => setNote(ev.target.value)} />
      </Field>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn block" type="submit">Save changes</button>
    </form>
  );
}
