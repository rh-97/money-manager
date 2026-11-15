/**
 * Accounts PIN: wrong-try limits (spec section 3.5).
 *
 * The first 5 wrong tries in a row are free. After that, each wrong try makes the
 * next one wait: 30 seconds, then 1, 2, 4… minutes, up to 15 minutes. The count is
 * kept on this device (so reloading doesn't reset it) and cleared by the right PIN
 * or by the password.
 */

export const PIN_MIN = 4;
export const PIN_MAX = 8;
export const FREE_TRIES = 5;
const MAX_WAIT_MS = 15 * 60_000;
const KEY = 'mm-pin-fails';

export interface PinFails {
  count: number;
  /** Epoch ms before which no try is allowed (0 = no wait). */
  until: number;
}

/** How long to wait after `count` wrong tries in a row. */
export function pinWaitMs(count: number): number {
  if (count < FREE_TRIES) return 0;
  return Math.min(30_000 * 2 ** (count - FREE_TRIES), MAX_WAIT_MS);
}

/** The state after one more wrong try at time `now`. */
export function nextFails(prev: PinFails, now: number): PinFails {
  const count = prev.count + 1;
  const wait = pinWaitMs(count);
  return { count, until: wait ? now + wait : 0 };
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^[0-9]{${PIN_MIN},${PIN_MAX}}$`).test(pin);
}

export function loadFails(): PinFails {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as PinFails | null;
    if (v && typeof v.count === 'number' && typeof v.until === 'number') return v;
  } catch {
    /* storage blocked or unreadable */
  }
  return { count: 0, until: 0 };
}

export function storeFails(f: PinFails): void {
  try {
    if (f.count === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* storage blocked: the limit then lasts until the page reloads */
  }
}
