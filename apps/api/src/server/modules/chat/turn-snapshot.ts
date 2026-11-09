import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  characters,
  chatTurnSnapshots,
  contentVersions,
  modelProfileVersions,
  modelProfiles,
} from '../../db/schema.js';
import {
  ContentValidationError,
  validateCharacterDraft,
  type CharacterDraft,
  type ValidationIssue,
} from '../content/validation.js';
import { currentAgentContextVersionId, getAgentContextDisplayNumbers } from '../agent-context/index.js';
import type { ChatModelTier, CharacterWithPrompts, Script } from './service.js';

type TurnQueryClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Batch 2 step B — the accepted turn's version pin.
 *
 * `pinAcceptedTurn` runs inside the transaction that accepts a user turn (the insert of the user
 * message), so the character's published version, the model profile version and the snapshot row
 * either commit together or not at all. Everything a later attempt needs (prompt payload, script
 * card, billing tier/price) is read from the pinned rows only — never from the live
 * `characters`/`character_prompts` rows, the current draft, or a timestamp guess.
 */
export type TurnPinErrorCode =
  | 'character_version_unavailable'
  | 'character_content_incomplete'
  | 'model_profile_unavailable';

/** Fail-closed rejection: the turn is not accepted, so nothing was charged or snapshotted. */
export class TurnPinError extends Error {
  constructor(
    readonly code: TurnPinErrorCode,
    /** Admin-visible reason (logged server-side, never returned to the client). */
    readonly reason: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(`${code}: ${reason}`);
    this.name = 'TurnPinError';
  }
}

export interface PinnedTurnModel {
  modelProfileVersionId: string;
  modelTier: ChatModelTier;
  provider: string;
  /** The model the pinned tier DECLARED; the model actually called is recorded separately. */
  modelName: string;
  pointsPerCall: number;
}

export interface PinnedTurn {
  snapshotId: string;
  userMessageId: string;
  clientMessageId: string | null;
  contentVersionId: string;
  contentVersionNo: number;
  /** Persona + display fields of the pinned version (never the live rows). */
  character: CharacterWithPrompts;
  /** Script card frozen into the pinned version, `null` for a script-less character. */
  script: Script | null;
  model: PinnedTurnModel;
}

export interface TurnVersionAttribution {
  userMessageId: string;
  contentVersionId: string | null;
  contentVersionNo: number | null;
  modelProfileVersionId: string | null;
  /** The model the pinned model-profile version DECLARED (billing/display fact). */
  declaredModelName: string | null;
  /** The model the runtime ACTUALLY called; `null` means "not recorded", never "unknown". */
  actualModelName: string | null;
  /** The base-context record current at accept time; NULL means "not recorded", never "latest". */
  agentContextVersionId: string | null;
  /** Per-agent base-context ordinal (`b#`) for display; NULL when unrecorded. */
  agentContextVersionNo: number | null;
  /** True when no snapshot exists: the turn stays unattributed, never inferred. */
  versionUnknown: boolean;
}

const UNKNOWN_ATTRIBUTION = {
  contentVersionId: null,
  contentVersionNo: null,
  modelProfileVersionId: null,
  declaredModelName: null,
  actualModelName: null,
  agentContextVersionId: null,
  agentContextVersionNo: null,
  versionUnknown: true,
} as const;

function toCharacter(characterId: string, versionId: string, payload: CharacterDraft): CharacterWithPrompts {
  return {
    id: characterId,
    name: payload.name,
    avatarUrl: payload.avatarUrl,
    identity: payload.identity,
    description: payload.description,
    scriptId: payload.scriptId ?? null,
    initialRelationship: payload.initialRelationship,
    agentId: payload.agentId || null,
    status: 'active',
    prompts: [{
      id: versionId,
      systemPrompt: payload.prompt.systemPrompt,
      personalityPrompt: payload.prompt.personalityPrompt,
      scenarioPrompt: payload.prompt.scenarioPrompt,
      safetyPrompt: payload.prompt.safetyPrompt,
      outputFormatPrompt: payload.prompt.outputFormatPrompt,
    }],
  };
}

