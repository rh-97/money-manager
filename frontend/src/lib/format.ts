import type { Currency } from '../money/types.ts';

let grouping: 'bd' | 'intl' = 'bd';
export function setNumberFormat(f: 'bd' | 'intl'): void {
  grouping = f;
}

/** ৳1,24,500 (Bangladeshi grouping) or ৳124,500; paisa shown only when not zero. Dollars always show cents. */
export function fmtMoney(minor: number, currency: Currency = 'BDT', opts: { sign?: boolean } = {}): string {
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const locale = currency === 'BDT' && grouping === 'bd' ? 'en-IN' : 'en-US';
  const body = currency === 'USD' || cents ? (abs / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : whole.toLocaleString(locale);
  const symbol = currency === 'USD' ? '$' : '৳';
  const sign = minor < 0 ? '−' : opts.sign && minor > 0 ? '+' : '';
  return `${sign}${symbol}${body}`;
}

/** Parses "1,250.50" or "৳ 1250" into paisa/cents. Returns null if it is not a valid positive amount. */
export function parseAmount(text: string, allowNegative = false): number | null {
  const cleaned = text.replace(/[৳$,\s]/g, '').replace('−', '-');
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Math.round(Number(cleaned) * 100);
  if (!Number.isFinite(n) || (!allowNegative && n <= 0)) return null;
  return n;
}

/** Shows an amount in an input box (no symbol, no grouping). */
export const amountInputValue = (minor: number): string => (minor % 100 ? (minor / 100).toFixed(2) : String(minor / 100));

export function todayDhaka(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
}

export function fmtDate(date: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}

export function dayLabel(date: string, today: string): string {
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short', ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!)
    .slice(0, 2)
    .join('')
    .toUpperCase();
