import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  cryptoReady,
  decryptRecord,
  derivePasswordKeys,
  deriveRecoveryKeys,
  encryptRecord,
  generateRecoveryKey,
  newDataKey,
  newSalt,
  openLockbox,
  randomId,
  sealForAdmin,
  sealLockbox,
  type KdfParams,
} from '@mm/shared';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { type DB, openDatabase } from '../src/db.ts';
import { createUser, recoverUser, setupAdminRecovery } from '../src/admin/ops.ts';

const FAST: KdfParams = { ops: 2, mem: 16 * 1024 * 1024 };
const PHRASE = 'river lantern copper meadow';

let dir: string;
let db: DB;
let app: FastifyInstance;

beforeAll(async () => {
  await cryptoReady();
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mm-test-'));
  const config = { ...loadConfig({ MM_ENV: 'test', MM_DATA_DIR: dir }), env: 'test' as const };
  db = openDatabase(config.dbPath);
  app = buildApp(db, config);
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A tiny browser: keeps the session cookie between requests. */
class Client {
  cookie = '';
  constructor(private readonly server: FastifyInstance) {}
  async req(method: 'GET' | 'POST', url: string, body?: unknown) {
    const res = await this.server.inject({ method, url, payload: body as object, headers: this.cookie ? { cookie: this.cookie } : {} });
    const set = res.headers['set-cookie'];
    const first = Array.isArray(set) ? set[0] : set;
    if (first) this.cookie = first.split(';')[0]!;
    return { status: res.statusCode, body: res.json() as Record<string, any> };
  }
}

async function login(c: Client, username: string, password: string) {
  const pre = await c.req('POST', '/api/auth/prelogin', { username });
  const keys = derivePasswordKeys(password, pre.body.salt, pre.body.kdf);
  const res = await c.req('POST', '/api/auth/login', { username, loginKey: keys.loginKey });
  return { res, keys };
}

/** Creates a user with the admin tool and completes first-time setup, like the browser would. */
async function newReadyUser(username: string, mode: 'self' | 'admin' = 'self') {
  const { password: otp } = createUser(db, { username, kdf: FAST });
  const c = new Client(app);
  const { res, keys } = await login(c, username, otp);
  expect(res.status).toBe(200);
  expect(res.body.user.setupDone).toBe(false);
  const dataKey = newDataKey();
  const password = `${username}-real-password`;
  const salt = newSalt();
  const next = derivePasswordKeys(password, salt, FAST);
  const recoveryKey = generateRecoveryKey();
  const rk = deriveRecoveryKeys(recoveryKey);
  const setup = await c.req('POST', '/api/auth/setup', {
    currentLoginKey: keys.loginKey,
    salt,
    kdf: FAST,
    loginKey: next.loginKey,
    passwordLockbox: sealLockbox(dataKey, next.unlockKey, 'password'),
    recoveryMode: mode,
    personalRecovery: { lockbox: sealLockbox(dataKey, rk.unlockKey, 'personal_recovery'), authKey: rk.authKey },
    adminLockbox: mode === 'admin' ? sealForAdmin(dataKey, res.body.adminRecoveryPublicKey) : null,
  });
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  return { c, dataKey, password, recoveryKey };
}

function put(dataKey: Uint8Array, id: string, value: unknown, baseVersion = 0) {
  return { id, type: 'entry', baseVersion, ...encryptRecord(dataKey, id, 'entry', value) };
}

describe('login', () => {
  it('rejects a wrong password and does not reveal whether the user exists', async () => {
    createUser(db, { username: 'ayesha', kdf: FAST });
    const c = new Client(app);
    const known = await login(c, 'ayesha', 'not-it');
    const unknown = await login(c, 'nobody', 'not-it');
    expect(known.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(known.res.body.message).toBe(unknown.res.body.message);
  });

  it('gives unknown usernames a stable fake salt', async () => {
    const c = new Client(app);
    const a = await c.req('POST', '/api/auth/prelogin', { username: 'ghost' });
    const b = await c.req('POST', '/api/auth/prelogin', { username: 'GHOST' });
    expect(a.body.salt).toBe(b.body.salt);
  });

  it('slows down repeated failures', async () => {
    createUser(db, { username: 'karim', kdf: FAST });
    const c = new Client(app);
    for (let i = 0; i < 5; i++) expect((await login(c, 'karim', 'wrong')).res.status).toBe(401);
    expect((await login(c, 'karim', 'wrong')).res.status).toBe(429);
  });

  it('treats usernames case-insensitively', async () => {
    const { password } = createUser(db, { username: 'Rocky', kdf: FAST });
    const { res } = await login(new Client(app), 'ROCKY', password);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('rocky');
  });

  it('blocks record access until setup is done', async () => {
    const { password } = createUser(db, { username: 'sumi', kdf: FAST });
    const c = new Client(app);
    await login(c, 'sumi', password);
    expect((await c.req('GET', '/api/records')).status).toBe(403);
  });
});

describe('records', () => {
  it('stores, syncs and updates encrypted records between two devices', async () => {
    const { c: phone, dataKey, password } = await newReadyUser('rocky');
    const id = randomId();
    const created = await phone.req('POST', '/api/records/batch', { changes: [put(dataKey, id, { amount: 1250 })] });
    expect(created.status).toBe(200);
    expect(created.body.records[0].version).toBe(1);

    const pc = new Client(app);
    const { res, keys } = await login(pc, 'rocky', password);
    const pcKey = openLockbox(res.body.passwordLockbox, keys.unlockKey, 'password');
    const all = await pc.req('GET', '/api/records');
    expect(decryptRecord(pcKey, id, 'entry', all.body.records[0])).toEqual({ amount: 1250 });

    const updated = await pc.req('POST', '/api/records/batch', { changes: [put(pcKey, id, { amount: 1300 }, 1)] });
    expect(updated.body.records[0].version).toBe(2);
    const since = await phone.req('GET', `/api/records?since=${created.body.cursor}`);
    expect(since.body.records).toHaveLength(1);
    expect(decryptRecord(dataKey, id, 'entry', since.body.records[0])).toEqual({ amount: 1300 });
  });

  it('refuses an outdated change instead of overwriting (conflict)', async () => {
    const { c, dataKey } = await newReadyUser('rocky');
    const id = randomId();
    await c.req('POST', '/api/records/batch', { changes: [put(dataKey, id, { v: 'first' })] });
    await c.req('POST', '/api/records/batch', { changes: [put(dataKey, id, { v: 'pc edit' }, 1)] });
    const stale = await c.req('POST', '/api/records/batch', { changes: [put(dataKey, id, { v: 'phone edit' }, 1)] });
    expect(stale.status).toBe(409);
    expect(stale.body.conflicts[0].version).toBe(2);
    expect(decryptRecord(dataKey, id, 'entry', stale.body.conflicts[0])).toEqual({ v: 'pc edit' });
  });

  it('applies a batch all together or not at all', async () => {
    const { c, dataKey } = await newReadyUser('rocky');
    const a = randomId();
    const b = randomId();
    await c.req('POST', '/api/records/batch', { changes: [put(dataKey, a, { n: 1 })] });
    const res = await c.req('POST', '/api/records/batch', { changes: [put(dataKey, b, { n: 2 }), put(dataKey, a, { n: 3 }, 0)] });
    expect(res.status).toBe(409);
    const all = await c.req('GET', '/api/records');
    expect(all.body.records.map((r: { id: string }) => r.id)).toEqual([a]);
  });

  it('deletes with a tombstone that other devices can see', async () => {
    const { c, dataKey } = await newReadyUser('rocky');
    const id = randomId();
    await c.req('POST', '/api/records/batch', { changes: [put(dataKey, id, { n: 1 })] });
    const del = await c.req('POST', '/api/records/batch', { changes: [{ id, baseVersion: 1, delete: true }] });
    expect(del.body.records[0]).toMatchObject({ id, deleted: true, ciphertext: null, version: 2 });
  });

  it('keeps users apart', async () => {
    const one = await newReadyUser('rocky');
    const two = await newReadyUser('ayesha');
    await one.c.req('POST', '/api/records/batch', { changes: [put(one.dataKey, randomId(), { mine: true })] });
    expect((await two.c.req('GET', '/api/records')).body.records).toHaveLength(0);
  });

  it('never stores readable financial data on the server', async () => {
    const { c, dataKey } = await newReadyUser('rocky');
    const marker = 'Shoes-Bata-MARKER-7731';
    await c.req('POST', '/api/records/batch', { changes: [put(dataKey, randomId(), { note: marker, amount: 350000 })] });
    db.exec('PRAGMA wal_checkpoint(FULL)');
    const bytes = readFileSync(join(dir, 'money-manager.db')).toString('latin1');
    expect(bytes).not.toContain(marker);
    expect(bytes).not.toContain('350000');
  });
});

describe('passwords and recovery', () => {
  it('changes the password without losing data', async () => {
    const { c, dataKey, password } = await newReadyUser('rocky');
    const pre = await c.req('POST', '/api/auth/prelogin', { username: 'rocky' });
    const current = derivePasswordKeys(password, pre.body.salt, pre.body.kdf);
    const salt = newSalt();
    const next = derivePasswordKeys('brand new password', salt, FAST);
    const res = await c.req('POST', '/api/auth/password', {
      currentLoginKey: current.loginKey,
      salt,
      kdf: FAST,
      loginKey: next.loginKey,
      passwordLockbox: sealLockbox(dataKey, next.unlockKey, 'password'),
    });
    expect(res.status).toBe(200);
    const again = await login(new Client(app), 'rocky', 'brand new password');
    expect(openLockbox(again.res.body.passwordLockbox, again.keys.unlockKey, 'password')).toEqual(dataKey);
    expect((await login(new Client(app), 'rocky', password)).res.status).toBe(401);
  });

  it('recovers a forgotten password with the personal recovery key', async () => {
    const { dataKey, recoveryKey } = await newReadyUser('rocky');
    const c = new Client(app);
    const rk = deriveRecoveryKeys(recoveryKey.toLowerCase());
    const start = await c.req('POST', '/api/auth/recovery/start', { username: 'rocky', recoveryAuthKey: rk.authKey });
    expect(start.status).toBe(200);
    const recovered = openLockbox(start.body.lockbox, rk.unlockKey, 'personal_recovery');
    expect(recovered).toEqual(dataKey);
    const salt = newSalt();
    const next = derivePasswordKeys('after recovery', salt, FAST);
    const done = await c.req('POST', '/api/auth/recovery/complete', {
      username: 'rocky',
      recoveryAuthKey: rk.authKey,
      salt,
      kdf: FAST,
      loginKey: next.loginKey,
      passwordLockbox: sealLockbox(recovered, next.unlockKey, 'password'),
    });
    expect(done.status).toBe(200);
    expect((await c.req('GET', '/api/records')).status).toBe(200);
  });

  it('rejects a wrong recovery key', async () => {
    await newReadyUser('rocky');
    const res = await new Client(app).req('POST', '/api/auth/recovery/start', { username: 'rocky', recoveryAuthKey: deriveRecoveryKeys(generateRecoveryKey()).authKey });
    expect(res.status).toBe(401);
  });

  it('lets the admin recover a user who chose admin recovery, keeping their data', async () => {
    setupAdminRecovery(db, PHRASE, undefined, FAST);
    const { c, dataKey } = await newReadyUser('ayesha', 'admin');
    const id = randomId();
    await c.req('POST', '/api/records/batch', { changes: [put(dataKey, id, { note: 'kept' })] });

    const { password: temp } = recoverUser(db, 'ayesha', PHRASE, FAST);
    expect((await c.req('GET', '/api/records')).status).toBe(401); // old sessions are logged out
    const fresh = new Client(app);
    const { res, keys } = await login(fresh, 'ayesha', temp);
    expect(res.body.user.mustChangePassword).toBe(true);
    const key = openLockbox(res.body.passwordLockbox, keys.unlockKey, 'password');
    expect(key).toEqual(dataKey);
    expect((await fresh.req('GET', '/api/records')).status).toBe(403); // must choose a new password first
  });

  it('refuses admin recovery for a user who chose "only I can recover"', async () => {
    setupAdminRecovery(db, PHRASE, undefined, FAST);
    await newReadyUser('karim', 'self');
    expect(() => recoverUser(db, 'karim', PHRASE, FAST)).toThrow(/only I can recover/);
  });

  it('refuses the wrong admin phrase', async () => {
    setupAdminRecovery(db, PHRASE, undefined, FAST);
    await newReadyUser('ayesha', 'admin');
    expect(() => recoverUser(db, 'ayesha', 'not the right phrase at all', FAST)).toThrow(/not correct/);
  });

  it('re-locks admin lockboxes when the admin phrase changes', async () => {
    setupAdminRecovery(db, PHRASE, undefined, FAST);
    await newReadyUser('ayesha', 'admin');
    const { relocked } = setupAdminRecovery(db, 'a completely new phrase here', PHRASE, FAST);
    expect(relocked).toBe(1);
    expect(() => recoverUser(db, 'ayesha', PHRASE, FAST)).toThrow();
    expect(recoverUser(db, 'ayesha', 'a completely new phrase here', FAST).password).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('refuses admin recovery mode before the admin has set it up', async () => {
    const { password } = createUser(db, { username: 'sumi', kdf: FAST });
    const c = new Client(app);
    const { keys } = await login(c, 'sumi', password);
    const res = await c.req('POST', '/api/auth/setup', {
      currentLoginKey: keys.loginKey,
      salt: newSalt(),
      kdf: FAST,
      loginKey: keys.loginKey,
      passwordLockbox: sealLockbox(newDataKey(), keys.unlockKey, 'password'),
      recoveryMode: 'admin',
      personalRecovery: null,
      adminLockbox: 'x'.repeat(60),
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('admin_recovery_not_ready');
  });
});
