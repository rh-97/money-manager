import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { createHmac, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { api, DEFAULT_KDF } from '@mm/shared';
import type { Config } from './config.ts';
import { type DB, now, serverSecret, transaction } from './db.ts';
import { hashSecret, newToken, sha256, verifySecret } from './secrets.ts';

const SESSION_COOKIE = 'mm_session';
const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'user';
  disabled: number;
  must_change_password: number;
  setup_done: number;
  login_key_hash: string;
  kdf_salt: string;
  kdf_ops: number;
  kdf_mem: number;
  recovery_mode: 'admin' | 'self' | null;
  recovery_auth_hash: string | null;
}

interface RecordRow {
  id: string;
  type: string;
  version: number;
  seq: number;
  deleted: number;
  nonce: string | null;
  ciphertext: string | null;
  updated_at: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    sessionHash: string | null;
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new HttpError(400, 'invalid_request', first ? `${first.path.join('.') || 'request'}: ${first.message}` : 'Invalid request');
  }
  return result.data;
}

export function buildApp(db: DB, config: Config): FastifyInstance {
  const app = Fastify({
    logger: config.env === 'test' ? false : { level: 'info', redact: ['req.headers.cookie'] },
    trustProxy: config.trustProxy,
    bodyLimit: 8 * 1024 * 1024,
  });
  const secret = serverSecret(db);

  void app.register(cookie);
  void app.register(rateLimit, { global: false });
  app.decorateRequest('user', null);
  app.decorateRequest('sessionHash', null);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.code, message: err.message, ...err.extra });
    }
    const e = err as Error & { statusCode?: number };
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: 'request_error', message: e.message });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'server_error', message: 'Something went wrong on the server.' });
  });

  // ---------- Helpers ----------

  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    lockbox: db.prepare('SELECT data FROM lockboxes WHERE user_id = ? AND kind = ?'),
    putLockbox: db.prepare(
      'INSERT INTO lockboxes (user_id, kind, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, kind) DO UPDATE SET data = excluded.data, created_at = excluded.created_at',
    ),
    dropLockbox: db.prepare('DELETE FROM lockboxes WHERE user_id = ? AND kind = ?'),
    adminRecovery: db.prepare('SELECT public_key FROM admin_recovery WHERE id = 1'),
    session: db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    touchSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
    deleteAllSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    failure: db.prepare('SELECT count, last_at FROM login_failures WHERE key = ?'),
    addFailure: db.prepare(
      'INSERT INTO login_failures (key, count, last_at) VALUES (?, 1, ?) ON CONFLICT (key) DO UPDATE SET count = count + 1, last_at = excluded.last_at',
    ),
    clearFailures: db.prepare('DELETE FROM login_failures WHERE key = ?'),
    records: db.prepare('SELECT id, type, version, seq, deleted, nonce, ciphertext, updated_at FROM records WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT 5000'),
    record: db.prepare('SELECT id, type, version, seq, deleted, nonce, ciphertext, updated_at FROM records WHERE user_id = ? AND id = ?'),
    nextSeq: db.prepare('UPDATE users SET seq = seq + 1 WHERE id = ? RETURNING seq'),
    insertRecord: db.prepare(
      'INSERT INTO records (user_id, id, type, version, seq, deleted, nonce, ciphertext, updated_at) VALUES (?, ?, ?, 1, ?, 0, ?, ?, ?)',
    ),
    updateRecord: db.prepare('UPDATE records SET version = version + 1, seq = ?, deleted = 0, nonce = ?, ciphertext = ?, updated_at = ? WHERE user_id = ? AND id = ?'),
    deleteRecord: db.prepare(
      'UPDATE records SET version = version + 1, seq = ?, deleted = 1, nonce = NULL, ciphertext = NULL, updated_at = ? WHERE user_id = ? AND id = ?',
    ),
    rates: db.prepare('SELECT date, usd_to_bdt, source FROM exchange_rates ORDER BY date'),
  };

  const toStored = (r: RecordRow): api.StoredRecord => ({
    id: r.id,
    type: r.type as api.RecordType,
    version: r.version,
    seq: r.seq,
    deleted: r.deleted === 1,
    nonce: r.nonce,
    ciphertext: r.ciphertext,
    updatedAt: r.updated_at,
  });

  function sessionView(user: UserRow): api.SessionResponse {
    const lb = q.lockbox.get(user.id, 'password') as { data: string } | undefined;
    const admin = q.adminRecovery.get() as { public_key: string } | undefined;
    const hasPersonal = Boolean(q.lockbox.get(user.id, 'personal_recovery'));
    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        mustChangePassword: user.must_change_password === 1,
        setupDone: user.setup_done === 1,
        recoveryMode: user.recovery_mode,
        hasPersonalRecovery: hasPersonal,
        salt: user.kdf_salt,
        kdf: { ops: user.kdf_ops, mem: user.kdf_mem },
      },
      passwordLockbox: lb?.data ?? null,
      adminRecoveryPublicKey: admin?.public_key ?? null,
    };
  }

  function startSession(reply: FastifyReply, userId: string): string {
    const token = newToken();
    const hash = sha256(token);
    q.insertSession.run(hash, userId, now(), new Date(Date.now() + SESSION_DAYS * DAY_MS).toISOString());
    void reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'strict',
      path: '/api',
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
    return hash;
  }

  /** Growing delay after repeated failures for the same username: 5 free tries, then 2s, 4s, 8s ... up to 15 minutes. */
  function checkThrottle(key: string): void {
    const row = q.failure.get(key) as { count: number; last_at: string } | undefined;
    if (!row || row.count < 5) return;
    const waitMs = Math.min(2 ** (row.count - 4) * 1000, 15 * 60 * 1000);
    const remaining = Date.parse(row.last_at) + waitMs - Date.now();
    if (remaining > 0) {
      throw new HttpError(429, 'too_many_attempts', `Too many failed attempts. Try again in ${Math.ceil(remaining / 1000)} seconds.`, {
        retryAfterSeconds: Math.ceil(remaining / 1000),
      });
    }
  }

  const fakeSalt = (username: string): string => createHmac('sha256', secret).update(`salt:${username}`).digest().subarray(0, 16).toString('base64');

  function requireUser(req: FastifyRequest): UserRow {
    if (!req.user) throw new HttpError(401, 'not_logged_in', 'Please log in.');
    return req.user;
  }

  function requireReady(req: FastifyRequest): UserRow {
    const user = requireUser(req);
    if (!user.setup_done || user.must_change_password) {
      throw new HttpError(403, 'setup_required', 'Finish setting up your account first.');
    }
    return user;
  }

  function checkCurrentKey(user: UserRow, loginKey: string): void {
    const key = `user:${user.username}`;
    checkThrottle(key);
    if (!verifySecret(loginKey, user.login_key_hash)) {
      q.addFailure.run(key, now());
      throw new HttpError(401, 'wrong_password', 'Your current password is not correct.');
    }
    q.clearFailures.run(key);
  }

  // ---------- Session loading ----------

  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const hash = sha256(token);
    const row = q.session.get(hash) as { user_id: string; expires_at: string } | undefined;
    if (!row || Date.parse(row.expires_at) < Date.now()) return;
    const user = q.userById.get(row.user_id) as UserRow | undefined;
    if (!user || user.disabled) return;
    req.user = user;
    req.sessionHash = hash;
    // Sliding expiry, refreshed at most once a day.
    if (Date.parse(row.expires_at) - Date.now() < (SESSION_DAYS - 1) * DAY_MS) {
      q.touchSession.run(new Date(Date.now() + SESSION_DAYS * DAY_MS).toISOString(), hash);
    }
  });

  const authLimit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  // ---------- Routes ----------

  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/auth/prelogin', authLimit, async (req) => {
    const { username } = parse(api.preloginRequest, req.body);
    const user = q.userByName.get(username) as UserRow | undefined;
    // Unknown usernames get a stable fake salt, so the response does not reveal who has an account.
    if (!user || user.disabled) return { salt: fakeSalt(username), kdf: DEFAULT_KDF };
    return { salt: user.kdf_salt, kdf: { ops: user.kdf_ops, mem: user.kdf_mem } };
  });

  app.post('/api/auth/login', authLimit, async (req, reply) => {
    const { username, loginKey } = parse(api.loginRequest, req.body);
    const key = `user:${username}`;
    checkThrottle(key);
    const user = q.userByName.get(username) as UserRow | undefined;
    if (!user || user.disabled || !verifySecret(loginKey, user.login_key_hash)) {
      q.addFailure.run(key, now());
      throw new HttpError(401, 'wrong_login', 'That username and password do not match.');
    }
    q.clearFailures.run(key);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), user.id);
    startSession(reply, user.id);
    return sessionView(user);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionHash) q.deleteSession.run(req.sessionHash);
    void reply.clearCookie(SESSION_COOKIE, { path: '/api' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => sessionView(requireUser(req)));

  app.post('/api/auth/setup', async (req) => {
    const user = requireUser(req);
    const body = parse(api.setupRequest, req.body);
    if (user.setup_done) throw new HttpError(409, 'already_set_up', 'This account is already set up.');
    checkCurrentKey(user, body.currentLoginKey);
    validateRecovery(user, body.recoveryMode, body.personalRecovery, body.adminLockbox, false);
    transaction(db, () => {
      db.prepare(
        'UPDATE users SET login_key_hash = ?, kdf_salt = ?, kdf_ops = ?, kdf_mem = ?, must_change_password = 0, setup_done = 1, recovery_mode = ? WHERE id = ?',
      ).run(hashSecret(body.loginKey), body.salt, body.kdf.ops, body.kdf.mem, body.recoveryMode, user.id);
      q.putLockbox.run(user.id, 'password', body.passwordLockbox, now());
      applyRecovery(user.id, body.recoveryMode, body.personalRecovery, body.adminLockbox);
      q.deleteOtherSessions.run(user.id, req.sessionHash!);
    });
    return sessionView(q.userById.get(user.id) as unknown as UserRow);
  });

  app.post('/api/auth/password', async (req) => {
    const user = requireUser(req);
    const body = parse(api.passwordChangeRequest, req.body);
    if (!user.setup_done) throw new HttpError(403, 'setup_required', 'Finish setting up your account first.');
    checkCurrentKey(user, body.currentLoginKey);
    transaction(db, () => {
      db.prepare('UPDATE users SET login_key_hash = ?, kdf_salt = ?, kdf_ops = ?, kdf_mem = ?, must_change_password = 0 WHERE id = ?').run(
        hashSecret(body.loginKey),
        body.salt,
        body.kdf.ops,
        body.kdf.mem,
        user.id,
      );
      q.putLockbox.run(user.id, 'password', body.passwordLockbox, now());
      q.deleteOtherSessions.run(user.id, req.sessionHash!);
    });
    return sessionView(q.userById.get(user.id) as unknown as UserRow);
  });

  function validateRecovery(
    user: UserRow,
    mode: api.RecoveryMode,
    personal: { lockbox: string; authKey: string } | null,
    adminLockbox: string | null,
    allowExistingPersonal: boolean,
  ): void {
    if (mode === 'admin') {
      if (!q.adminRecovery.get()) throw new HttpError(409, 'admin_recovery_not_ready', 'The admin has not set up admin recovery yet.');
      if (!adminLockbox) throw new HttpError(400, 'invalid_request', 'adminLockbox is required for admin recovery.');
    }
    if (mode === 'self') {
      const hasExisting = allowExistingPersonal && Boolean(q.lockbox.get(user.id, 'personal_recovery'));
      if (!personal && !hasExisting) throw new HttpError(400, 'invalid_request', 'A personal recovery key is required when only you can recover.');
    }
  }

  function applyRecovery(
    userId: string,
    mode: api.RecoveryMode,
    personal: { lockbox: string; authKey: string } | null,
    adminLockbox: string | null,
  ): void {
    db.prepare('UPDATE users SET recovery_mode = ? WHERE id = ?').run(mode, userId);
    if (personal) {
      q.putLockbox.run(userId, 'personal_recovery', personal.lockbox, now());
      db.prepare('UPDATE users SET recovery_auth_hash = ? WHERE id = ?').run(hashSecret(personal.authKey), userId);
    }
    if (mode === 'admin' && adminLockbox) q.putLockbox.run(userId, 'admin_recovery', adminLockbox, now());
    if (mode === 'self') q.dropLockbox.run(userId, 'admin_recovery');
  }

  app.post('/api/auth/recovery', async (req) => {
    const user = requireReady(req);
    const body = parse(api.recoveryChangeRequest, req.body);
    checkCurrentKey(user, body.currentLoginKey);
    validateRecovery(user, body.recoveryMode, body.personalRecovery, body.adminLockbox, true);
    transaction(db, () => applyRecovery(user.id, body.recoveryMode, body.personalRecovery, body.adminLockbox));
    return sessionView(q.userById.get(user.id) as unknown as UserRow);
  });

  function checkRecoveryKey(username: string, authKey: string): UserRow {
    const key = `recovery:${username}`;
    checkThrottle(key);
    const user = q.userByName.get(username) as UserRow | undefined;
    const lockbox = user ? q.lockbox.get(user.id, 'personal_recovery') : undefined;
    if (!user || user.disabled || !lockbox || !verifySecret(authKey, user.recovery_auth_hash)) {
      q.addFailure.run(key, now());
      throw new HttpError(401, 'wrong_recovery_key', 'That username and recovery key do not match.');
    }
    q.clearFailures.run(key);
    return user;
  }

  app.post('/api/auth/recovery/start', authLimit, async (req) => {
    const body = parse(api.recoveryStartRequest, req.body);
    const user = checkRecoveryKey(body.username, body.recoveryAuthKey);
    const lb = q.lockbox.get(user.id, 'personal_recovery') as { data: string };
    return { lockbox: lb.data };
  });

  app.post('/api/auth/recovery/complete', authLimit, async (req, reply) => {
    const body = parse(api.recoveryCompleteRequest, req.body);
    const user = checkRecoveryKey(body.username, body.recoveryAuthKey);
    transaction(db, () => {
      db.prepare('UPDATE users SET login_key_hash = ?, kdf_salt = ?, kdf_ops = ?, kdf_mem = ?, must_change_password = 0 WHERE id = ?').run(
        hashSecret(body.loginKey),
        body.salt,
        body.kdf.ops,
        body.kdf.mem,
        user.id,
      );
      q.putLockbox.run(user.id, 'password', body.passwordLockbox, now());
      q.deleteAllSessions.run(user.id);
    });
    startSession(reply, user.id);
    return sessionView(q.userById.get(user.id) as unknown as UserRow);
  });

  // ---------- Records ----------

  app.get('/api/records', async (req) => {
    const user = requireReady(req);
    const since = Math.max(0, Number((req.query as { since?: string }).since ?? 0) || 0);
    const rows = q.records.all(user.id, since) as unknown as RecordRow[];
    const records = rows.map(toStored);
    return { records, cursor: records.length ? records[records.length - 1]!.seq : since };
  });

  app.post('/api/records/batch', async (req, reply) => {
    const user = requireReady(req);
    const { changes } = parse(api.batchRequest, req.body);
    const ids = new Set<string>();
    for (const c of changes) {
      if (ids.has(c.id)) throw new HttpError(400, 'invalid_request', `Record ${c.id} appears twice in one batch.`);
      ids.add(c.id);
    }
    const conflicts: api.StoredRecord[] = [];
    const written: api.StoredRecord[] = [];
    try {
      transaction(db, () => {
        for (const c of changes) {
          const existing = q.record.get(user.id, c.id) as RecordRow | undefined;
          const currentVersion = existing?.version ?? 0;
          if (currentVersion !== c.baseVersion || (existing && 'type' in c && existing.type !== c.type)) {
            if (existing) conflicts.push(toStored(existing));
            else conflicts.push({ id: c.id, type: 'type' in c ? c.type : 'entry', version: 0, seq: 0, deleted: true, nonce: null, ciphertext: null, updatedAt: '' });
            continue;
          }
          const { seq } = q.nextSeq.get(user.id) as { seq: number };
          const ts = now();
          if ('delete' in c) q.deleteRecord.run(seq, ts, user.id, c.id);
          else if (existing) q.updateRecord.run(seq, c.nonce, c.ciphertext, ts, user.id, c.id);
          else q.insertRecord.run(user.id, c.id, c.type, seq, c.nonce, c.ciphertext, ts);
          written.push(toStored(q.record.get(user.id, c.id) as unknown as RecordRow));
        }
        if (conflicts.length) throw new HttpError(409, 'conflict', 'Changed on another device.', { conflicts });
      });
    } catch (err) {
      if (err instanceof HttpError && err.code === 'conflict') return reply.status(409).send({ error: 'conflict', message: err.message, conflicts });
      throw err;
    }
    return { records: written, cursor: written.length ? written[written.length - 1]!.seq : 0 };
  });

  // ---------- Dollar rates ----------

  app.get('/api/rates', async (req) => {
    requireUser(req);
    const rows = q.rates.all() as { date: string; usd_to_bdt: number; source: string }[];
    return { rates: rows.map((r) => ({ date: r.date, usdToBdt: r.usd_to_bdt, source: r.source })) };
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not_found', message: 'Not found.' }));

  return app;
}

/** Used by the admin tool and tests. */
export function newUserId(): string {
  return randomUUID();
}
