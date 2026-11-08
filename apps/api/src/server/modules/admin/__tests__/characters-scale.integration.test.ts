import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import { closeDb, db } from '../../../db/index.js';
import {
  adminAccounts,
  characters,
  chatSessions,
  contentVersions,
  publishTasks,
  scripts,
  users,
} from '../../../db/schema.js';
import { ADMIN_CHARACTER_STATUS_INVALID, listAdminCharacters } from '../characters.js';
import { listSessions } from '../sessions.js';

// Fail closed: this suite writes through the ambient db, so refuse any target that is not the
// guard-verified disposable instance (running vitest directly must not touch another database).
beforeAll(() => { ownedTestTarget(); });

/**
 * AC-18 baseline scale (1000 characters). The suite is deliberately blunt: it seeds the whole
 * baseline with bulk inserts, then asserts the list is a *page* — bounded rows, a real count, working
 * search, and a statement count that does not grow with the table or with the page size.
 *
 * Statement counting technique: `vi.spyOn` on the drizzle entry points this service can use
 * (`db.select`, `db.selectDistinctOn`). Every statement the service issues starts at one of them, so
 * the spy is a faithful counter without `pg_stat_statements` (not installed on the disposable
 * instance) and without patching the driver.
 *
 * Rows carry a per-run token and the highest `sort_order`, so this suite's 1000 rows never push
 * another suite's small fixture off its first page.
 */
const token = randomUUID().slice(0, 8);
const literalToken = randomUUID().slice(0, 8);
const SEEDED = 1000;
const BASE_SORT = 90000;

type SeedState = {
  ids: string[];
  scriptId: string;
  scriptBound: string[];
  published: { id: string; versionId: string };
  publishedClean: { id: string; versionId: string };
  draftOnly: { id: string; versionId: string };
  literal: { name: string; decoyName: string };
  sessionUserId: string;
  sessionCharacterId: string;
  adminAccountId: string;
};

const seed = {} as SeedState;

function payloadOf(name: string, agentId: string) {
  return {
    name,
    avatarUrl: 'https://cdn.example.test/batch.png',
    identity: '批量身份',
    description: '批量简介',
    initialRelationship: '初识',
    agentId,
    scriptId: null,
    sortOrder: BASE_SORT,
    starterQuestions: { script: [], free: ['你好'] },
    prompt: {
      systemPrompt: '你是批量角色',
      personalityPrompt: '性格',
      scenarioPrompt: '场景',
      safetyPrompt: '安全',
      outputFormatPrompt: '格式',
    },
  };
}

async function insertVersion(adminAccountId: string, input: {
  characterId: string; versionNo: number; status: 'draft' | 'published' | 'superseded'; payload: unknown;
}) {
  const id = randomUUID();
  await db.insert(contentVersions).values({
    id,
    entityType: 'character',
    entityId: input.characterId,
    versionNo: input.versionNo,
    status: input.status,
    contentHash: id.replace(/-/g, ''),
    payload: input.payload,
    // Authored through the console, like any admin version: exactly one creator column.
    createdByAdminAccountId: adminAccountId,
  });
  return id;
}

