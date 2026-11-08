import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../../db/schema.js';
import { assertTestDatabase, ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';

// Derived databases remain inside the guard-owned instance; never fall back or skip.
export async function accountFixture() {
  const { url, clusterName, username } = ownedTestTarget();
  const name = `web_admin_test_accounts_${randomUUID().replace(/-/g, '')}`;
  url.pathname = '/postgres';
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await assertTestDatabase(admin, 'postgres', clusterName, username);
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const client = postgres(url.toString(), { onnotice: () => {} });
  const cleanup = async () => {
    await client.end();
    await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  };
  try {
    await assertTestDatabase(client, name, clusterName, username);
    for (const file of readdirSync(path.resolve('drizzle')).filter(f => /^\d+.*\.sql$/.test(f)).sort())
      await client.unsafe(readFileSync(path.resolve('drizzle', file), 'utf8'));
    return { db: drizzle(client, { schema }), closeDb: cleanup, url: url.toString() };
  } catch (error) { await cleanup(); throw error; }
}
