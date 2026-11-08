import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/juben_sha';

// Next dev re-evaluates server modules on every hot reload. A plain module-level `postgres()` would
// open a NEW pool each time and never close the previous one, so a long editing session leaks
// connections until PostgreSQL answers "too many clients already" (observed during acceptance runs).
// Caching the client on globalThis in non-production keeps one pool per process; production is
// untouched because it never hot-reloads.
const globalForDb = globalThis as unknown as { __jubenDbClient?: ReturnType<typeof postgres> };

// Only the hot-reloading dev server recycles this module; test runners and production must keep
// per-instance clients so a `closeDb()` in one suite can never hand a dead pool to another.
const cacheAcrossReloads = process.env.NODE_ENV === 'development' && !process.env.VITEST;

const client = (cacheAcrossReloads ? globalForDb.__jubenDbClient : undefined) ?? postgres(connectionString);
if (cacheAcrossReloads) {
  globalForDb.__jubenDbClient = client;
}

export const db = drizzle(client, { schema });
export type Database = typeof db;

export async function closeDb() {
  if (globalForDb.__jubenDbClient === client) {
    delete globalForDb.__jubenDbClient;
  }
  await client.end();
}
