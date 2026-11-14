/**
 * Login, unlock, first-time setup, password change and recovery (spec 3.2, 3.3, 5).
 * The password only ever leaves the device as a derived login key.
 */
import {
  api,
  DEFAULT_KDF,
  derivePasswordKeys,
  deriveRecoveryKeys,
  generateRecoveryKey,
  newDataKey,
  newSalt,
  openLockbox,
  sealForAdmin,
  sealLockbox,
  type PasswordKeys,
} from '@mm/shared';
import { call, nextPaint } from './api.ts';

export type Session = api.SessionResponse;

export const MIN_PASSWORD = 8;

export async function fetchSession(): Promise<Session | null> {
  try {
    return await call<Session>('GET', '/api/auth/me');
  } catch {
    return null;
  }
}

export async function login(username: string, password: string): Promise<{ session: Session; keys: PasswordKeys }> {
  const pre = await call<api.PreloginResponse>('POST', '/api/auth/prelogin', { username });
  await nextPaint();
  const keys = derivePasswordKeys(password, pre.salt, pre.kdf);
  const session = await call<Session>('POST', '/api/auth/login', { username, loginKey: keys.loginKey });
  return { session, keys };
}

/** Opens the data key with the password. Throws WrongKeyError for a wrong password. */
export async function unlock(session: Session, password: string): Promise<{ dataKey: Uint8Array; keys: PasswordKeys }> {
  await nextPaint();
  const keys = derivePasswordKeys(password, session.user.salt, session.user.kdf);
  if (!session.passwordLockbox) throw new Error('This account is not set up yet.');
  return { dataKey: openLockbox(session.passwordLockbox, keys.unlockKey, 'password'), keys };
}

export async function logout(): Promise<void> {
  await call('POST', '/api/auth/logout').catch(() => {});
}

function newPasswordMaterial(dataKey: Uint8Array, password: string) {
  const salt = newSalt();
  const keys = derivePasswordKeys(password, salt, DEFAULT_KDF);
  return { salt, kdf: DEFAULT_KDF, loginKey: keys.loginKey, passwordLockbox: sealLockbox(dataKey, keys.unlockKey, 'password'), keys };
}

function personalRecoveryMaterial(dataKey: Uint8Array) {
  const recoveryKey = generateRecoveryKey();
  const rk = deriveRecoveryKeys(recoveryKey);
  return { recoveryKey, personalRecovery: { lockbox: sealLockbox(dataKey, rk.unlockKey, 'personal_recovery'), authKey: rk.authKey } };
}

/** Steps 1 and 2 of first-time setup: own password, recovery choice, recovery key. */
export async function completeSetup(p: {
  session: Session;
  currentLoginKey: string;
  newPassword: string;
  mode: api.RecoveryMode;
}): Promise<{ session: Session; dataKey: Uint8Array; recoveryKey: string; keys: PasswordKeys }> {
  await nextPaint();
  const dataKey = newDataKey();
  const pw = newPasswordMaterial(dataKey, p.newPassword);
  const rec = personalRecoveryMaterial(dataKey);
  const adminPub = p.session.adminRecoveryPublicKey;
  const session = await call<Session>('POST', '/api/auth/setup', {
    currentLoginKey: p.currentLoginKey,
    salt: pw.salt,
    kdf: pw.kdf,
    loginKey: pw.loginKey,
    passwordLockbox: pw.passwordLockbox,
    recoveryMode: p.mode,
    personalRecovery: rec.personalRecovery,
    adminLockbox: p.mode === 'admin' && adminPub ? sealForAdmin(dataKey, adminPub) : null,
  });
  return { session, dataKey, recoveryKey: rec.recoveryKey, keys: pw.keys };
}

export async function changePassword(p: { currentLoginKey: string; dataKey: Uint8Array; newPassword: string }): Promise<{ session: Session; keys: PasswordKeys }> {
  await nextPaint();
  const pw = newPasswordMaterial(p.dataKey, p.newPassword);
  const session = await call<Session>('POST', '/api/auth/password', {
    currentLoginKey: p.currentLoginKey,
    salt: pw.salt,
    kdf: pw.kdf,
    loginKey: pw.loginKey,
    passwordLockbox: pw.passwordLockbox,
  });
  return { session, keys: pw.keys };
}

/** Changes the recovery mode, optionally with a new personal recovery key. */
export async function changeRecovery(p: {
  currentLoginKey: string;
  dataKey: Uint8Array;
  mode: api.RecoveryMode;
  newKey: boolean;
  adminPub: string | null;
}): Promise<{ session: Session; recoveryKey: string | null }> {
  const rec = p.newKey ? personalRecoveryMaterial(p.dataKey) : null;
  const session = await call<Session>('POST', '/api/auth/recovery', {
    currentLoginKey: p.currentLoginKey,
    recoveryMode: p.mode,
    personalRecovery: rec?.personalRecovery ?? null,
    adminLockbox: p.mode === 'admin' && p.adminPub ? sealForAdmin(p.dataKey, p.adminPub) : null,
  });
  return { session, recoveryKey: rec?.recoveryKey ?? null };
}

/** Forgot password, step 1: check the recovery key and open the data key with it. */
export async function startRecovery(username: string, recoveryKey: string): Promise<{ dataKey: Uint8Array; authKey: string }> {
  const rk = deriveRecoveryKeys(recoveryKey);
  const res = await call<{ lockbox: string }>('POST', '/api/auth/recovery/start', { username, recoveryAuthKey: rk.authKey });
  return { dataKey: openLockbox(res.lockbox, rk.unlockKey, 'personal_recovery'), authKey: rk.authKey };
}

/** Forgot password, step 2: set the new password. Logs in. */
export async function completeRecovery(p: { username: string; authKey: string; dataKey: Uint8Array; newPassword: string }): Promise<{ session: Session; keys: PasswordKeys }> {
  await nextPaint();
  const pw = newPasswordMaterial(p.dataKey, p.newPassword);
  const session = await call<Session>('POST', '/api/auth/recovery/complete', {
    username: p.username,
    recoveryAuthKey: p.authKey,
    salt: pw.salt,
    kdf: pw.kdf,
    loginKey: pw.loginKey,
    passwordLockbox: pw.passwordLockbox,
  });
  return { session, keys: pw.keys };
}