beforeAll(async () => {
  const scriptId = randomUUID();
  await db.insert(scripts).values({
    id: scriptId,
    title: `批量剧本${token}`,
    description: '批量剧本简介',
    worldSetting: '批量世界观',
    slug: `batch-${token}`,
    genre: '古风',
    status: 'active',
  });

  const adminAccountId = randomUUID();
  await db.insert(adminAccounts).values({ id: adminAccountId, email: `${adminAccountId}@example.test`, passwordHash: 'hash' });
  // Registered as soon as it exists: a failure later in this hook must not leak the 1000 rows.
  seed.scriptId = scriptId;
  seed.adminAccountId = adminAccountId;

  // The baseline: 1000 characters in one round trip.
  const ids: string[] = [];
  const rows: Array<typeof characters.$inferInsert> = [];
  for (let index = 0; index < SEEDED; index += 1) {
    const id = randomUUID();
    ids.push(id);
    rows.push({
      id,
      name: `批量角色${index}${token}`,
      avatarUrl: 'https://cdn.example.test/batch.png',
      identity: '批量身份',
      description: '批量简介',
      initialRelationship: '初识',
      agentId: `role-batch${token}${index}`,
      sortOrder: BASE_SORT + index,
      status: 'inactive',
    });
  }
  await db.insert(characters).values(rows);
  seed.ids = ids;

  // Script-title search target: three seeded characters share one bound script.
  const scriptBound = ids.slice(0, 3);
  await db.update(characters).set({ scriptId }).where(inArray(characters.id, scriptBound));

  // A literal `%_` name plus a decoy that a naive (unescaped) pattern would also match. Both carry a
  // separate token so the baseline search above still counts exactly the 1000 rows.
  const literalName = `百分%_${literalToken}`;
  const decoyName = `百分XX${literalToken}`;
  const literalId = randomUUID();
  const decoyId = randomUUID();
  await db.insert(characters).values([
    {
      id: literalId,
      name: literalName,
      avatarUrl: 'https://cdn.example.test/batch.png',
      identity: '批量身份',
      description: '批量简介',
      initialRelationship: '初识',
      agentId: `role-literal${literalToken}`,
      sortOrder: BASE_SORT + SEEDED + 1,
      status: 'inactive',
    },
    {
      id: decoyId,
      name: decoyName,
      avatarUrl: 'https://cdn.example.test/batch.png',
      identity: '批量身份',
      description: '批量简介',
      initialRelationship: '初识',
      agentId: `role-decoy${literalToken}`,
      sortOrder: BASE_SORT + SEEDED + 2,
      status: 'inactive',
    },
  ]);
  ids.push(literalId, decoyId);
  seed.ids = ids;

  // Three per-row states on three live characters: published + newer draft, published only, draft
  // only. One character also gets two publish tasks, so "the last task" is a real selection.
  const published = { id: ids[SEEDED - 3]!, versionId: '' };
  const publishedClean = { id: ids[SEEDED - 2]!, versionId: '' };
  const draftOnly = { id: ids[SEEDED - 1]!, versionId: '' };

  const publishedPayload = payloadOf(`批量角色${SEEDED - 3}${token}`, `role-batch${token}${SEEDED - 3}`);
  published.versionId = await insertVersion(adminAccountId, { characterId: published.id, versionNo: 1, status: 'published', payload: publishedPayload });
  await insertVersion(adminAccountId, {
    characterId: published.id,
    versionNo: 2,
    status: 'draft',
    payload: { ...publishedPayload, name: `批量角色改名${token}` },
  });
  await db.update(characters).set({ status: 'active', publishedVersionId: published.versionId }).where(eq(characters.id, published.id));

  publishedClean.versionId = await insertVersion(adminAccountId, {
    characterId: publishedClean.id,
    versionNo: 1,
    status: 'published',
    payload: payloadOf(`批量角色${SEEDED - 2}${token}`, `role-batch${token}${SEEDED - 2}`),
  });
  await db.update(characters).set({ status: 'active', publishedVersionId: publishedClean.versionId }).where(eq(characters.id, publishedClean.id));

  draftOnly.versionId = await insertVersion(adminAccountId, {
    characterId: draftOnly.id,
    versionNo: 1,
    status: 'draft',
    payload: payloadOf(`批量角色${SEEDED - 1}${token}`, `role-batch${token}${SEEDED - 1}`),
  });

  for (const index of [0, 1]) {
    await db.insert(publishTasks).values({
      id: randomUUID(),
      idempotencyKey: `batch-${token}-${index}`,
      entityType: 'character',
      entityId: published.id,
      versionId: published.versionId,
      status: 'committed',
      desiredHash: 'a'.repeat(64),
      appliedHash: 'a'.repeat(64),
      createdByAdminAccountId: adminAccountId,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
    });
  }

  // Session-list baseline: 1000 sessions for one character, so its bounded page is measurable too.
  const sessionUserId = randomUUID();
  await db.insert(users).values({ id: sessionUserId, openid: `batch-${token}` });
  const sessionCharacterId = ids[0]!;
  const sessionRows: Array<typeof chatSessions.$inferInsert> = [];
  for (let index = 0; index < SEEDED; index += 1) {
    sessionRows.push({
      id: randomUUID(),
      userId: sessionUserId,
      characterId: sessionCharacterId,
      mode: 'free',
      status: 'archived',
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
    });
  }
  await db.insert(chatSessions).values(sessionRows);

  Object.assign(seed, {
    scriptBound,
    published,
    publishedClean,
    draftOnly,
    literal: { name: literalName, decoyName },
    sessionUserId,
    sessionCharacterId,
    adminAccountId,
  });
});

