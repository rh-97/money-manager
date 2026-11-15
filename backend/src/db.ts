import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

export type DB = DatabaseSync;

/**
 * Schema migrations, applied in order. Never edit a released migration;
 * add a new one instead.
 */
const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    disabled INTEGER NOT NULL DEFAULT 0,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    setup_done INTEGER NOT NULL DEFAULT 0,
    login_key_hash TEXT NOT NULL,
    kdf_salt TEXT NOT NULL,
    kdf_ops INTEGER NOT NULL,
    kdf_mem INTEGER NOT NULL,
    recovery_mode TEXT CHECK (recovery_mode IN ('admin', 'self')),
    recovery_auth_hash TEXT,
    seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE lockboxes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('password', 'personal_recovery', 'admin_recovery')),
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, kind)
  );
  CREATE TABLE records (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    version INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    nonce TEXT,
    ciphertext TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX records_by_seq ON records (user_id, seq);
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE admin_recovery (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    public_key TEXT NOT NULL,
    salt TEXT NOT NULL,
    kdf_ops INTEGER NOT NULL,
    kdf_mem INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE exchange_rates (
    date TEXT PRIMARY KEY,
    usd_to_bdt REAL NOT NULL,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );
  CREATE TABLE login_failures (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    last_at TEXT NOT NULL
  );
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 2: "stay unlocked on this device": the server's half of a short-lived device key
  `
  ALTER TABLE sessions ADD COLUMN unlock_key TEXT;
  ALTER TABLE sessions ADD COLUMN unlock_expires_at TEXT;
  `,
];

export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version]!);
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
    });
    version += 1;
  }
}

/** Runs fn inside a transaction; rolls back if it throws. */
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** A random secret kept in the database, used to make fake salts for unknown usernames. */
export function serverSecret(db: DB): Buffer {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'server_secret'").get() as { value: string } | undefined;
  if (row) return Buffer.from(row.value, 'base64');
  const secret = randomBytes(32);
  db.prepare("INSERT INTO meta (key, value) VALUES ('server_secret', ?)").run(secret.toString('base64'));
  return secret;
}

export const now = (): string => new Date().toISOString();
