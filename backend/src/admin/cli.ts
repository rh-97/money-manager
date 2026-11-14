/**
 * Money Manager admin tool (spec 2.1). Runs on the server, never over the web.
 *
 *   npm run admin -- <command> [options]          (development)
 *   node dist/admin/cli.mjs <command> [options]   (production container)
 */
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { cryptoReady } from '@mm/shared';
import { loadConfig } from '../config.ts';
import { openDatabase } from '../db.ts';
import {
  AdminError,
  MIN_PHRASE_LENGTH,
  adminRecoveryInfo,
  backupDatabase,
  createUser,
  deleteUser,
  listUsers,
  recoverUser,
  restoreDatabase,
  setUserDisabled,
  setupAdminRecovery,
} from './ops.ts';

const HELP = `Money Manager admin tool

Commands:
  create-user <username> [--display-name "Name"] [--admin]
                         Create a login. Prints a one-time password.
  recover-user <username>
                         Give a user who chose admin recovery a temporary password.
                         Asks for the admin recovery phrase. No data is lost.
  setup-recovery         Set or change the admin recovery phrase.
  disable <username>     Block a user from logging in (and log them out).
  enable <username>      Allow a disabled user to log in again.
  delete-user <username> Erase a user and all their data. Asks for confirmation.
  list-users             Usernames, recovery mode and last login. Never financial data.
  backup [file]          Write a consistent copy of the database.
  restore <file>         Replace the database with a backup (stop the server first).
`;

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.startsWith(question)) write(s);
      else if (s.includes('\n') || s.includes('\r')) write('\n');
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    console.log(HELP);
    return;
  }
  await cryptoReady();
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const name = args.find((a) => !a.startsWith('--'));

  switch (command) {
    case 'create-user': {
      if (!name) throw new AdminError('Usage: create-user <username> [--display-name "Name"] [--admin]');
      const { username, password } = createUser(db, { username: name, displayName: flag(args, '--display-name'), admin: args.includes('--admin') });
      console.log(`\nCreated "${username}".\nOne-time password: ${password}\n\nGive this to ${username}. At first login they choose their own password.`);
      if (!adminRecoveryInfo(db)) console.log('Note: admin recovery is not set up yet (run setup-recovery), so they can only choose "only I can recover".');
      break;
    }
    case 'setup-recovery': {
      const existing = adminRecoveryInfo(db);
      const oldPhrase = existing ? await ask('Current admin recovery phrase: ', true) : undefined;
      console.log(`Choose a phrase of at least ${MIN_PHRASE_LENGTH} characters. Store it safely, e.g. printed and locked away.`);
      console.log('If it is lost, admin recovery stops working for everyone who relies on it.');
      const phrase = await ask('New admin recovery phrase: ', true);
      const again = await ask('Type it again: ', true);
      if (phrase !== again) throw new AdminError('The two phrases do not match. Nothing was changed.');
      console.log('Working (this takes a few seconds on purpose)...');
      const { relocked } = setupAdminRecovery(db, phrase, oldPhrase);
      console.log(existing ? `Admin recovery phrase changed. Re-locked ${relocked} user(s).` : 'Admin recovery is set up.');
      break;
    }
    case 'recover-user': {
      if (!name) throw new AdminError('Usage: recover-user <username>');
      const phrase = await ask('Admin recovery phrase: ', true);
      console.log('Working...');
      const { password } = recoverUser(db, name, phrase);
      console.log(`\nTemporary password for ${name}: ${password}\nThey must choose a new password when they log in. Their data is intact.`);
      break;
    }
    case 'disable':
    case 'enable': {
      if (!name) throw new AdminError(`Usage: ${command} <username>`);
      setUserDisabled(db, name, command === 'disable');
      console.log(`${name} is now ${command === 'disable' ? 'disabled' : 'enabled'}.`);
      break;
    }
    case 'delete-user': {
      if (!name) throw new AdminError('Usage: delete-user <username>');
      const confirm = await ask(`This erases ${name} and all their data permanently. Type the username to confirm: `);
      if (confirm.trim().toLowerCase() !== name.toLowerCase()) throw new AdminError('Not confirmed. Nothing was deleted.');
      deleteUser(db, name);
      console.log(`${name} was deleted.`);
      break;
    }
    case 'list-users': {
      const rows = listUsers(db);
      if (!rows.length) console.log('No users yet. Create one with create-user.');
      for (const u of rows) {
        const state = u.disabled ? 'disabled' : u.setup_done ? 'active' : 'awaiting first login';
        console.log(`${u.username.padEnd(20)} ${u.role.padEnd(6)} ${state.padEnd(20)} recovery: ${(u.recovery_mode ?? '-').padEnd(6)} last login: ${u.last_login_at ?? 'never'}`);
      }
      break;
    }
    case 'backup': {
      const target = name ?? join(config.dataDir, 'backups', `money-manager-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
      backupDatabase(db, target);
      console.log(`Backup written to ${target}`);
      break;
    }
    case 'restore': {
      if (!name) throw new AdminError('Usage: restore <file>');
      const confirm = await ask('The server must be stopped. This replaces ALL current data. Type "restore" to continue: ');
      if (confirm.trim() !== 'restore') throw new AdminError('Not confirmed. Nothing was changed.');
      db.close();
      restoreDatabase(name, config.dbPath);
      rmSync(`${config.dbPath}-wal`, { force: true });
      rmSync(`${config.dbPath}-shm`, { force: true });
      console.log('Restored. Start the server again.');
      return;
    }
    default:
      throw new AdminError(`Unknown command "${command}".\n\n${HELP}`);
  }
  db.close();
}

main().catch((err: unknown) => {
  console.error(err instanceof AdminError ? `Error: ${err.message}` : err);
  process.exit(1);
});