function toScript(payload: CharacterDraft): Script | null {
  if (!payload.scriptId) return null;
  return {
    id: payload.scriptId,
    title: payload.scriptSnapshot?.title ?? '',
    description: '',
    worldSetting: payload.scriptSnapshot?.worldSetting ?? '',
    status: 'active',
  };
}

/**
 * A published version that does not re-validate (e.g. a tamed legacy capture with empty persona
 * fields) is an explicit failure: the fix is one complete draft save + publish, not a fallback.
 */
function pinnedPayload(version: { id: string; payload: unknown }): CharacterDraft {
  try {
    return validateCharacterDraft(version.payload);
  } catch (error) {
    if (error instanceof ContentValidationError) {
      throw new TurnPinError(
        'character_content_incomplete',
        `published version ${version.id} carries no usable content`,
        error.issues,
      );
    }
    throw error;
  }
}

async function loadPublishedVersion(
  client: TurnQueryClient,
  characterId: string,
  publishedVersionId: string,
): Promise<{ id: string; versionNo: number; payload: unknown }> {
  const [version] = await client
    .select({
      id: contentVersions.id,
      versionNo: contentVersions.versionNo,
      status: contentVersions.status,
      entityType: contentVersions.entityType,
      entityId: contentVersions.entityId,
      payload: contentVersions.payload,
    })
    .from(contentVersions)
    .where(eq(contentVersions.id, publishedVersionId))
    .limit(1);
  if (!version || version.entityType !== 'character' || version.entityId !== characterId ||
      version.status !== 'published') {
    throw new TurnPinError(
      'character_version_unavailable',
      `character ${characterId} points at content version ${publishedVersionId} which is not its published version`,
    );
  }
  return version;
}

async function resolveModelProfile(client: TurnQueryClient, tier: ChatModelTier): Promise<PinnedTurnModel> {
  const [profile] = await client
    .select({
      id: modelProfiles.id,
      tier: modelProfiles.tier,
      provider: modelProfiles.provider,
      modelName: modelProfiles.modelName,
      pointsPerCall: modelProfiles.pointsPerCall,
    })
    .from(modelProfiles)
    .where(and(eq(modelProfiles.tier, tier), eq(modelProfiles.enabled, true)))
    .limit(1);
  if (!profile) {
    throw new TurnPinError('model_profile_unavailable', `model tier "${tier}" has no enabled profile`);
  }
  const [version] = await client
    .select({
      id: modelProfileVersions.id,
      provider: modelProfileVersions.provider,
      modelName: modelProfileVersions.modelName,
      pointsPerCall: modelProfileVersions.pointsPerCall,
    })
    .from(modelProfileVersions)
    .where(and(
      eq(modelProfileVersions.profileId, profile.id),
      eq(modelProfileVersions.status, 'published'),
    ))
    .orderBy(desc(modelProfileVersions.versionNo))
    .limit(1);
  if (!version) {
    throw new TurnPinError('model_profile_unavailable', `model tier "${tier}" has no published version`);
  }
  return {
    modelProfileVersionId: version.id,
    modelTier: profile.tier,
    provider: version.provider,
    modelName: version.modelName,
    pointsPerCall: version.pointsPerCall,
  };
}

/**
 * Resolves the character's published version + model profile version and records them on the
 * accepted user message. Must be called with the accept transaction's client.
 *
 * Idempotent per user message (`user_message_id` is unique): a duplicate accept keeps the snapshot
 * written by the first accept, so a publish landing in between can never upgrade an accepted turn.
 */
