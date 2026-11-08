import { ownedTestTarget, assertTestDatabase } from '../../db/__tests__/disposable-postgres.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  contentVersions,
  modelProfileVersions,
  modelProfiles,
  quotaPackages,
  scripts,
} from '../../db/schema.js';
import { seed } from '../index.js';

const describeRealPg = describe.skipIf(!process.env.DATABASE_URL);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../drizzle',
);
// Replaying the publishing migration is what a deployment (or a restore into a scratch database)
// does; the capture step it carries must stay a no-op on a database that is already bootstrapped.
const publishingMigrationSql = readFileSync(path.resolve('drizzle/0014_character_publishing.sql'), 'utf8');
// Same idea for the model profile capture of 0015: an accepted turn pins
// `model_profile_version_id` (NOT NULL), so a bootstrapped database must own one published
// version per profile.
const turnPinningMigrationSql = readFileSync(path.resolve('drizzle/0015_turn_version_pinning.sql'), 'utf8');

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

/** Derived database inside the guard-owned instance: the bootstrap order is proved on a real empty DB. */
async function createTempDatabase() {
  const { url: sourceUrl, clusterName, username } = ownedTestTarget();
  const databaseName = `web_admin_test_seed_${randomUUID().replace(/-/g, '')}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1 });
  await assertTestDatabase(admin, 'postgres', clusterName, username);
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const tempUrl = new URL(sourceUrl);
  tempUrl.pathname = `/${databaseName}`;
  const client = postgres(tempUrl.toString(), { max: 2 });
  const tempDb = drizzle(client, { schema });
  try {
    await assertTestDatabase(client, databaseName, clusterName, username);
  } catch (error) {
    await client.end();
    await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end();
    throw error;
  }
  return {
    tempDb,
    client,
    close: async () => {
      await client.end();
      await assertTestDatabase(admin, 'postgres', clusterName, username);
      await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      await admin.end();
    },
  };
}

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
    const { tempDb, client, close } = await createTempDatabase();

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
      await close();
    }
  }, 30000); // Isolated migration + full seed can exceed 5s under concurrent scrypt/PG suites.

  it('captures every seeded character as its first published version on a fresh database', async () => {
    const { tempDb, client, close } = await createTempDatabase();

    try {
      // Documented bootstrap order for an empty database: api-migrate then api-seed.
      await migrate(tempDb, { migrationsFolder });
      await seed(tempDb);

      const rows = await tempDb
        .select({ character: characters, prompt: characterPrompts, script: scripts, version: contentVersions })
        .from(characters)
        .innerJoin(contentVersions, eq(contentVersions.id, characters.publishedVersionId))
        .leftJoin(characterPrompts, eq(characterPrompts.characterId, characters.id))
        .leftJoin(scripts, eq(scripts.id, characters.scriptId));
      expect(rows).toHaveLength(19);

      // Every seeded character is readable by the pinned pointer the chat runtime will use: one
      // published version, capturing exactly the live fields, with no inventor author.
      for (const { character, prompt, script, version } of rows) {
        expect(version, character.name).toMatchObject({
          entityType: 'character',
          entityId: character.id,
          versionNo: 1,
          status: 'published',
          createdBy: null,
          createdByAdminAccountId: null,
        });
        expect(version.publishedAt).toBeInstanceOf(Date);
        expect(version.payload).toEqual({
          name: character.name,
          avatarUrl: character.avatarUrl,
          identity: character.identity,
          description: character.description,
          scriptId: character.scriptId,
          initialRelationship: character.initialRelationship,
          agentId: character.agentId ?? '',
          starterQuestions: character.starterQuestions,
          prompt: {
            systemPrompt: prompt?.systemPrompt ?? '',
            personalityPrompt: prompt?.personalityPrompt ?? '',
            scenarioPrompt: prompt?.scenarioPrompt ?? '',
            safetyPrompt: prompt?.safetyPrompt ?? '',
            outputFormatPrompt: prompt?.outputFormatPrompt ?? '',
          },
          sortOrder: character.sortOrder,
          scriptSnapshot: script ? { title: script.title, worldSetting: script.worldSetting } : null,
        });
      }

      const [counts] = await client.unsafe(`
        SELECT
          (SELECT count(*) FROM characters)::int AS characters,
          (SELECT count(*) FROM characters WHERE published_version_id IS NULL)::int AS pointerless,
          (SELECT count(*) FROM content_versions WHERE entity_type = 'character')::int AS versions,
          (SELECT count(*) FROM content_versions WHERE entity_type = 'character' AND status = 'published')::int AS published,
          (SELECT count(*) FROM content_versions v
             WHERE v.entity_type = 'character' AND v.status = 'published'
               AND v.content_hash <> encode(sha256(convert_to(v.payload::text, 'UTF8')), 'hex'))::int AS wrong_hash
      `);
      expect(counts).toMatchObject({ characters: 19, pointerless: 0, versions: 19, published: 19, wrong_hash: 0 });

      // A second, independent bootstrap cycle (own empty database, migrate then seed) reaches the
      // same state, so the capture does not depend on anything left behind by the first one.
      const secondCycle = await createTempDatabase();
      try {
        await migrate(secondCycle.tempDb, { migrationsFolder });
        await seed(secondCycle.tempDb);
        const [secondCounts] = await secondCycle.client.unsafe(`
          SELECT
            (SELECT count(*) FROM characters)::int AS characters,
            (SELECT count(*) FROM characters WHERE published_version_id IS NULL)::int AS pointerless,
            (SELECT count(*) FROM content_versions WHERE entity_type = 'character')::int AS versions,
            (SELECT count(*) FROM content_versions WHERE entity_type = 'character' AND status = 'published')::int AS published,
            (SELECT count(*) FROM content_versions v
               WHERE v.entity_type = 'character' AND v.status = 'published'
                 AND v.content_hash <> encode(sha256(convert_to(v.payload::text, 'UTF8')), 'hex'))::int AS wrong_hash
        `);
        expect(secondCounts).toEqual(counts);
      } finally {
        await secondCycle.close();
      }

      // Re-running the bootstrap pieces on the bootstrapped database is stable: the migration is a
      // no-op, replaying its capture block and re-running the capture unit add nothing, and
      // api-seed refuses rather than rewriting managed content.
      const characterState = `SELECT id, published_version_id, name, status FROM characters ORDER BY id`;
      const versionState = `SELECT id, entity_id, version_no, status, content_hash, payload, created_by
                              FROM content_versions ORDER BY entity_id, version_no`;
      const before = { characters: await client.unsafe(characterState), versions: await client.unsafe(versionState) };

      await migrate(tempDb, { migrationsFolder });
      await client.unsafe(publishingMigrationSql);
      await tempDb.transaction(async (tx) => {
        const { captureExistingCharacterContent } = await import('../../modules/admin/character-capture.js');
        await captureExistingCharacterContent(tx);
      });
      expect(await client.unsafe(characterState)).toEqual(before.characters);
      expect(await client.unsafe(versionState)).toEqual(before.versions);

      await expect(seed(tempDb)).rejects.toThrow('api-seed refused');
      expect(await client.unsafe(characterState)).toEqual(before.characters);
      expect(await client.unsafe(versionState)).toEqual(before.versions);
    } finally {
      await close();
    }
  }, 30000);

  it('captures one published model profile version per profile and never touches an admin chain', async () => {
    const { tempDb, client, close } = await createTempDatabase();

    try {
      await migrate(tempDb, { migrationsFolder });
      await seed(tempDb);

      // Every seeded profile owns exactly one published version equal to its live config, so a
      // chat turn can pin it on a database that never went through an admin model edit.
      const [counts] = await client.unsafe(`
        SELECT
          (SELECT count(*) FROM model_profiles)::int AS profiles,
          (SELECT count(*) FROM model_profile_versions WHERE status = 'published')::int AS published,
          (SELECT count(*) FROM model_profiles p WHERE NOT EXISTS (
             SELECT 1 FROM model_profile_versions v WHERE v.profile_id = p.id))::int AS versionless,
          (SELECT count(*) FROM model_profile_versions v JOIN model_profiles p ON p.id = v.profile_id
             WHERE v.provider <> p.provider OR v.model_name <> p.model_name
                OR v.points_per_call <> p.points_per_call)::int AS drifted,
          (SELECT count(*) FROM model_profile_versions WHERE created_by IS NOT NULL
                OR created_by_admin_account_id IS NOT NULL)::int AS authored
      `);
      expect(counts).toMatchObject({ profiles: 3, published: 3, versionless: 0, drifted: 0, authored: 0 });

      // The migration carries the capture unit verbatim (no drifting implementations).
      const { CAPTURE_EXISTING_MODEL_PROFILE_VERSION_STATEMENTS } = await import('../../modules/admin/model-capture.js');
      const migration = normalizeSql(turnPinningMigrationSql);
      for (const statement of CAPTURE_EXISTING_MODEL_PROFILE_VERSION_STATEMENTS) {
        expect(migration).toContain(normalizeSql(statement));
      }

      // Operator-created profile without versions (the deployed state 0015 has to tame): replaying
      // the migration captures it once, and an existing admin version chain is never extended.
      const [operatorProfile] = await tempDb.insert(modelProfiles).values({
        tier: 'standard',
        modelName: 'operator-model',
        provider: 'operator',
        enabled: false,
        pointsPerCall: 9,
        displayName: 'Operator',
      }).onConflictDoNothing().returning();
      const profileId = operatorProfile?.id ?? (await tempDb
        .select({ id: modelProfiles.id })
        .from(modelProfiles)
        .where(eq(modelProfiles.tier, 'standard')))[0]!.id;
      await client.unsafe('DELETE FROM model_profile_versions WHERE profile_id = $1'.replace('$1', `'${profileId}'`));
      await client.unsafe(turnPinningMigrationSql);
      const captured = await tempDb
        .select()
        .from(modelProfileVersions)
        .where(eq(modelProfileVersions.profileId, profileId));
      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatchObject({
        versionNo: 1,
        status: 'published',
        provider: 'siliconflow',
        modelName: 'deepseek-ai/DeepSeek-V4-Flash',
        pointsPerCall: 3,
        createdBy: null,
        createdByAdminAccountId: null,
      });

      // An admin-published version is operator evidence: a second replay adds nothing.
      await tempDb.insert(modelProfileVersions).values({
        profileId,
        versionNo: 2,
        status: 'published',
        provider: 'operator',
        modelName: 'operator-model',
        pointsPerCall: 9,
        runtimeParams: {},
        configHash: 'operator-hash',
        publishedAt: new Date(),
      });
      await client.unsafe(turnPinningMigrationSql);
      expect(await tempDb
        .select()
        .from(modelProfileVersions)
        .where(eq(modelProfileVersions.profileId, profileId))).toHaveLength(2);
    } finally {
      await close();
    }
  }, 30000);
});

afterAll(async () => {
  if (process.env.DATABASE_URL) {
    await closeDb();
  }
});
