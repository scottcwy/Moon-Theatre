import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { relationshipBondExpEvents, relationships } from '../../db/schema';

export interface RelationshipRecord {
  id: string;
  userId: string;
  characterId: string;
  bondLevel: number;
  bondExp: number;
  createdAt: Date;
  updatedAt: Date;
}

const BOND_EXP_PER_LEVEL = 100;
const MAX_LEVEL = 10;

export function calculateBondLevel(totalExp: number): number {
  const level = Math.floor(totalExp / BOND_EXP_PER_LEVEL) + 1;
  return Math.min(level, MAX_LEVEL);
}

export function calculateBondExpForNextLevel(currentLevel: number): number {
  if (currentLevel >= MAX_LEVEL) return 0;
  return currentLevel * BOND_EXP_PER_LEVEL;
}

export async function incrementBondExp(
  userId: string,
  characterId: string,
  expIncrement: number = 10,
  assistantMessageId?: string,
): Promise<{ relationship: RelationshipRecord; leveledUp: boolean }> {
  if (assistantMessageId) {
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(relationships)
        .where(
          and(
            eq(relationships.userId, userId),
            eq(relationships.characterId, characterId)
          )
        )
        .limit(1);

      const [event] = await tx
        .insert(relationshipBondExpEvents)
        .values({
          assistantMessageId,
          userId,
          characterId,
          expIncrement,
        })
        .onConflictDoNothing({
          target: relationshipBondExpEvents.assistantMessageId,
        })
        .returning({ id: relationshipBondExpEvents.id });

      if (!event) {
        const [current] = await tx
          .select()
          .from(relationships)
          .where(
            and(
              eq(relationships.userId, userId),
              eq(relationships.characterId, characterId)
            )
          )
          .limit(1);

        if (!current) throw new Error('Relationship bond event exists without relationship');
        return { relationship: current, leveledUp: false };
      }

      const oldLevel = before?.bondLevel ?? 1;
      const relationship = await upsertRelationshipBondExp(tx, userId, characterId, expIncrement);
      return { relationship, leveledUp: relationship.bondLevel > oldLevel };
    });
  }

  const [before] = await db
    .select()
    .from(relationships)
    .where(
      and(
        eq(relationships.userId, userId),
        eq(relationships.characterId, characterId)
      )
    )
    .limit(1);

  const oldLevel = before?.bondLevel ?? 1;
  const relationship = await upsertRelationshipBondExp(db, userId, characterId, expIncrement);
  return { relationship, leveledUp: relationship.bondLevel > oldLevel };
}

async function upsertRelationshipBondExp(
  executor: Pick<typeof db, 'insert'>,
  userId: string,
  characterId: string,
  expIncrement: number,
): Promise<RelationshipRecord> {
  const [relationship] = await executor
    .insert(relationships)
    .values({
      userId,
      characterId,
      bondLevel: calculateBondLevel(expIncrement),
      bondExp: expIncrement,
    })
    .onConflictDoUpdate({
      target: [relationships.userId, relationships.characterId],
      set: {
        bondExp: sql`${relationships.bondExp} + ${expIncrement}`,
        bondLevel: sql`least(floor((${relationships.bondExp} + ${expIncrement}) / ${BOND_EXP_PER_LEVEL}) + 1, ${MAX_LEVEL})`,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!relationship) throw new Error('Failed to upsert relationship');
  return relationship;
}

export async function getRelationship(
  userId: string,
  characterId: string
): Promise<RelationshipRecord | null> {
  const [row] = await db
    .select()
    .from(relationships)
    .where(
      and(
        eq(relationships.userId, userId),
        eq(relationships.characterId, characterId)
      )
    )
    .limit(1);

  return row ?? null;
}
