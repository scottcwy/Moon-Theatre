import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ownedTestTarget } from '../../../db/__tests__/disposable-postgres.js';
import { closeDb, db } from '../../../db/index.js';
import { characters, chatSessions, messages, scripts, users } from '../../../db/schema.js';
import { getSessionMetadata, listSessions } from '../sessions.js';

// Fail closed: this suite writes through the ambient db, so refuse any target that is not the
// guard-verified disposable instance.
beforeAll(() => { ownedTestTarget(); });

const registry = {
  characters: [] as string[],
  scripts: [] as string[],
  users: [] as string[],
  sessions: [] as string[],
};

async function newUserId() {
  const id = randomUUID();
  await db.insert(users).values({ id, openid: id, nickname: `玩家${id.slice(0, 4)}` });
  registry.users.push(id);
  return id;
}

async function newCharacter(name: string) {
  const id = randomUUID();
  await db.insert(characters).values({
    id,
    name,
    avatarUrl: 'https://cdn.example.test/a.png',
    identity: '身份',
    description: '简介',
    initialRelationship: '陌生',
    agentId: 'role-baizang',
    status: 'active',
  });
  registry.characters.push(id);
  return id;
}

async function newScript() {
  const id = randomUUID();
  await db.insert(scripts).values({
    id,
    title: `剧本 ${id.slice(0, 8)}`,
    description: '剧本简介',
    worldSetting: '世界观',
    slug: `script-${id}`,
    genre: '古风',
    status: 'active',
  });
  registry.scripts.push(id);
  return id;
}

async function newSession(input: {
  userId: string;
  characterId: string;
  mode: 'script' | 'free';
  status?: 'active' | 'archived';
  scriptId?: string;
  updatedAt?: Date;
  createdAt?: Date;
}) {
  const id = randomUUID();
  await db.insert(chatSessions).values({
    id,
    userId: input.userId,
    characterId: input.characterId,
    mode: input.mode,
    scriptId: input.mode === 'script' ? input.scriptId ?? null : null,
    status: input.status ?? 'active',
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    ...(input.createdAt ?? input.updatedAt ? { createdAt: input.createdAt ?? input.updatedAt } : {}),
  });
  registry.sessions.push(id);
  return id;
}

/** Ids of one page, in the order the service returned them. */
function ids(result: { items: unknown[] }): string[] {
  return (result.items as Array<{ id: string }>).map(item => item.id);
}

afterEach(async () => {
  const sessionIds = registry.sessions.splice(0);
  const characterIds = registry.characters.splice(0);
  const scriptIds = registry.scripts.splice(0);
  const userIds = registry.users.splice(0);
  if (sessionIds.length > 0) await db.delete(messages).where(inArray(messages.sessionId, sessionIds));
  if (sessionIds.length > 0) await db.delete(chatSessions).where(inArray(chatSessions.id, sessionIds));
  if (characterIds.length > 0) await db.delete(characters).where(inArray(characters.id, characterIds));
  if (scriptIds.length > 0) await db.delete(scripts).where(inArray(scripts.id, scriptIds));
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
});

afterAll(closeDb);

describe('G2 listSessions character and mode filters', () => {
  it('filters by character and joins the character name', async () => {
    const user = await newUserId();
    const character = await newCharacter('顾青梧');
    const other = await newCharacter('白藏');
    const mine = await newSession({ userId: user, characterId: character, mode: 'free' });
    await newSession({ userId: user, characterId: other, mode: 'free' });

    const result = await listSessions({ characterId: character, pageSize: 50 });
    expect(ids(result)).toEqual([mine]);
    expect(result.total).toBe(1);
    expect((result.items[0] as { characterName: string }).characterName).toBe('顾青梧');
  });

  it('filters by chat mode and keeps combining it with user and status', async () => {
    // One active session per user/character/mode is a database constraint, so fixtures vary the user.
    const scriptUser = await newUserId();
    const freeUser = await newUserId();
    const otherUser = await newUserId();
    const character = await newCharacter('顾青梧');
    const script = await newScript();
    const scriptSession = await newSession({ userId: scriptUser, characterId: character, mode: 'script', scriptId: script });
    const freeSession = await newSession({ userId: freeUser, characterId: character, mode: 'free' });
    const archived = await newSession({ userId: scriptUser, characterId: character, mode: 'free', status: 'archived' });
    const otherFree = await newSession({ userId: otherUser, characterId: character, mode: 'free' });

    expect(ids(await listSessions({ mode: 'script', pageSize: 50, characterId: character }))).toEqual([scriptSession]);
    expect(ids(await listSessions({ mode: 'free', pageSize: 50, characterId: character })).sort())
      .toEqual([freeSession, archived, otherFree].sort());
    expect(ids(await listSessions({ mode: 'free', pageSize: 50, characterId: character, userId: scriptUser, status: 'archived' })))
      .toEqual([archived]);
    // The mode travels with the row so the page can label it without a second read.
    const bySession = new Map(((await listSessions({ pageSize: 50, characterId: character })).items as Array<{
      id: string; mode: string; characterName: string | null;
    }>).map(item => [item.id, item]));
    expect(bySession.get(scriptSession)).toMatchObject({ mode: 'script', characterName: '顾青梧' });
  });

  it('paginates inside the filter, newest updated first', async () => {
    const users = [await newUserId(), await newUserId(), await newUserId(), await newUserId()];
    const character = await newCharacter('顾青梧');
    const other = await newCharacter('白藏');
    const base = Date.parse('2026-11-07T00:00:00Z');
    const oldest = await newSession({ userId: users[0]!, characterId: character, mode: 'free', updatedAt: new Date(base) });
    const middle = await newSession({ userId: users[1]!, characterId: character, mode: 'free', updatedAt: new Date(base + 1000) });
    const newest = await newSession({ userId: users[2]!, characterId: character, mode: 'free', updatedAt: new Date(base + 2000) });
    await newSession({ userId: users[3]!, characterId: other, mode: 'free', updatedAt: new Date(base + 3000) });

    const first = await listSessions({ characterId: character, page: 1, pageSize: 2 });
    expect(first.total).toBe(3);
    expect(ids(first)).toEqual([newest, middle]);
    const second = await listSessions({ characterId: character, page: 2, pageSize: 2 });
    expect(second.total).toBe(3);
    expect(ids(second)).toEqual([oldest]);
    const beyond = await listSessions({ characterId: character, page: 3, pageSize: 2 });
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(3);
  });
});

