import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../http/error-types.js';

const PREFIX = 'scrypt$v1$32768$8$1';
const COMMON_PASSWORDS = new Set(['correct horse battery staple', 'thisisapassword', 'iloveyouiloveyou', 'welcome123456789', 'letmeinletmein123']);
const OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
// A valid cost/salt/output, deliberately not a usable account credential.
export const DUMMY_PASSWORD_HASH = `${PREFIX}$${'00'.repeat(16)}$${'00'.repeat(64)}`;
let inFlight = 0;

export function validateAdminPassword(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 512 || COMMON_PASSWORDS.has(value.toLowerCase()) || [...value].length < 15 || [...value].length > 128 ||
      /^(password|admin|changeme|change-me|qwerty|letmein|123456)/i.test(value) ||
      /^\d+$/.test(value) || /^\s+$/.test(value) || (/^[\x00-\x7f]+$/.test(value) && new Set(value.toLowerCase()).size < 5)) {
    throw new HttpError('admin_password_invalid', 400);
  }
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (inFlight >= 4) throw new HttpError('admin_password_capacity', 503);
  inFlight++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, OPTIONS, (error, key) => error ? reject(error) : resolve(key));
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError('admin_password_unavailable', 503);
  } finally { inFlight--; }
}

export async function hashAdminPassword(password: string): Promise<string> {
  validateAdminPassword(password);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${PREFIX}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyAdminPassword(password: string, stored: string): Promise<boolean> {
  // Only the exact supported format is accepted, never attacker-selected cost parameters.
  if (typeof password !== 'string' || [...password].length > 128 ||
      !/^scrypt\$v1\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(stored)) return false;
  const fields = stored.split('$');
  const key = await derive(password, Buffer.from(fields[5]!, 'hex'));
  return timingSafeEqual(key, Buffer.from(fields[6]!, 'hex'));
}
