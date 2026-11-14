/**
 * The encrypted record store (spec section 10). Holds the decrypted records in
 * memory, pulls changes from the server, and saves changes as all-or-nothing
 * batches with version checks.
 */
import { api, decryptRecord, encryptRecord } from '@mm/shared';
import { call } from './api.ts';
import type { Ledger } from '../money/calc.ts';
import { defaultSettings } from '../money/defaults.ts';
import type { Account, Category, Entry, Settings } from '../money/types.ts';

interface Rec {
  type: api.RecordType;
  version: number;
  value: unknown;
  deleted: boolean;
}

export type Change = { id: string; type: api.RecordType; value: unknown } | { id: string; delete: true };

/** The server has a newer copy of some records than this device. */
export class ConflictError extends Error {
  constructor(
    public changes: Change[],
    /** Server copies: value, or null when deleted there. */
    public theirs: Map<string, { type: api.RecordType; version: number; value: unknown | null }>,
  ) {
    super('Changed on another device');
  }
}

export class Vault {
  private records = new Map<string, Rec>();
  private cursor = 0;
  private rates: api.RateRow[] = [];
  private listeners = new Set<() => void>();
  private ledger: (Ledger & { settingsId: string | null }) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pulling: Promise<void> | null = null;

  constructor(private readonly dataKey: Uint8Array) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    this.ledger = null;
    for (const fn of this.listeners) fn();
  }

  getLedger = (): Ledger & { settingsId: string | null } => {
    if (this.ledger) return this.ledger;
    const accounts = new Map<string, Account>();
    const categories = new Map<string, Category>();
    const entries = new Map<string, Entry>();
    let settings: Settings | null = null;
    let settingsId: string | null = null;
    for (const [id, r] of this.records) {
      if (r.deleted) continue;
      if (r.type === 'account') accounts.set(id, r.value as Account);
      else if (r.type === 'category') categories.set(id, r.value as Category);
      else if (r.type === 'entry') entries.set(id, r.value as Entry);
      else if (r.type === 'settings') {
        const s = r.value as Settings;
        // If two devices ever created settings at once, the oldest wins.
        if (!settings || s.createdAt < settings.createdAt) {
          settings = s;
          settingsId = id;
        }
      }
    }
    this.ledger = { accounts, categories, entries, settings: { ...defaultSettings(), setupStep: 0, ...settings }, settingsId, rates: this.rates };
    return this.ledger;
  };

  private apply(stored: api.StoredRecord): void {
    if (stored.deleted || !stored.ciphertext || !stored.nonce) {
      this.records.set(stored.id, { type: stored.type, version: stored.version, value: null, deleted: true });
    } else {
      const value = decryptRecord(this.dataKey, stored.id, stored.type, { nonce: stored.nonce, ciphertext: stored.ciphertext });
      this.records.set(stored.id, { type: stored.type, version: stored.version, value, deleted: false });
    }
    this.cursor = Math.max(this.cursor, stored.seq);
  }

  /** Fetches everything changed since the last pull. */
  pull(): Promise<void> {
    if (this.pulling) return this.pulling;
    this.pulling = (async () => {
      let changed = false;
      for (;;) {
        const res = await call<api.RecordsResponse>('GET', `/api/records?since=${this.cursor}`);
        for (const r of res.records) this.apply(r);
        changed ||= res.records.length > 0;
        if (res.records.length < 5000) break;
      }
      if (changed) this.emit();
    })().finally(() => {
      this.pulling = null;
    });
    return this.pulling;
  }

  async loadRates(): Promise<void> {
    try {
      this.rates = (await call<{ rates: api.RateRow[] }>('GET', '/api/rates')).rates;
      this.emit();
    } catch {
      /* rates are optional; totals fall back to an estimate */
    }
  }

  /** Initial load, then keeps in sync: every minute and whenever the app comes back to the front. */
  async start(): Promise<void> {
    await Promise.all([this.pull(), this.loadRates()]);
    this.emit();
    this.timer = setInterval(() => void this.pull().catch(() => {}), 60_000);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.listeners.clear();
  }

  private onVisible = (): void => {
    if (document.visibilityState === 'visible') void this.pull().catch(() => {});
  };

  /** Saves changes together. Throws ConflictError if another device changed any of them first. */
  async save(changes: Change[]): Promise<void> {
    const batch = changes.map((c) => {
      const base = this.records.get(c.id)?.version ?? 0;
      if ('delete' in c) return { id: c.id, baseVersion: base, delete: true as const };
      return { id: c.id, type: c.type, baseVersion: base, ...encryptRecord(this.dataKey, c.id, c.type, c.value) };
    });
    try {
      const res = await call<{ records: api.StoredRecord[] }>('POST', '/api/records/batch', { changes: batch });
      for (const stored of res.records) {
        const change = changes.find((c) => c.id === stored.id)!;
        this.records.set(stored.id, {
          type: stored.type,
          version: stored.version,
          value: 'delete' in change ? null : change.value,
          deleted: stored.deleted,
        });
      }
      this.emit();
    } catch (err) {
      const body = (err as { body?: { error?: string; conflicts?: api.StoredRecord[] } }).body;
      if (body?.error === 'conflict' && body.conflicts) {
        const theirs = new Map<string, { type: api.RecordType; version: number; value: unknown | null }>();
        for (const c of body.conflicts) {
          const value = c.ciphertext && c.nonce ? decryptRecord(this.dataKey, c.id, c.type, { nonce: c.nonce, ciphertext: c.ciphertext }) : null;
          theirs.set(c.id, { type: c.type, version: c.version, value });
        }
        throw new ConflictError(changes, theirs);
      }
      throw err;
    }
  }

  /** "Keep theirs": take the server copies. */
  acceptTheirs(conflict: ConflictError): void {
    for (const [id, t] of conflict.theirs) this.records.set(id, { type: t.type, version: t.version, value: t.value, deleted: t.value === null });
    this.emit();
    void this.pull().catch(() => {});
  }

  /** "Keep mine": save again on top of the server's versions. */
  async overwriteWithMine(conflict: ConflictError): Promise<void> {
    for (const [id, t] of conflict.theirs) {
      const local = this.records.get(id);
      this.records.set(id, { type: t.type, version: t.version, value: local?.value ?? t.value, deleted: t.value === null });
    }
    await this.save(conflict.changes);
  }
}
