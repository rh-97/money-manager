/**
 * Admin operations (spec 2.1 and 3.3). Used by the command-line tool and tests.
 * These run on the server itself, never through the web API.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync } from 'node:fs';
import {
  ADMIN_KDF,
  DEFAULT_KDF,
  api,
  deriveAdminKeyPair,
  derivePasswordKeys,
  newSalt,
  openAdminLockbox,
  sealForAdmin,
  sealLockbox,
  toB64,
  type KdfParams,
} from '@mm/shared';
import { type DB, now, transaction } from '../db.ts';
import { hashSecret } from '../secrets.ts';
import { newUserId } from '../app.ts';

export class AdminError extends Error {}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: string;
  disabled: number;
  setup_done: number;
  recovery_mode: string | null;
  last_login_at: string | null;
}

/** A one-time password that is easy to read out: 3 groups of 4 (no 0/O or 1/I/L). */
export function oneTimePassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out.match(/.{4}/g)!.join('-');
}

function getUser(db: DB, username: string): UserRow {
  const parsed = api.username.safeParse(username);
  if (!parsed.success) throw new AdminError(`"${username}" is not a valid username.`);
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(parsed.data) as UserRow | undefined;
  if (!user) throw new AdminError(`No user called "${parsed.data}".`);
  return user;
}

export function createUser(db: DB, opts: { username: string; displayName?: string; admin?: boolean; kdf?: KdfParams }): { username: string; password: string } {
  const parsed = api.username.safeParse(opts.username);
  if (!parsed.success) throw new AdminError(parsed.error.issues[0]?.message ?? 'Invalid username');
  const username = parsed.data;
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new AdminError(`The username "${username}" is already taken.`);
  const password = oneTimePassword();
  const kdf = opts.kdf ?? DEFAULT_KDF;
  const salt = newSalt();
  const { loginKey } = derivePasswordKeys(password, salt, kdf);
  db.prepare(
    `INSERT INTO users (id, username, display_name, role, must_change_password, setup_done, login_key_hash, kdf_salt, kdf_ops, kdf_mem, created_at)
     VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?)`,
  ).run(newUserId(), username, opts.displayName?.trim() || username, opts.admin ? 'admin' : 'user', hashSecret(loginKey), salt, kdf.ops, kdf.mem, now());
  return { username, password };
}

export function setUserDisabled(db: DB, username: string, disabled: boolean): void {
  const user = getUser(db, username);
  transaction(db, () => {
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, user.id);
    if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  });
}

export function deleteUser(db: DB, username: string): void {
  const user = getUser(db, username);
  const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number };
  if (user.role === 'admin' && admins.n <= 1) throw new AdminError('This is the last admin account, so it cannot be deleted.');
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
}

export function listUsers(db: DB): UserRow[] {
  return db.prepare('SELECT username, display_name, role, disabled, setup_done, recovery_mode, last_login_at FROM users ORDER BY username').all() as unknown as UserRow[];
}

export function adminRecoveryInfo(db: DB): { publicKey: string; salt: string; kdf: KdfParams } | null {
  const row = db.prepare('SELECT public_key, salt, kdf_ops, kdf_mem FROM admin_recovery WHERE id = 1').get() as
    | { public_key: string; salt: string; kdf_ops: number; kdf_mem: number }
    | undefined;
  return row ? { publicKey: row.public_key, salt: row.salt, kdf: { ops: row.kdf_ops, mem: row.kdf_mem } } : null;
}

export const MIN_PHRASE_LENGTH = 16;

/**
 * Sets (or changes) the admin recovery phrase. Only the public half is stored.
 * When changing, every existing admin lockbox is re-locked with the new key, so
 * nobody loses admin recovery.
 */
