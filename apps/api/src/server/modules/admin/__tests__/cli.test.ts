import { Readable } from 'node:stream';
import { expect, it } from 'vitest';
import { parseAdminCliArgs, readAdminSecretStdin } from '../../../admin-cli.js';
it('CLI validates explicit selectors and rejects password argv, unknown/duplicate options', () => {
  expect(parseAdminCliArgs(['bootstrap', '--email', ' ADMIN@example.test ', '--password-stdin'])).toEqual({ mode: 'bootstrap', email: 'admin@example.test', passwordStdin: true });
  expect(parseAdminCliArgs(['recover', '--account-id', '00000000-0000-4000-8000-000000000001', '--password-stdin']).mode).toBe('recover');
  for (const args of [[], ['bootstrap'], ['delete'], ['bootstrap', '--email', 'invalid'], ['bootstrap', '--email', 'admin@example.test', '--password', 'secret'], ['recover', '--account-id', 'not-uuid'], ['bootstrap', '--email', 'admin@example.test', '--email', 'b@example.test']])
    expect(() => parseAdminCliArgs(args)).toThrow();
});
it('bounded stdin removes framing newline only, preserving real spaces and Unicode', async () => {
  expect(await readAdminSecretStdin(Readable.from(['  Amber river lanterns 847!  \r\n']))).toBe('  Amber river lanterns 847!  ');
  expect(await readAdminSecretStdin(Readable.from(['🦊'.repeat(15) + '\n']))).toBe('🦊'.repeat(15));
  await expect(readAdminSecretStdin(Readable.from([]))).rejects.toThrow();
  await expect(readAdminSecretStdin(Readable.from(['a'.repeat(2048)]))).rejects.toThrow();
});
