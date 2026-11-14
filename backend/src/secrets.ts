import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Hashes a login key or recovery auth key for storage.
 * The inputs are already 256-bit keys derived with Argon2id in the browser, so
 * scrypt here is defence in depth: a leaked database still cannot be used to log in.
 */
const N = 2 ** 14;
const R = 8;
const P = 1;

export function hashSecret(secretB64: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(Buffer.from(secretB64, 'base64'), salt, 32, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifySecret(secretB64: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(Buffer.from(secretB64, 'base64'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
