/**
 * HTTP API contract between the frontend and the backend (spec sections 3 and 10).
 * Everything financial travels encrypted: the server only sees ids, types,
 * versions, nonces and ciphertexts.
 */
import { z } from 'zod';

// ---------- Basics ----------

export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
export const username = z
  .string()
  .trim()
  .transform((v) => v.toLowerCase())
  .refine((v) => USERNAME_RE.test(v), 'Usernames are 3 to 30 characters: letters, numbers, dot, underscore or hyphen');

/** A 32-byte key in standard base64 (44 characters). */
export const key32 = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, 'Expected a 32-byte base64 key');
export const salt = z.string().regex(/^[A-Za-z0-9+/]{22}==$/, 'Expected a 16-byte base64 salt');
export const kdfParams = z.object({
  ops: z.number().int().min(2).max(10),
  mem: z.number().int().min(16 * 1024 * 1024).max(512 * 1024 * 1024),
});
export const lockbox = z.string().min(40).max(400);
export const recoveryMode = z.enum(['admin', 'self']);
export type RecoveryMode = z.infer<typeof recoveryMode>;

// ---------- Auth ----------

export const preloginRequest = z.object({ username });
export const preloginResponse = z.object({ salt, kdf: kdfParams });
export type PreloginResponse = z.infer<typeof preloginResponse>;

export const loginRequest = z.object({ username, loginKey: key32 });

export const userView = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: z.enum(['admin', 'user']),
  mustChangePassword: z.boolean(),
  setupDone: z.boolean(),
  recoveryMode: recoveryMode.nullable(),
  hasPersonalRecovery: z.boolean(),
  salt,
  kdf: kdfParams,
});
export type UserView = z.infer<typeof userView>;

/** Returned after login and by GET /api/auth/me. */
export const sessionResponse = z.object({
  user: userView,
  /** Null until the user has finished the first-time setup. */
  passwordLockbox: lockbox.nullable(),
  /** Public half of the admin recovery key pair, or null if the admin has not set it up yet. */
  adminRecoveryPublicKey: key32.nullable(),
});
export type SessionResponse = z.infer<typeof sessionResponse>;

/** First-time setup: replaces the one-time password and creates the lockboxes. */
export const setupRequest = z.object({
  currentLoginKey: key32,
  salt,
  kdf: kdfParams,
  loginKey: key32,
  passwordLockbox: lockbox,
  recoveryMode,
  personalRecovery: z.object({ lockbox, authKey: key32 }).nullable(),
  adminLockbox: z.string().min(40).max(400).nullable(),
});

/** Change password (also used to replace a temporary password after admin recovery). */
export const passwordChangeRequest = z.object({
  currentLoginKey: key32,
  salt,
  kdf: kdfParams,
  loginKey: key32,
  passwordLockbox: lockbox,
});

/** Change recovery settings while logged in. */
export const recoveryChangeRequest = z.object({
  currentLoginKey: key32,
  recoveryMode,
  /** A new personal recovery key, or null to keep the current one (or none). */
  personalRecovery: z.object({ lockbox, authKey: key32 }).nullable(),
  /** Required when recoveryMode is "admin". */
  adminLockbox: z.string().min(40).max(400).nullable(),
});

/** Forgot password: prove the recovery key, receive the recovery lockbox. */
export const recoveryStartRequest = z.object({ username, recoveryAuthKey: key32 });
export const recoveryStartResponse = z.object({ lockbox });
export const recoveryCompleteRequest = z.object({
  username,
  recoveryAuthKey: key32,
  salt,
  kdf: kdfParams,
  loginKey: key32,
  passwordLockbox: lockbox,
});

// ---------- Records ----------

export const RECORD_TYPES = ['account', 'category', 'entry', 'settings'] as const;
export const recordType = z.enum(RECORD_TYPES);
export type RecordType = z.infer<typeof recordType>;

export const recordId = z.string().regex(/^[a-f0-9]{32}$/, 'Expected a 32-character hex id');
const b64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);

export const storedRecord = z.object({
  id: recordId,
  type: recordType,
  version: z.number().int().min(1),
  /** Server sequence number; increases on every write across the user's records. */
  seq: z.number().int(),
  deleted: z.boolean(),
  nonce: b64.nullable(),
  ciphertext: b64.nullable(),
  updatedAt: z.string(),
});
export type StoredRecord = z.infer<typeof storedRecord>;

export const recordsResponse = z.object({ records: z.array(storedRecord), cursor: z.number().int() });
export type RecordsResponse = z.infer<typeof recordsResponse>;

export const recordPut = z.object({
  id: recordId,
  type: recordType,
  /** 0 when creating; otherwise the version this change was based on. */
  baseVersion: z.number().int().min(0),
  nonce: b64.max(64),
  ciphertext: b64.max(256 * 1024),
});
export const recordDelete = z.object({ id: recordId, baseVersion: z.number().int().min(1), delete: z.literal(true) });
export const recordChange = z.union([recordDelete, recordPut]);
export type RecordChange = z.infer<typeof recordChange>;

/** All changes in a batch are applied together, or none are. */
export const batchRequest = z.object({ changes: z.array(recordChange).min(1).max(500) });
export const batchResponse = z.object({ records: z.array(storedRecord), cursor: z.number().int() });
/** 409 response: the current server copies of the records that conflicted. */
export const conflictResponse = z.object({ error: z.literal('conflict'), conflicts: z.array(storedRecord) });
export type ConflictResponse = z.infer<typeof conflictResponse>;

// ---------- Dollar rates ----------

export const rateRow = z.object({ date: z.string(), usdToBdt: z.number(), source: z.string() });
export type RateRow = z.infer<typeof rateRow>;
export const ratesResponse = z.object({ rates: z.array(rateRow) });

// ---------- Errors ----------

export const errorResponse = z.object({ error: z.string(), message: z.string() });
export type ErrorResponse = z.infer<typeof errorResponse>;
