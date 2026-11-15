/**
 * End-to-end encryption for Money Manager (spec section 3).
 *
 * Used by the browser (all encryption and decryption) and by the backend's admin
 * tool (create-user, recover-user, setup-recovery). The server API never decrypts.
 *
 * Building blocks (libsodium):
 *  - Argon2id (crypto_pwhash) turns a password into a master key.
 *  - BLAKE2b KDF splits it into a login key (sent to the server) and an unlock key
 *    (never leaves the device).
 *  - XChaCha20-Poly1305 encrypts records and the password/recovery lockboxes.
 *  - Sealed boxes (X25519) let browsers lock the admin recovery lockbox with the
 *    admin's public key, without being able to open it.
 */
import _sodium from 'libsodium-wrappers-sumo';

type Sodium = typeof _sodium;
let sodium: Sodium | null = null;

/** Must be awaited once before any other function in this module. */
export async function cryptoReady(): Promise<void> {
  if (sodium) return;
  await _sodium.ready;
  sodium = _sodium;
}

function s(): Sodium {
  if (!sodium) throw new Error('cryptoReady() has not been awaited');
  return sodium;
}

export class WrongKeyError extends Error {
  constructor(message = 'Wrong password or key') {
    super(message);
    this.name = 'WrongKeyError';
  }
}

// ---------- Encoding ----------

export function toB64(bytes: Uint8Array): string {
  return s().to_base64(bytes, s().base64_variants.ORIGINAL);
}
export function fromB64(text: string): Uint8Array {
  return s().from_base64(text, s().base64_variants.ORIGINAL);
}
export function randomId(): string {
  return s().to_hex(s().randombytes_buf(16));
}

/**
 * A stable record id derived from the data key and a label, for records that must
 * exist only once per user (default categories, settings). Two devices creating
 * them at the same time get the same ids, so the second save is a harmless conflict.
 */
export function derivedId(dataKey: Uint8Array, label: string): string {
  return s().to_hex(s().crypto_generichash(16, s().from_string(`mm-id-v1:${label}`), dataKey));
}

// ---------- Password to keys ----------

export interface KdfParams {
  /** Argon2id passes (opslimit). */
  ops: number;
  /** Argon2id memory in bytes (memlimit). */
  mem: number;
}

/** Interactive-grade Argon2id: roughly 0.3 to 1 s on a mid-range phone. */
export const DEFAULT_KDF: KdfParams = { ops: 3, mem: 64 * 1024 * 1024 };
/** Stronger settings for the admin recovery phrase (only ever run by the admin tool). */
export const ADMIN_KDF: KdfParams = { ops: 4, mem: 256 * 1024 * 1024 };

export function newSalt(): string {
  return toB64(s().randombytes_buf(s().crypto_pwhash_SALTBYTES));
}

export interface PasswordKeys {
  /** Base64. Sent to the server to prove who you are; the server stores only a hash of it. */
  loginKey: string;
  /** Opens the password lockbox. Never leaves the device. */
  unlockKey: Uint8Array;
}

export function deriveMasterKey(secret: string, saltB64: string, kdf: KdfParams): Uint8Array {
  const so = s();
  return so.crypto_pwhash(32, secret.normalize('NFKC'), fromB64(saltB64), kdf.ops, kdf.mem, so.crypto_pwhash_ALG_ARGON2ID13);
}

export function derivePasswordKeys(password: string, saltB64: string, kdf: KdfParams): PasswordKeys {
  const so = s();
  const master = deriveMasterKey(password, saltB64, kdf);
  const loginKey = so.crypto_kdf_derive_from_key(32, 1, 'mmlogin_', master);
  const unlockKey = so.crypto_kdf_derive_from_key(32, 2, 'mmunlock', master);
  so.memzero(master);
  return { loginKey: toB64(loginKey), unlockKey };
}

// ---------- Data key and lockboxes ----------

export type LockboxKind = 'password' | 'personal_recovery' | 'device';

export function newDataKey(): Uint8Array {
  return s().crypto_aead_xchacha20poly1305_ietf_keygen();
}

const LOCKBOX_VERSION = 'v1';

