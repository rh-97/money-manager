import { cryptoReady } from '@mm/shared';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db.ts';
import { scheduleRates } from './rates.ts';

const config = loadConfig();
await cryptoReady();
const db = openDatabase(config.dbPath);
const app = buildApp(db, config);
const stopRates = config.fetchRates ? scheduleRates(db, app.log) : () => {};

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  stopRates();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
