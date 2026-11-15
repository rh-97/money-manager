import { describe, expect, it } from 'vitest';
import { FREE_TRIES, isValidPin, nextFails, pinWaitMs } from './pin.ts';

describe('Accounts PIN tries', () => {
  it('lets the first five wrong tries through, then waits longer each time, up to 15 minutes', () => {
    expect(pinWaitMs(FREE_TRIES - 1)).toBe(0);
    expect(pinWaitMs(FREE_TRIES)).toBe(30_000);
    expect(pinWaitMs(FREE_TRIES + 1)).toBe(60_000);
    expect(pinWaitMs(FREE_TRIES + 3)).toBe(240_000);
    expect(pinWaitMs(FREE_TRIES + 20)).toBe(15 * 60_000);
  });

  it('counts wrong tries and sets the wait from the time of the try', () => {
    let f = { count: 0, until: 0 };
    for (let i = 0; i < FREE_TRIES - 1; i++) f = nextFails(f, 1000);
    expect(f).toEqual({ count: FREE_TRIES - 1, until: 0 });
    f = nextFails(f, 1000);
    expect(f).toEqual({ count: FREE_TRIES, until: 31_000 });
  });

  it('accepts 4 to 8 digits only', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('123456789')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('12 34')).toBe(false);
  });
});
