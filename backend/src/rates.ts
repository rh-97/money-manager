import type { FastifyBaseLogger } from 'fastify';
import { type DB, now } from './db.ts';

/**
 * Daily USD to BDT rate (spec 9.1). Public market data only: no account, no key,
 * no personal data is sent. The first source that answers wins.
 */
const SOURCES: { name: string; url: string; pick: (json: unknown) => number | undefined }[] = [
  {
    name: 'exchangerate-api.com (open)',
    url: 'https://open.er-api.com/v6/latest/USD',
    pick: (j) => (j as { rates?: { BDT?: number } }).rates?.BDT,
  },
  {
    name: 'fawazahmed0 currency-api',
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    pick: (j) => (j as { usd?: { bdt?: number } }).usd?.bdt,
  },
];

/** Today's date in Bangladesh (YYYY-MM-DD). */
export function dhakaDate(at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(at);
}

export async function fetchTodayRate(db: DB, log: FastifyBaseLogger, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  for (const source of SOURCES) {
    try {
      const res = await fetchImpl(source.url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rate = source.pick(await res.json());
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 50 || rate > 500) throw new Error(`implausible rate ${rate}`);
      db.prepare(
        'INSERT INTO exchange_rates (date, usd_to_bdt, source, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT (date) DO UPDATE SET usd_to_bdt = excluded.usd_to_bdt, source = excluded.source, fetched_at = excluded.fetched_at',
      ).run(dhakaDate(), Math.round(rate * 10000) / 10000, source.name, now());
      log.info({ rate, source: source.name }, 'dollar rate updated');
      return true;
    } catch (err) {
      log.warn({ err: (err as Error).message, source: source.name }, 'dollar rate source failed');
    }
  }
  return false;
}

/** Fetch now, then every 6 hours. Returns a function that stops the schedule. */
export function scheduleRates(db: DB, log: FastifyBaseLogger): () => void {
  void fetchTodayRate(db, log);
  const timer = setInterval(() => void fetchTodayRate(db, log), 6 * 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