/** Encrypts the data key with a symmetric key (password or recovery unlock key). */
export function sealLockbox(dataKey: Uint8Array, unlockKey: Uint8Array, kind: LockboxKind): string {
  const so = s();
  const nonce = so.randombytes_buf(so.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const box = so.crypto_aead_xchacha20poly1305_ietf_encrypt(dataKey, `mm-lockbox-v1:${kind}`, null, nonce, unlockKey);
  return `${LOCKBOX_VERSION}.${toB64(nonce)}.${toB64(box)}`;
}

export function openLockbox(lockbox: string, unlockKey: Uint8Array, kind: LockboxKind): Uint8Array {
  const so = s();
  const [version, nonce, box] = lockbox.split('.');
  if (version !== LOCKBOX_VERSION || !nonce || !box) throw new Error('Unknown lockbox format');
  try {
    return so.crypto_aead_xchacha20poly1305_ietf_decrypt(null, fromB64(box), `mm-lockbox-v1:${kind}`, fromB64(nonce), unlockKey);
  } catch {
    throw new WrongKeyError();
  }
}

// ---------- Personal recovery key ----------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_BYTES = 20; // 160 bits = 32 base32 characters

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of text) {
    const idx = CROCKFORD.indexOf(ch);
    if (idx < 0) throw new WrongKeyError('That recovery key has a character that does not belong in it');
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A new recovery key, formatted for writing down: 8 groups of 4 characters. */
export function generateRecoveryKey(): string {
  const chars = base32Encode(s().randombytes_buf(RECOVERY_BYTES));
  return (chars.match(/.{4}/g) ?? []).join('-');
}

/** Accepts the key with or without dashes or spaces, in any case, and forgives O/0 and I/L/1 mix-ups. */
export function normalizeRecoveryKey(input: string): string {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (cleaned.length !== 32) throw new WrongKeyError('A recovery key has 32 characters');
  return cleaned;
}

export interface RecoveryKeys {
  /** Base64. Proves knowledge of the recovery key to the server, which stores only a hash. */
  authKey: string;
  /** Opens the personal recovery lockbox. Never leaves the device. */
  unlockKey: Uint8Array;
}

export function deriveRecoveryKeys(recoveryKey: string): RecoveryKeys {
  const so = s();
  const raw = base32Decode(normalizeRecoveryKey(recoveryKey)).slice(0, RECOVERY_BYTES);
  // The key is already 160 random bits, so a fast keyed hash is enough (no Argon2 needed).
  const master = so.crypto_generichash(32, raw, so.from_string('mm-recovery-key-v1'));
  const authKey = so.crypto_kdf_derive_from_key(32, 1, 'mmrecaut', master);
  const unlockKey = so.crypto_kdf_derive_from_key(32, 2, 'mmrecunl', master);
  so.memzero(master);
  return { authKey: toB64(authKey), unlockKey };
}

// ---------- Admin recovery (sealed boxes) ----------

export interface AdminKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/** Recreates the admin key pair from the admin recovery phrase. The private half is never stored. */
export function deriveAdminKeyPair(phrase: string, saltB64: string, kdf: KdfParams = ADMIN_KDF): AdminKeyPair {
  const so = s();
  const seed = deriveMasterKey(phrase, saltB64, kdf);
  const pair = so.crypto_box_seed_keypair(seed);
  so.memzero(seed);
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

/** Locks the data key so only the admin recovery phrase can open it. Runs in the browser. */
export function sealForAdmin(dataKey: Uint8Array, adminPublicKeyB64: string): string {
  return toB64(s().crypto_box_seal(dataKey, fromB64(adminPublicKeyB64)));
}

export function openAdminLockbox(lockboxB64: string, pair: AdminKeyPair): Uint8Array {
  try {
    return s().crypto_box_seal_open(fromB64(lockboxB64), pair.publicKey, pair.privateKey);
  } catch {
    throw new WrongKeyError('The admin recovery phrase does not open this lockbox');
  }
}

// ---------- Records ----------

export interface EncryptedPayload {
  nonce: string;
  ciphertext: string;
}

/** Binds the ciphertext to its record id and type, so the server cannot swap records around. */
function recordAd(id: string, type: string): string {
  return `mm-record-v1:${type}:${id}`;
}

export function encryptRecord(dataKey: Uint8Array, id: string, type: string, value: unknown): EncryptedPayload {
  const so = s();
  const nonce = so.randombytes_buf(so.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = so.crypto_aead_xchacha20poly1305_ietf_encrypt(JSON.stringify(value), recordAd(id, type), null, nonce, dataKey);
  return { nonce: toB64(nonce), ciphertext: toB64(ciphertext) };
}

export function decryptRecord<T = unknown>(dataKey: Uint8Array, id: string, type: string, payload: EncryptedPayload): T {
  const so = s();
  try {
    const plain = so.crypto_aead_xchacha20poly1305_ietf_decrypt(null, fromB64(payload.ciphertext), recordAd(id, type), fromB64(payload.nonce), dataKey);
    return JSON.parse(so.to_string(plain)) as T;
  } catch {
    throw new WrongKeyError('A record could not be decrypted');
  }
}
