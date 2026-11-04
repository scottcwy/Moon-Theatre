import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { count, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import {
  blockedKeywords,
  characterPrompts,
  characters,
  modelProfiles,
  quotaPackages,
  scripts,
} from '../../db/schema.js';
import { seed } from '../index.js';

const describeRealPg = describe.skipIf(!process.env.DATABASE_URL);

describeRealPg('seed bootstrap safety real PostgreSQL', () => {
  it('refuses to overwrite a database that already contains managed content', async () => {
    const scriptId = randomUUID();
    const originalTitle = `Operator content ${randomUUID()}`;
    await db.insert(scripts).values({
      id: scriptId,
      title: originalTitle,
      description: 'operator managed',
      worldSetting: 'operator managed',
      slug: `operator-${randomUUID()}`,
      genre: 'operator',
    });

    try {
      await expect(seed()).rejects.toThrow('api-seed refused');
      const [row] = await db.select().from(scripts).where(eq(scripts.id, scriptId));
      expect(row?.title).toBe(originalTitle);
    } finally {
      await db.delete(scripts).where(eq(scripts.id, scriptId));
    }
  });

  it('rolls back every bootstrap write when a later seed step fails', async () => {
    const sourceUrl = new URL(process.env.DATABASE_URL!);
    const databaseName = `codex_seed_atomic_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const adminUrl = new URL(sourceUrl);
    adminUrl.pathname = '/postgres';
    const admin = postgres(adminUrl.toString(), { max: 1 });
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);

    const tempUrl = new URL(sourceUrl);
    tempUrl.pathname = `/${databaseName}`;
    const client = postgres(tempUrl.toString(), { max: 2 });
    const tempDb = drizzle(client, { schema });
    const migrationsFolder = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../drizzle',
    );

    try {
      await migrate(tempDb, { migrationsFolder });
      await tempDb.insert(modelProfiles).values({
        tier: 'standard',
        modelName: 'operator-only-model',
        provider: 'operator',
        enabled: false,
        pointsPerCall: 99,
        displayName: 'Operator',
      });
      await expect(seed(tempDb)).rejects.toThrow('api-seed refused');
      await tempDb.delete(modelProfiles).where(eq(modelProfiles.tier, 'standard'));

      const triggerFunction = `fail_seed_${Date.now()}`;
      await tempDb.execute(sql.raw(`
        CREATE FUNCTION "${triggerFunction}"() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected seed failure'; END $$;
        CREATE TRIGGER "${triggerFunction}" BEFORE INSERT ON model_profiles
        FOR EACH ROW EXECUTE FUNCTION "${triggerFunction}"();
      `));

      await expect(seed(tempDb)).rejects.toThrow('injected seed failure');
      const countsAfterFailure = await Promise.all([
        tempDb.select({ value: count() }).from(scripts),
        tempDb.select({ value: count() }).from(characters),
        tempDb.select({ value: count() }).from(characterPrompts),
        tempDb.select({ value: count() }).from(modelProfiles),
        tempDb.select({ value: count() }).from(quotaPackages),
        tempDb.select({ value: count() }).from(blockedKeywords),
      ]);
      expect(countsAfterFailure.map(([row]) => row?.value)).toEqual([0, 0, 0, 0, 0, 0]);

      await tempDb.execute(sql.raw(`
        DROP TRIGGER "${triggerFunction}" ON model_profiles;
        DROP FUNCTION "${triggerFunction}"();
      `));
      await seed(tempDb);
      const [scriptCount] = await tempDb.select({ value: count() }).from(scripts);
      const [characterCount] = await tempDb.select({ value: count() }).from(characters);
      expect(scriptCount?.value).toBe(3);
      expect(characterCount?.value).toBe(19);
    } finally {
      await client.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  });
});

afterAll(async () => {
  if (process.env.DATABASE_URL) {
    await closeDb();
  }
});
