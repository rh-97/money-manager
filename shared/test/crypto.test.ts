import { beforeAll, describe, expect, it } from 'vitest';
import {
  cryptoReady,
  decryptRecord,
  deriveAdminKeyPair,
  derivePasswordKeys,
  deriveRecoveryKeys,
  encryptRecord,
  generateRecoveryKey,
  newDataKey,
  newSalt,
  normalizeRecoveryKey,
  openAdminLockbox,
  openLockbox,
  randomId,
  derivedId,
  sealForAdmin,
  sealLockbox,
  toB64,
  WrongKeyError,
  type KdfParams,
} from '../src/crypto.ts';

// Light parameters keep the test suite fast; production uses DEFAULT_KDF / ADMIN_KDF.
const FAST: KdfParams = { ops: 2, mem: 16 * 1024 * 1024 };

beforeAll(async () => {
  await cryptoReady();
});

describe('password keys', () => {
  it('is deterministic for the same password and salt', () => {
    const salt = newSalt();
    const a = derivePasswordKeys('correct horse', salt, FAST);
    const b = derivePasswordKeys('correct horse', salt, FAST);
    expect(a.loginKey).toBe(b.loginKey);
    expect(toB64(a.unlockKey)).toBe(toB64(b.unlockKey));
  });

  it('gives a login key that is different from the unlock key', () => {
    const k = derivePasswordKeys('correct horse', newSalt(), FAST);
    expect(k.loginKey).not.toBe(toB64(k.unlockKey));
    expect(k.loginKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it('changes completely with a different salt or password', () => {
    const salt = newSalt();
    const base = derivePasswordKeys('correct horse', salt, FAST).loginKey;
    expect(derivePasswordKeys('correct horse', newSalt(), FAST).loginKey).not.toBe(base);
    expect(derivePasswordKeys('correct horsf', salt, FAST).loginKey).not.toBe(base);
  });

  it('treats visually identical Unicode passwords the same (NFKC)', () => {
    const salt = newSalt();
    const composed = derivePasswordKeys('café', salt, FAST).loginKey;
    const decomposed = derivePasswordKeys('café', salt, FAST).loginKey;
    expect(composed).toBe(decomposed);
  });
});

describe('lockboxes', () => {
  it('round-trips the data key with the right unlock key', () => {
    const dataKey = newDataKey();
    const { unlockKey } = derivePasswordKeys('pw', newSalt(), FAST);
    const box = sealLockbox(dataKey, unlockKey, 'password');
    expect(toB64(openLockbox(box, unlockKey, 'password'))).toBe(toB64(dataKey));
  });

  it('refuses a wrong password', () => {
    const salt = newSalt();
    const box = sealLockbox(newDataKey(), derivePasswordKeys('right', salt, FAST).unlockKey, 'password');
    expect(() => openLockbox(box, derivePasswordKeys('wrong', salt, FAST).unlockKey, 'password')).toThrow(WrongKeyError);
  });

  it('refuses a lockbox used as the wrong kind', () => {
    const key = derivePasswordKeys('pw', newSalt(), FAST).unlockKey;
    const box = sealLockbox(newDataKey(), key, 'password');
    expect(() => openLockbox(box, key, 'personal_recovery')).toThrow(WrongKeyError);
  });

  it('survives a password change without re-encrypting data', () => {
    const dataKey = newDataKey();
    const record = encryptRecord(dataKey, randomId(), 'entry', { amount: 1250 });
    const newKey = derivePasswordKeys('new password', newSalt(), FAST).unlockKey;
    const reopened = openLockbox(sealLockbox(dataKey, newKey, 'password'), newKey, 'password');
    expect(reopened).toEqual(dataKey);
    expect(record.ciphertext.length).toBeGreaterThan(0);
  });
});

describe('personal recovery key', () => {
  it('has 8 groups of 4 characters', () => {
    expect(generateRecoveryKey()).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('accepts sloppy typing: lowercase, spaces, O for 0, l for 1', () => {
    const key = generateRecoveryKey();
    const sloppy = key.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    expect(normalizeRecoveryKey(sloppy)).toBe(key.replace(/-/g, ''));
    expect(deriveRecoveryKeys(sloppy).authKey).toBe(deriveRecoveryKeys(key).authKey);
  });

  it('opens the recovery lockbox and recovers the data key', () => {
    const dataKey = newDataKey();
    const key = generateRecoveryKey();
    const box = sealLockbox(dataKey, deriveRecoveryKeys(key).unlockKey, 'personal_recovery');
    expect(openLockbox(box, deriveRecoveryKeys(key).unlockKey, 'personal_recovery')).toEqual(dataKey);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => normalizeRecoveryKey('ABCD-EFGH')).toThrow(WrongKeyError);
  });

  it('gives different auth and unlock keys', () => {
    const k = deriveRecoveryKeys(generateRecoveryKey());
    expect(k.authKey).not.toBe(toB64(k.unlockKey));
  });
});

describe('admin recovery', () => {
  it('lets the admin phrase open a lockbox sealed with only the public key', () => {
    const salt = newSalt();
    const pair = deriveAdminKeyPair('a long admin phrase', salt, FAST);
    const dataKey = newDataKey();
    const box = sealForAdmin(dataKey, toB64(pair.publicKey));
    const again = deriveAdminKeyPair('a long admin phrase', salt, FAST);
    expect(openAdminLockbox(box, again)).toEqual(dataKey);
  });

  it('refuses the wrong admin phrase', () => {
    const salt = newSalt();
    const pair = deriveAdminKeyPair('right phrase', salt, FAST);
    const box = sealForAdmin(newDataKey(), toB64(pair.publicKey));
    expect(() => openAdminLockbox(box, deriveAdminKeyPair('wrong phrase', salt, FAST))).toThrow(WrongKeyError);
  });
});

describe('derived ids', () => {
  it('is stable per data key and label, and different across users', () => {
    const a = newDataKey();
    expect(derivedId(a, 'settings')).toBe(derivedId(a, 'settings'));
    expect(derivedId(a, 'settings')).not.toBe(derivedId(a, 'category:0'));
    expect(derivedId(a, 'settings')).not.toBe(derivedId(newDataKey(), 'settings'));
    expect(derivedId(a, 'settings')).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('records', () => {
  it('round-trips a record', () => {
    const dataKey = newDataKey();
    const id = randomId();
    const value = { type: 'expense', amount: 125000, note: 'Groceries, Shwapno ৳' };
    const enc = encryptRecord(dataKey, id, 'entry', value);
    expect(decryptRecord(dataKey, id, 'entry', enc)).toEqual(value);
  });

  it('never contains the plaintext', () => {
    const enc = encryptRecord(newDataKey(), randomId(), 'entry', { note: 'Shoes, Bata', amount: 350000 });
    const blob = JSON.stringify(enc);
    expect(blob).not.toContain('Shoes');
    expect(blob).not.toContain('350000');
  });

  it('uses a fresh nonce each time', () => {
    const dataKey = newDataKey();
    const id = randomId();
    const a = encryptRecord(dataKey, id, 'entry', { x: 1 });
    const b = encryptRecord(dataKey, id, 'entry', { x: 1 });
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('refuses a record moved to another id or type', () => {
    const dataKey = newDataKey();
    const id = randomId();
    const enc = encryptRecord(dataKey, id, 'entry', { x: 1 });
    expect(() => decryptRecord(dataKey, randomId(), 'entry', enc)).toThrow(WrongKeyError);
    expect(() => decryptRecord(dataKey, id, 'account', enc)).toThrow(WrongKeyError);
  });

  it('refuses another user\'s data key', () => {
    const id = randomId();
    const enc = encryptRecord(newDataKey(), id, 'entry', { x: 1 });
    expect(() => decryptRecord(newDataKey(), id, 'entry', enc)).toThrow(WrongKeyError);
  });

  it('detects tampering', () => {
    const dataKey = newDataKey();
    const id = randomId();
    const enc = encryptRecord(dataKey, id, 'entry', { x: 1 });
    const flipped = enc.ciphertext.startsWith('A') ? 'B' + enc.ciphertext.slice(1) : 'A' + enc.ciphertext.slice(1);
    expect(() => decryptRecord(dataKey, id, 'entry', { ...enc, ciphertext: flipped })).toThrow(WrongKeyError);
  });
});
