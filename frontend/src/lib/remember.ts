/**
 * "Stay unlocked on this device" (spec 3.4).
 *
 * After unlocking, the data key is locked with a random device key and kept in
 * this browser. Only the server keeps the device key, for one hour after the
 * last use. A reload within the hour asks the server for the device key and
 * opens the data key without the password. After the hour, the copy kept here
 * can't be opened any more. The server never sees the data key.
 */
import { fromB64, openLockbox, sealLockbox } from '@mm/shared';
import { call } from './api.ts';

const STORE = 'mm-device-lock';
const TOUCH_EVERY_MS = 5 * 60 * 1000;

interface Stored {
  v: 1;
  userId: string;
  lockbox: string;
}

function read(): Stored | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Stored | null;
    return s?.v === 1 && s.userId && s.lockbox ? s : null;
  } catch {
    return null;
  }
}

function clear(): void {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* storage blocked */
  }
}

/** Keeps the data key on this device for the next hour. Failures only mean the next reload asks for the password. */
export async function rememberDevice(userId: string, dataKey: Uint8Array): Promise<void> {
  try {
    const { key } = await call<{ key: string }>('POST', '/api/auth/remember');
    localStorage.setItem(STORE, JSON.stringify({ v: 1, userId, lockbox: sealLockbox(dataKey, fromB64(key), 'device') } satisfies Stored));
  } catch {
    clear();
  }
}

/** Opens the data key kept on this device, or returns null if the password is needed. */
export async function openRememberedDevice(userId: string): Promise<Uint8Array | null> {
  const stored = read();
  if (!stored) return null;
  if (stored.userId !== userId) {
    clear();
    return null;
  }
  try {
    const { key } = await call<{ key: string }>('POST', '/api/auth/remember/open');
    return openLockbox(stored.lockbox, fromB64(key), 'device');
  } catch {
    clear();
    return null;
  }
}

/** Locks this device now: the password is needed on the next reload. */
export async function forgetDevice(): Promise<void> {
  clear();
  await call('POST', '/api/auth/remember/forget').catch(() => {});
}

/** While the app is used (taps and key presses), tells the server at most every 5 minutes, so the hour counts from the last use. */
export function keepDeviceUnlockedWhileUsed(): () => void {
  let last = Date.now();
  const onUse = () => {
    if (Date.now() - last < TOUCH_EVERY_MS || !read()) return;
    last = Date.now();
    void call<{ active: boolean }>('POST', '/api/auth/remember/touch')
      .then((r) => {
        if (!r.active) clear();
      })
      .catch(() => {});
  };
  window.addEventListener('pointerdown', onUse, { passive: true });
  window.addEventListener('keydown', onUse);
  window.addEventListener('wheel', onUse, { passive: true });
  return () => {
    window.removeEventListener('pointerdown', onUse);
    window.removeEventListener('keydown', onUse);
    window.removeEventListener('wheel', onUse);
  };
}
