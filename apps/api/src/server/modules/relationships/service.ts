import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { relationships } from '../../db/schema';

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
  expIncrement: number = 10
): Promise<{ relationship: RelationshipRecord; leveledUp: boolean }> {
  const [existing] = await db
    .select()
    .from(relationships)
    .where(
      and(
        eq(relationships.userId, userId),
        eq(relationships.characterId, characterId)
      )
    )
    .limit(1);

  const oldLevel = existing ? existing.bondLevel : 1;
  const newExp = (existing ? existing.bondExp : 0) + expIncrement;
  const newLevel = calculateBondLevel(newExp);

  if (existing) {
    const [updated] = await db
      .update(relationships)
      .set({
        bondExp: newExp,
        bondLevel: newLevel,
        updatedAt: new Date(),
      })
      .where(eq(relationships.id, existing.id))
      .returning();

    if (!updated) throw new Error('Failed to update relationship');
    return { relationship: updated as RelationshipRecord, leveledUp: newLevel > oldLevel };
  }

  const [created] = await db
    .insert(relationships)
    .values({
      userId,
      characterId,
      bondLevel: newLevel,
      bondExp: newExp,
    })
    .returning();

  if (!created) throw new Error('Failed to create relationship');
  return { relationship: created as RelationshipRecord, leveledUp: newLevel > oldLevel };
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

  return (row as RelationshipRecord) ?? null;
}