export function setupAdminRecovery(db: DB, newPhrase: string, oldPhrase?: string, kdf: KdfParams = ADMIN_KDF): { relocked: number } {
  if (newPhrase.trim().length < MIN_PHRASE_LENGTH) throw new AdminError(`Use a phrase of at least ${MIN_PHRASE_LENGTH} characters (a few unrelated words works well).`);
  const existing = adminRecoveryInfo(db);
  let oldPair: ReturnType<typeof deriveAdminKeyPair> | null = null;
  if (existing) {
    if (!oldPhrase) throw new AdminError('Admin recovery is already set up. The current phrase is needed to change it.');
    oldPair = deriveAdminKeyPair(oldPhrase, existing.salt, existing.kdf);
    if (toB64(oldPair.publicKey) !== existing.publicKey) throw new AdminError('The current admin recovery phrase is not correct.');
  }
  const salt = newSalt();
  const newPair = deriveAdminKeyPair(newPhrase, salt, kdf);
  const newPublic = toB64(newPair.publicKey);
  let relocked = 0;
  transaction(db, () => {
    if (oldPair) {
      const boxes = db.prepare("SELECT user_id, data FROM lockboxes WHERE kind = 'admin_recovery'").all() as { user_id: string; data: string }[];
      for (const box of boxes) {
        const dataKey = openAdminLockbox(box.data, oldPair);
        db.prepare("UPDATE lockboxes SET data = ?, created_at = ? WHERE user_id = ? AND kind = 'admin_recovery'").run(sealForAdmin(dataKey, newPublic), now(), box.user_id);
        relocked += 1;
      }
    }
    db.prepare(
      'INSERT INTO admin_recovery (id, public_key, salt, kdf_ops, kdf_mem, created_at) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET public_key = excluded.public_key, salt = excluded.salt, kdf_ops = excluded.kdf_ops, kdf_mem = excluded.kdf_mem, created_at = excluded.created_at',
    ).run(newPublic, salt, kdf.ops, kdf.mem, now());
  });
  return { relocked };
}

/**
 * Restores access for a user who chose admin recovery: opens their admin lockbox
 * with the phrase, then locks the same data key with a new temporary password.
 * No data is lost. The user must choose a new password at next login.
 */
export function recoverUser(db: DB, username: string, phrase: string, kdf: KdfParams = DEFAULT_KDF): { password: string } {
  const user = getUser(db, username);
  if (user.recovery_mode !== 'admin') throw new AdminError(`${user.username} chose "only I can recover". They need their personal recovery key.`);
  const info = adminRecoveryInfo(db);
  if (!info) throw new AdminError('Admin recovery has not been set up.');
  const box = db.prepare("SELECT data FROM lockboxes WHERE user_id = ? AND kind = 'admin_recovery'").get(user.id) as { data: string } | undefined;
  if (!box) throw new AdminError(`${user.username} has no admin recovery lockbox.`);
  const pair = deriveAdminKeyPair(phrase, info.salt, info.kdf);
  if (toB64(pair.publicKey) !== info.publicKey) throw new AdminError('The admin recovery phrase is not correct.');
  const dataKey = openAdminLockbox(box.data, pair);
  const password = oneTimePassword();
  const salt = newSalt();
  const keys = derivePasswordKeys(password, salt, kdf);
  transaction(db, () => {
    db.prepare('UPDATE users SET login_key_hash = ?, kdf_salt = ?, kdf_ops = ?, kdf_mem = ?, must_change_password = 1 WHERE id = ?').run(
      hashSecret(keys.loginKey),
      salt,
      kdf.ops,
      kdf.mem,
      user.id,
    );
    db.prepare("UPDATE lockboxes SET data = ?, created_at = ? WHERE user_id = ? AND kind = 'password'").run(sealLockbox(dataKey, keys.unlockKey, 'password'), now(), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM login_failures WHERE key = ?').run(`user:${user.username}`);
  });
  return { password };
}

/** A consistent copy of the live database (safe while the server runs). */
export function backupDatabase(db: DB, target: string): void {
  if (existsSync(target)) throw new AdminError(`${target} already exists.`);
  db.prepare('VACUUM INTO ?').run(target);
}

/** Replaces the database file. The server must be stopped first. */
export function restoreDatabase(source: string, dbPath: string): void {
  if (!existsSync(source)) throw new AdminError(`${source} does not exist.`);
  copyFileSync(source, dbPath);
}