afterAll(async () => {
  const ids = seed.ids ?? [];
  // FK order: sessions → tasks → characters → versions → script/user/account. Every step tolerates a
  // partially seeded run, so a failed fixture can never leave the 1000-row baseline behind.
  if (ids.length > 0) {
    await db.delete(chatSessions).where(inArray(chatSessions.characterId, ids));
    await db.delete(publishTasks).where(inArray(publishTasks.entityId, ids));
    await db.delete(characters).where(inArray(characters.id, ids));
    await db.delete(contentVersions).where(inArray(contentVersions.entityId, ids));
  }
  if (seed.sessionUserId) await db.delete(users).where(eq(users.id, seed.sessionUserId));
  if (seed.scriptId) await db.delete(scripts).where(eq(scripts.id, seed.scriptId));
  if (seed.adminAccountId) await db.delete(adminAccounts).where(eq(adminAccounts.id, seed.adminAccountId));
  await closeDb();
});

/** Real statement count for one service call: every statement starts at one of these two builders. */
async function statementsOf(run: () => Promise<unknown>): Promise<number> {
  const selectSpy = vi.spyOn(db, 'select');
  const distinctSpy = vi.spyOn(db, 'selectDistinctOn');
  try {
    await run();
    return selectSpy.mock.calls.length + distinctSpy.mock.calls.length;
  } finally {
    selectSpy.mockRestore();
    distinctSpy.mockRestore();
  }
}

it('pages the 1000-character baseline with a count query instead of assembling the whole table', async () => {
  const page = await listAdminCharacters({ query: token, page: 1, pageSize: 20 });

  expect(page).toMatchObject({ total: SEEDED, page: 1, pageSize: 20 });
  expect(page.items).toHaveLength(20);
  // Deterministic managed order (`sort_order, name, id`): the seeded ascending sort_order decides.
  expect(page.items.map(item => item.character.name)).toEqual(
    Array.from({ length: 20 }, (_, index) => `批量角色${index}${token}`),
  );

  const second = await listAdminCharacters({ query: token, page: 2, pageSize: 20 });
  expect(second.total).toBe(SEEDED);
  expect(second.items.map(item => item.character.name)[0]).toBe(`批量角色20${token}`);
  // Neighbouring pages never overlap.
  expect(second.items.map(item => item.character.id)).not.toContain(page.items[0]!.character.id);

  const beyond = await listAdminCharacters({ query: token, page: 51, pageSize: 20 });
  expect(beyond).toMatchObject({ total: SEEDED, page: 51 });
  expect(beyond.items).toEqual([]);

  // The page size is clamped, and the total is the count read — not the number of rendered rows.
  const clamped = await listAdminCharacters({ query: token, pageSize: 500 });
  expect(clamped).toMatchObject({ page: 1, pageSize: 100 });
  expect(clamped.items).toHaveLength(100);
});

it('completes a page with a bounded statement count, independent of the table and the page size', async () => {
  // Four statements for this page: page + count + newest version per row + last publish task per row.
  const twenty = await statementsOf(() => listAdminCharacters({ query: token, page: 1, pageSize: 20 }));
  expect(twenty).toBe(4);
  // Five rows of work per page size instead of one read per character: 100 rows cost the same 4.
  expect(await statementsOf(() => listAdminCharacters({ query: token, page: 1, pageSize: 100 }))).toBe(twenty);
  expect(await statementsOf(() => listAdminCharacters({ query: token, page: 25, pageSize: 20 }))).toBe(twenty);
  // A page that does contain published rows adds exactly one keyed read, not one per row.
  expect(await statementsOf(() => listAdminCharacters({ query: token, status: 'active' }))).toBe(5);
  // An empty page needs none of the keyed reads: two statements, still not one per character.
  expect(await statementsOf(() => listAdminCharacters({ query: `nothing-${token}` }))).toBe(2);
});

