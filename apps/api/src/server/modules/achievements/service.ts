import { and, count, desc, eq, inArray, max } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  achievements,
  chatSessions,
  messages,
  relationships,
  titles,
  userAchievements,
  userTitles,
} from '../../db/schema.js';
import { ACHIEVEMENT_RULES, evaluateAchievementRules } from './rules.js';
import type { AchievementRule } from './rules.js';

export function mergeUnlockedAchievementCodes(existingCodes: string[], candidateCodes: string[]): string[] {
  const existing = new Set(existingCodes);
  return [...new Set(candidateCodes)].filter((code) => !existing.has(code));
}

export async function getUserAchievements(userId: string) {
  const [achievementRows, titleRows] = await Promise.all([
    db
      .select({
        id: achievements.id,
        name: achievements.name,
        description: achievements.description,
        condition: achievements.condition,
        iconUrl: achievements.iconUrl,
        unlockedAt: userAchievements.unlockedAt,
      })
      .from(userAchievements)
      .leftJoin(achievements, eq(userAchievements.achievementId, achievements.id))
      .where(eq(userAchievements.userId, userId))
      .orderBy(desc(userAchievements.unlockedAt)),
    db
      .select({
        id: titles.id,
        name: titles.name,
        description: titles.description,
        iconUrl: titles.iconUrl,
        unlockedAt: userTitles.unlockedAt,
      })
      .from(userTitles)
      .leftJoin(titles, eq(userTitles.titleId, titles.id))
      .where(eq(userTitles.userId, userId))
      .orderBy(desc(userTitles.unlockedAt)),
  ]);

  return {
    achievements: achievementRows.map((row) => ({
      ...row,
      code: readConditionCode(row.condition),
    })),
    titles: titleRows,
  };
}

export async function unlockAchievementsForChat(userId: string) {
  const [userMessages, assistantMessages, bondLevelRows] = await Promise.all([
    db
      .select({ total: count() })
      .from(messages)
      .leftJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
      .where(and(eq(chatSessions.userId, userId), eq(messages.role, 'user'))),
    db
      .select({ total: count() })
      .from(messages)
      .leftJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
      .where(and(eq(chatSessions.userId, userId), eq(messages.role, 'assistant'))),
    db.select({ maxBondLevel: max(relationships.bondLevel) }).from(relationships).where(eq(relationships.userId, userId)),
  ]);

  const candidateRules = evaluateAchievementRules({
    userMessageCount: readNumber(userMessages[0]?.total),
    assistantMessageCount: readNumber(assistantMessages[0]?.total),
    maxBondLevel: readNumber(bondLevelRows[0]?.maxBondLevel),
  });

  if (candidateRules.length === 0) {
    return { unlockedAchievements: [], unlockedTitles: [] };
  }

  await ensureAchievementRulesSeeded(candidateRules);

  const achievementRows = (await db
    .select({ id: achievements.id, condition: achievements.condition })
    .from(achievements))
    .map((row) => ({ ...row, code: readConditionCode(row.condition) }))
    .filter((row) => row.code && candidateRules.some((rule) => rule.code === row.code));

  const existingRows = await db
    .select({ condition: achievements.condition })
    .from(userAchievements)
    .leftJoin(achievements, eq(userAchievements.achievementId, achievements.id))
    .where(eq(userAchievements.userId, userId));

  const newCodes = mergeUnlockedAchievementCodes(
    existingRows.map((row) => readConditionCode(row.condition)).filter((code): code is string => Boolean(code)),
    candidateRules.map((rule) => rule.code),
  );

  const achievementIdsByCode = new Map(achievementRows.map((row) => [row.code, row.id]));
  const achievementsToUnlock = newCodes
    .map((code) => ({ code, achievementId: achievementIdsByCode.get(code) }))
    .filter((item): item is { code: string; achievementId: string } => Boolean(item.achievementId));

  if (achievementsToUnlock.length > 0) {
    await db.insert(userAchievements).values(
      achievementsToUnlock.map((item) => ({
        userId,
        achievementId: item.achievementId,
      })),
    );
  }

  const unlockedTitles = await unlockTitlesForRules(userId, candidateRules.filter((rule) => newCodes.includes(rule.code)));

  return {
    unlockedAchievements: achievementsToUnlock.map((item) => item.code),
    unlockedTitles,
  };
}

async function ensureAchievementRulesSeeded(rules: AchievementRule[]) {
  const existingAchievementRows = await db
    .select({ condition: achievements.condition })
    .from(achievements);
  const existingAchievementCodes = new Set(
    existingAchievementRows.map((row) => readConditionCode(row.condition)).filter((code): code is string => Boolean(code)),
  );
  const missingAchievements = rules.filter((rule) => !existingAchievementCodes.has(rule.code));
  if (missingAchievements.length > 0) {
    await db
      .insert(achievements)
      .values(
        missingAchievements.map((rule) => ({
          name: rule.name,
          description: rule.description,
          condition: { code: rule.code, ...rule.condition },
        })),
      );
  }

  const titleRules = rules.filter((rule) => rule.titleName);
  if (titleRules.length > 0) {
    const titleNames = titleRules.map((rule) => rule.titleName!);
    const existingTitleRows = await db
      .select({ name: titles.name })
      .from(titles)
      .where(inArray(titles.name, titleNames));
    const existingTitleNames = new Set(existingTitleRows.map((row) => row.name));
    const missingTitles = titleRules.filter((rule) => !existingTitleNames.has(rule.titleName!));
    if (missingTitles.length > 0) {
      await db
        .insert(titles)
        .values(
          missingTitles.map((rule) => ({
            name: rule.titleName!,
            description: rule.titleDescription ?? null,
          })),
        );
    }
  }
}

async function unlockTitlesForRules(userId: string, rules: AchievementRule[]) {
  const titleNames = rules.map((rule) => rule.titleName).filter((name): name is string => Boolean(name));
  if (titleNames.length === 0) {
    return [];
  }

  const titleRows = await db
    .select({ id: titles.id, name: titles.name })
    .from(titles)
    .where(inArray(titles.name, titleNames));

  const existingRows = await db
    .select({ titleId: userTitles.titleId })
    .from(userTitles)
    .where(eq(userTitles.userId, userId));
  const existingTitleIds = new Set(existingRows.map((row) => row.titleId));
  const titlesToUnlock = titleRows.filter((row) => !existingTitleIds.has(row.id));

  if (titlesToUnlock.length > 0) {
    await db.insert(userTitles).values(
      titlesToUnlock.map((title) => ({
        userId,
        titleId: title.id,
      })),
    );
  }

  return titlesToUnlock.map((title) => title.name);
}

function readNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number.parseInt(value, 10) || 0;
  return 0;
}

function readConditionCode(condition: unknown): string | null {
  if (condition && typeof condition === 'object' && 'code' in condition) {
    const code = (condition as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export { ACHIEVEMENT_RULES };
