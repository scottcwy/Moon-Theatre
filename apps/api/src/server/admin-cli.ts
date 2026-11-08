import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { validateAdminPassword } from './modules/admin/passwords.js';

type Args = { mode: 'bootstrap'; email: string; passwordStdin: boolean } | { mode: 'recover'; accountId: string; passwordStdin: boolean };
export function parseAdminCliArgs(args: string[]): Args {
  const [mode, flag, selector, stdin, ...extra] = args;
  if (extra.length || (stdin !== undefined && stdin !== '--password-stdin')) throw new Error('admin_cli_arguments_invalid');
  if (mode === 'bootstrap' && flag === '--email') {
    const parsed = z.string().trim().toLowerCase().email().max(254).safeParse(selector);
    if (parsed.success) return { mode, email: parsed.data, passwordStdin: stdin === '--password-stdin' };
  }
  if (mode === 'recover' && flag === '--account-id') {
    const parsed = z.string().uuid().safeParse(selector);
    if (parsed.success) return { mode, accountId: parsed.data, passwordStdin: stdin === '--password-stdin' };
  }
  throw new Error('admin_cli_arguments_invalid');
}
export async function readAdminSecretStdin(input: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 1024) throw new Error('admin_cli_secret_invalid');
    chunks.push(bytes);
  }
  const value = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  validateAdminPassword(value);
  return value;
}
async function readHiddenPassword(): Promise<string> {
  process.stderr.write('管理员密码（输入隐藏）：');
  // readline terminal editing works, but its echo goes only to this sink, never logs/terminal.
  const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const rl = createInterface({ input: process.stdin, output: sink, terminal: true });
  let length = 0;
  const bound = (chunk: Buffer | string) => { length += Buffer.byteLength(chunk); if (length > 1024) rl.close(); };
  process.stdin.on('data', bound);
  try {
    const value = await new Promise<string>((resolve, reject) => {
      rl.once('line', resolve);
      rl.once('SIGINT', () => reject(new Error('admin_cli_cancelled')));
      rl.once('close', () => reject(new Error('admin_cli_secret_invalid')));
    });
    validateAdminPassword(value);
    return value;
  } finally { rl.close(); process.stdin.off('data', bound); process.stderr.write('\n'); }
}
async function main() {
  const args = parseAdminCliArgs(process.argv.slice(2));
  if (!process.stdin.isTTY && !args.passwordStdin) throw new Error('admin_cli_password_stdin_required');
  const password = args.passwordStdin ? await readAdminSecretStdin(process.stdin) : await readHiddenPassword();
  // Application config/DB is loaded only after arguments and secret are valid.
  const { closeDb } = await import('./db/index.js');
  try {
    const { bootstrapAdminAccount, recoverAdminAccount } = await import('./modules/admin/accounts.js');
    const account = args.mode === 'bootstrap'
      ? await bootstrapAdminAccount(args.email, password)
      : await recoverAdminAccount(args.accountId, password);
    process.stdout.write(`${JSON.stringify({ id: account.id, email: account.email, active: account.active, mustChangePassword: account.mustChangePassword })}\n`);
  } finally { await closeDb(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write('admin_account_command_failed: check arguments, secret input, account state and database availability\n'); process.exitCode = 1; });
}