it('narrows by name, agent id and script title without losing the total', async () => {
  const byName = await listAdminCharacters({ query: `批量角色999${token}` });
  expect(byName.total).toBe(1);
  expect(byName.items.map(item => item.character.name)).toEqual([`批量角色999${token}`]);

  // Every seeded character also answers to the agent-id prefix (`role-batch<token>…`).
  expect((await listAdminCharacters({ query: `role-batch${token}` })).total).toBe(SEEDED);
  expect((await listAdminCharacters({ query: `role-batch${token}7` })).total).toBeGreaterThanOrEqual(1);

  const byScriptTitle = await listAdminCharacters({ query: `批量剧本${token}` });
  expect(byScriptTitle.total).toBe(seed.scriptBound!.length);
  expect(new Set(byScriptTitle.items.map(item => item.character.id))).toEqual(new Set(seed.scriptBound));

  // LIKE metacharacters are literal: the decoy named `百分XX…` must not match `%_`.
  const literal = await listAdminCharacters({ query: `%_${literalToken}` });
  expect(literal.total).toBe(1);
  expect(literal.items[0]!.character.name).toBe(seed.literal!.name);
  expect((await listAdminCharacters({ query: literalToken })).total).toBe(2);
});

it('combines the search with the publish status and refuses an unknown status', async () => {
  const active = await listAdminCharacters({ query: token, status: 'active' });
  expect(active.total).toBe(2);
  expect(new Set(active.items.map(item => item.character.id)))
    .toEqual(new Set([seed.published!.id, seed.publishedClean!.id]));

  const inactive = await listAdminCharacters({ query: token, status: 'inactive', pageSize: 1 });
  expect(inactive).toMatchObject({ total: SEEDED - 2, pageSize: 1 });

  await expect(listAdminCharacters({ status: 'deleted' as never })).rejects.toThrow(ADMIN_CHARACTER_STATUS_INVALID);
});

it('keeps the three per-row states separate on the scale page, with the newest task only', async () => {
  const page = await listAdminCharacters({ query: token, status: 'active', pageSize: 100 });
  const row = (id: string) => page.items.find(item => item.character.id === id)!;

  const withDraft = row(seed.published!.id);
  expect(withDraft.publishState).toMatchObject({
    status: 'active',
    publishedVersionId: seed.published!.versionId,
    publishedVersionNo: 1,
  });
  expect(withDraft.draftState).toMatchObject({ hasDraft: true, draftVersionNo: 2 });
  expect(withDraft.draftState.changedFields).toEqual(['name']);
  // Two stored tasks, one row: the selection is `created_at DESC, id DESC`, not a history dump.
  expect(withDraft.lastPublishTask).toMatchObject({ status: 'committed', versionId: seed.published!.versionId });

  const clean = row(seed.publishedClean!.id);
  expect(clean.draftState).toMatchObject({ hasDraft: false, changedFields: [] });
  expect(clean.lastPublishTask).toBeNull();

  // The draft-only character is inactive, so it is read by its own term instead of the active page.
  const draftPage = await listAdminCharacters({ query: `批量角色${SEEDED - 1}${token}` });
  const draft = draftPage.items[0]!;
  expect(draft.character.id).toBe(seed.draftOnly!.id);
  expect(draft.publishState).toMatchObject({ status: 'inactive', publishedVersionId: null, publishedVersionNo: null });
  expect(draft.draftState).toMatchObject({ hasDraft: true, draftVersionNo: 1 });
  // A draft-only character has nothing live to diverge from.
  expect(draft.publishedValidity).toBeNull();
});

it('keeps the session list bounded at the same baseline', async () => {
  const spy = vi.spyOn(db, 'select');
  const page = await listSessions({ characterId: seed.sessionCharacterId, page: 1, pageSize: 50 });
  expect(spy).toHaveBeenCalledTimes(2); // one page statement + one count statement
  spy.mockRestore();
  expect(page).toMatchObject({ total: SEEDED, page: 1, pageSize: 50 });
  expect(page.items).toHaveLength(50);
});
