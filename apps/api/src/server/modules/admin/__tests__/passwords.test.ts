import { expect, it } from 'vitest';
import * as passwords from '../passwords.js';

const secret = 'Amber river lanterns 847!';
it('validates Unicode codepoints without trimming or normalization and rejects weak values', () => {
  expect(() => passwords.validateAdminPassword('🦊'.repeat(15))).not.toThrow();
  for (const value of ['short', 'a'.repeat(129), 'passwordpassword', '123456789012345', ' '.repeat(15), 'correct horse battery staple'])
    expect(() => passwords.validateAdminPassword(value)).toThrow();
  expect(() => passwords.validateAdminPassword(' '.repeat(2) + secret + ' ')).not.toThrow();
});
it('uses random versioned scrypt hashes and safely rejects unsupported/malformed costs', async () => {
  const a = await passwords.hashAdminPassword(secret), b = await passwords.hashAdminPassword(secret);
  expect(a).not.toBe(b);
  expect(a).toMatch(/^scrypt\$v1\$32768\$8\$1\$/);
  expect(await passwords.verifyAdminPassword(secret, a)).toBe(true);
  expect(await passwords.verifyAdminPassword(secret + ' ', a)).toBe(false);
  for (const hash of ['hash', a.replace('32768', '1073741824'), a + '$extra', a.replace('$8$', '$99999$')])
    expect(await passwords.verifyAdminPassword(secret, hash)).toBe(false);
  expect(await passwords.verifyAdminPassword(secret, passwords.DUMMY_PASSWORD_HASH)).toBe(false);
});
it('allows four expensive operations and rejects the fifth immediately rather than queueing', async () => {
  const pending = Array.from({ length: 4 }, () => passwords.hashAdminPassword(secret));
  await expect(passwords.verifyAdminPassword(secret, passwords.DUMMY_PASSWORD_HASH)).rejects.toMatchObject({ status: 503 });
  await Promise.all(pending);
  expect(await passwords.verifyAdminPassword(secret, passwords.DUMMY_PASSWORD_HASH)).toBe(false);
});