export async function pinAcceptedTurn(
  client: TurnQueryClient,
  input: {
    userMessageId: string;
    clientMessageId?: string | null;
    characterId: string;
    modelTier: ChatModelTier;
  },
): Promise<PinnedTurn> {
  // FOR SHARE blocks while a publish holds FOR UPDATE on the row: the turn pins either the
  // pre-switch or the post-switch pointer, never a half state.
  const [character] = await client
    .select({
      id: characters.id,
      status: characters.status,
      publishedVersionId: characters.publishedVersionId,
      agentId: characters.agentId,
    })
    .from(characters)
    .where(eq(characters.id, input.characterId))
    .limit(1)
    .for('share');
  if (!character) {
    throw new TurnPinError('character_version_unavailable', `character ${input.characterId} does not exist`);
  }
  if (character.status !== 'active') {
    throw new TurnPinError('character_version_unavailable', `character ${input.characterId} is not active`);
  }
  if (!character.publishedVersionId) {
    throw new TurnPinError('character_version_unavailable', `character ${input.characterId} has no published version`);
  }

  const version = await loadPublishedVersion(client, character.id, character.publishedVersionId);
  const payload = pinnedPayload(version);
  const model = await resolveModelProfile(client, input.modelTier);
  // Batch 3 step 1: the turn references the base context that is CURRENT at accept time (the explicit
  // `agent_current_context` pointer, not `max(created_at)` — recording is hash-deduped, so a content
  // revert keeps an older row). One local read in this same transaction — never a FastClaw call, never
  // an inference from "the latest one later" — and NULL when nothing was ever recorded.
  const agentContextVersionId = await currentAgentContextVersionId(client, character.agentId ?? payload.agentId ?? null);

  const [inserted] = await client
    .insert(chatTurnSnapshots)
    .values({
      userMessageId: input.userMessageId,
      clientMessageId: input.clientMessageId ?? null,
      characterId: character.id,
      contentVersionId: version.id,
      modelProfileVersionId: model.modelProfileVersionId,
      modelTier: model.modelTier,
      provider: model.provider,
      declaredModelName: model.modelName,
      pointsPerCall: model.pointsPerCall,
      agentContextVersionId,
    })
    .onConflictDoNothing({ target: chatTurnSnapshots.userMessageId })
    .returning({ id: chatTurnSnapshots.id });

  if (inserted) {
    return {
      snapshotId: inserted.id,
      userMessageId: input.userMessageId,
      clientMessageId: input.clientMessageId ?? null,
      contentVersionId: version.id,
      contentVersionNo: version.versionNo,
      character: toCharacter(character.id, version.id, payload),
      script: toScript(payload),
      model,
    };
  }

  // Duplicate accept: the first accept's pin is the turn's pin.
  const existing = await loadPinnedTurn(client, input.userMessageId);
  if (!existing) {
    throw new TurnPinError(
      'character_version_unavailable',
      `turn ${input.userMessageId} conflicted while pinning and has no stored snapshot`,
    );
  }
  return existing;
}

/** Reads the pin of an already accepted turn (retry / takeover). */
export async function loadPinnedTurn(
  client: TurnQueryClient,
  userMessageId: string,
): Promise<PinnedTurn | null> {
  const [row] = await client
    .select({
      snapshotId: chatTurnSnapshots.id,
      userMessageId: chatTurnSnapshots.userMessageId,
      clientMessageId: chatTurnSnapshots.clientMessageId,
      characterId: chatTurnSnapshots.characterId,
      contentVersionId: chatTurnSnapshots.contentVersionId,
      contentVersionNo: contentVersions.versionNo,
      payload: contentVersions.payload,
      modelProfileVersionId: chatTurnSnapshots.modelProfileVersionId,
      modelTier: chatTurnSnapshots.modelTier,
      provider: chatTurnSnapshots.provider,
      modelName: chatTurnSnapshots.declaredModelName,
      pointsPerCall: chatTurnSnapshots.pointsPerCall,
    })
    .from(chatTurnSnapshots)
    .innerJoin(contentVersions, eq(chatTurnSnapshots.contentVersionId, contentVersions.id))
    .where(eq(chatTurnSnapshots.userMessageId, userMessageId))
    .limit(1);
  if (!row) return null;

  const payload = pinnedPayload({ id: row.contentVersionId, payload: row.payload });
  return {
    snapshotId: row.snapshotId,
    userMessageId: row.userMessageId,
    clientMessageId: row.clientMessageId,
    contentVersionId: row.contentVersionId,
    contentVersionNo: row.contentVersionNo,
    character: toCharacter(row.characterId, row.contentVersionId, payload),
    script: toScript(payload),
    model: {
      modelProfileVersionId: row.modelProfileVersionId,
      modelTier: row.modelTier,
      provider: row.provider,
      modelName: row.modelName,
      pointsPerCall: row.pointsPerCall,
    },
  };
}

