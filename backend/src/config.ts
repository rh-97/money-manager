import { join } from 'node:path';

export interface Config {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  /** Session cookies are marked Secure (HTTPS only) outside development. */
  secureCookies: boolean;
  /** Fetch the daily USD to BDT rate. Off in tests. */
  fetchRates: boolean;
  /** Trust X-Forwarded-For from the local nginx proxy. */
  trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = (env.MM_ENV ?? 'production') as Config['env'];
  const dataDir = env.MM_DATA_DIR ?? join(process.cwd(), 'data');
  return {
    env: mode,
    host: env.MM_HOST ?? '127.0.0.1',
    port: Number(env.MM_PORT ?? 8787),
    dataDir,
    dbPath: env.MM_DB_PATH ?? join(dataDir, 'money-manager.db'),
    secureCookies: mode === 'production',
    fetchRates: env.MM_RATES !== 'off' && mode !== 'test',
    trustProxy: mode === 'production',
  };
}