describe('AC-04 listSessions created-date filter', () => {
  // One character, four sessions at exact UTC boundaries; every session belongs to its own player so
  // the one-active-session-per-(player, character, mode) constraint does not interfere.
  async function fixtures() {
    const character = await newCharacter('顾青梧');
    const [a, b, c, d] = [await newUserId(), await newUserId(), await newUserId(), await newUserId()];
    const dayStart = Date.parse('2026-11-06T00:00:00.000Z');
    const dayBefore = await newSession({ userId: await newUserId(), characterId: character, mode: 'free', createdAt: new Date(dayStart - 1) });
    const atStart = await newSession({ userId: a!, characterId: character, mode: 'free', createdAt: new Date(dayStart) });
    const inside = await newSession({ userId: b!, characterId: character, mode: 'free', createdAt: new Date(dayStart + 12 * 3600_000) });
    const lastMilli = await newSession({ userId: c!, characterId: character, mode: 'free', createdAt: new Date(dayStart + 86_400_000 - 1) });
    const nextDay = await newSession({ userId: d!, characterId: character, mode: 'free', createdAt: new Date(dayStart + 86_400_000) });
    return { character, dayBefore, atStart, inside, lastMilli, nextDay };
  }

  it('includes the whole `from` day (inclusive start) and excludes the millisecond before it', async () => {
    const { character, dayBefore, atStart, inside, lastMilli, nextDay } = await fixtures();
    const result = await listSessions({ characterId: character, from: '2026-11-06', pageSize: 50 });
    // An open-ended range keeps everything after the start day; only the earlier millisecond drops.
    expect(ids(result).sort()).toEqual([atStart, inside, lastMilli, nextDay].sort());
    expect(ids(result)).not.toContain(dayBefore);
    expect(result.total).toBe(4);
  });

  it('includes the whole `to` day (inclusive end) and excludes the next day', async () => {
    const { character, dayBefore, atStart, inside, lastMilli } = await fixtures();
    const result = await listSessions({ characterId: character, to: '2026-11-06', pageSize: 50 });
    expect(ids(result).sort()).toEqual([dayBefore, atStart, inside, lastMilli].sort());
    expect(result.total).toBe(4);
  });

  it('combines both bounds with the character filter and keeps the total inside the range', async () => {
    const { character, atStart, inside, lastMilli, nextDay } = await fixtures();
    const other = await newCharacter('白藏');
    const otherUser = await newUserId();
    await newSession({ userId: otherUser, characterId: other, mode: 'free', createdAt: new Date(Date.parse('2026-11-06T06:00:00.000Z')) });

    const sameDay = await listSessions({ characterId: character, from: '2026-11-06', to: '2026-11-06', pageSize: 50 });
    expect(ids(sameDay).sort()).toEqual([atStart, inside, lastMilli].sort());
    expect(sameDay.total).toBe(3);
    expect(ids(sameDay)).not.toContain(nextDay);

    // One day later only the next-day session remains: a single-day range is not silently widened.
    const nextOnly = await listSessions({ characterId: character, from: '2026-11-07', to: '2026-11-07', pageSize: 50 });
    expect(ids(nextOnly)).toEqual([nextDay]);
    expect(nextOnly.total).toBe(1);
  });

  it('returns the empty result (never the unfiltered list) for an inverted range', async () => {
    const { character } = await fixtures();
    const result = await listSessions({ characterId: character, from: '2026-11-07', to: '2026-11-06', pageSize: 50 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('G3 session metadata without the transcript', () => {
  it('reads the header of a session without touching its messages', async () => {
    const user = await newUserId();
    const character = await newCharacter('顾青梧');
    const session = await newSession({ userId: user, characterId: character, mode: 'free' });
    await db.insert(messages).values([
      { sessionId: session, role: 'user', content: '第一句' },
      { sessionId: session, role: 'assistant', content: '第一句的回应' },
    ]);

    const metadata = await getSessionMetadata(session);
    expect(metadata).toMatchObject({
      id: session,
      userId: user,
      characterId: character,
      characterName: '顾青梧',
      mode: 'free',
      status: 'active',
    });
    expect(metadata).not.toHaveProperty('messages');

    await expect(getSessionMetadata(randomUUID())).rejects.toThrow('Session');
  });
});