/**
 * Read path attribution for history/recovery surfaces: a message without a snapshot reports
 * `versionUnknown: true` and stays unattributed (no inference from timestamps or current content).
 */
export async function getTurnVersionAttributions(
  userMessageIds: string[],
): Promise<TurnVersionAttribution[]> {
  if (userMessageIds.length === 0) return [];
  const rows = await db
    .select({
      userMessageId: chatTurnSnapshots.userMessageId,
      contentVersionId: chatTurnSnapshots.contentVersionId,
      contentVersionNo: contentVersions.versionNo,
      modelProfileVersionId: chatTurnSnapshots.modelProfileVersionId,
      declaredModelName: chatTurnSnapshots.declaredModelName,
      actualModelName: chatTurnSnapshots.actualModelName,
      agentContextVersionId: chatTurnSnapshots.agentContextVersionId,
    })
    .from(chatTurnSnapshots)
    .innerJoin(contentVersions, eq(chatTurnSnapshots.contentVersionId, contentVersions.id))
    .where(inArray(chatTurnSnapshots.userMessageId, userMessageIds));
  const byMessageId = new Map(rows.map((row) => [row.userMessageId, row]));
  const agentContextNumbers = await getAgentContextDisplayNumbers(
    rows.map((row) => row.agentContextVersionId).filter((id): id is string => Boolean(id)),
  );
  return userMessageIds.map((userMessageId) => {
    const row = byMessageId.get(userMessageId);
    if (!row) return { userMessageId, ...UNKNOWN_ATTRIBUTION };
    return {
      userMessageId,
      contentVersionId: row.contentVersionId,
      contentVersionNo: row.contentVersionNo,
      modelProfileVersionId: row.modelProfileVersionId,
      declaredModelName: row.declaredModelName,
      actualModelName: row.actualModelName,
      agentContextVersionId: row.agentContextVersionId,
      agentContextVersionNo: row.agentContextVersionId
        ? agentContextNumbers.get(row.agentContextVersionId) ?? null
        : null,
      versionUnknown: false,
    };
  });
}

/**
 * F2 — records the model the runtime ACTUALLY called on the turn's snapshot.
 *
 * Deliberately called after the finalize transaction commits, not inside it: a failed attribution
 * write must never roll back the assistant message and the usage row of a turn that already
 * succeeded. The caller gets a plain boolean and surfaces the honest outcome — `false` means the
 * snapshot keeps `actual_model_name = NULL`, i.e. the transcript says 实际模型未记录 instead of
 * claiming a model it does not have.
 *
 * Idempotent: the accepted turn's snapshot is keyed by its unique `user_message_id` and the write is
 * the same value on every retry of the same turn (the adapter validates one runtime model), so a
 * repeat updates one row to the value it already holds and records nothing new.
 */
export async function recordTurnActualModel(
  userMessageId: string,
  actualModelName: string,
): Promise<boolean> {
  const value = actualModelName.trim();
  if (!value) return false;
  try {
    const updated = await db
      .update(chatTurnSnapshots)
      .set({ actualModelName: value })
      .where(eq(chatTurnSnapshots.userMessageId, userMessageId))
      .returning({ id: chatTurnSnapshots.id });
    if (updated.length === 0) {
      // No snapshot (e.g. an accepted turn without a pin): nothing to attribute, and nothing is
      // claimed. Never an error for the caller — the turn itself already committed.
      console.warn({ event: 'chat_turn_actual_model_unrecorded', userMessageId, reason: 'no_snapshot', actualModel: value });
      return false;
    }
    return true;
  } catch (error) {
    console.warn({
      event: 'chat_turn_actual_model_unrecorded',
      userMessageId,
      reason: 'write_failed',
      actualModel: value,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
