import { and, count, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { ROLEPLAY_AGENT_IDS } from '@juben-sha/shared';
import { db } from '../../db/index.js';
import {
  characters,
  characterPrompts,
  contentVersions,
  modelProfiles,
  modelProfileVersions,
  publishTasks,
  scripts,
} from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../http/errors.js';
import {
  ContentValidationError,
  validateCharacterDraft,
  type CharacterDraft,
  type PromptDraft,
  type StarterQuestionsDraft,
  type ValidationIssue,
} from '../content/validation.js';
import {
  creatorColumns,
  finalizePendingAdminAudit,
  matchesIdentityActor,
  type IdentityAdminActor,
  recordAdminAuditInTransaction,
} from './audit.js';
import {
  desiredPublishHash,
  hashContentPayload,
  settlePublishAudit,
} from './content.js';
import { escapeLikeTerm } from './query.js';
import { normalizePagination, type PaginatedResult, type PaginationParams } from './pagination.js';
import { syncCharacterBaseContext, type BaseContextSyncResult } from '../agent-context/index.js';

type CharacterRow = typeof characters.$inferSelect;
type CharacterPromptRow = typeof characterPrompts.$inferSelect;
type ContentVersionRow = typeof contentVersions.$inferSelect;
type PublishTaskRow = typeof publishTasks.$inferSelect;
type CharacterTransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DRAFT_FIELDS: ReadonlyArray<keyof CharacterDraft> = [
  'name',
  'avatarUrl',
  'identity',
  'description',
  'scriptId',
  'initialRelationship',
  'agentId',
  'starterQuestions',
  'prompt',
  'sortOrder',
];

const NESTED_DIFF_FIELDS: ReadonlyArray<keyof CharacterDraft> = ['starterQuestions', 'prompt'];

/** Immutable draft version produced by one save. `updatedAt`/`versionId` are the next edit baseline. */
export interface AdminCharacterRecord {
  id: string;
  versionId: string;
  versionNo: number;
  updatedAt: Date;
  status: 'active' | 'inactive';
  publishedVersionId: string | null;
  payload: CharacterDraft;
}

/** `active` = 已上架, `inactive` = 未上架 (the only two stored states). */
export type AdminCharacterStatus = 'active' | 'inactive';

/** List filters: one search term over name / agent id / script title, plus the publish state. */
export interface AdminCharacterListFilters {
  query?: string;
  status?: AdminCharacterStatus;
}

/** Publish state, draft divergence and the last publish task are reported separately. */
export interface AdminCharacterListItem {
  character: CharacterRow;
  prompt: CharacterPromptRow | null;
  publishState: {
    status: 'active' | 'inactive';
    publishedVersionId: string | null;
    publishedVersionNo: number | null;
  };
  draftState: {
    hasDraft: boolean;
    draftVersionId: string | null;
    draftVersionNo: number | null;
    changedFields: string[];
  };
  /**
   * Validity of the published payload, computed from the versions this listing already loaded:
   * one query for the whole list instead of one preview read per character.
   */
  publishedValidity: { valid: boolean; issues: ValidationIssue[] } | null;
  lastPublishTask: {
    id: string;
    versionId: string;
    status: string;
    recoveryState: string | null;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
}

export interface CharacterDraftDiff {
  characterId: string;
  draftVersionId: string | null;
  draftVersionNo: number | null;
  publishedVersionId: string | null;
  changedFields: string[];
}

export interface CharacterPreview {
  characterId: string;
  versionId: string;
  versionNo: number;
  versionStatus: string;
  isPublished: boolean;
  /** Display fields of the stored payload, shown even when the payload no longer validates. */
  card: { name: string; avatarUrl: string; identity: string; description: string };
  detail: {
    name: string;
    avatarUrl: string;
    identity: string;
    description: string;
    initialRelationship: string;
    scriptId: string | null;
  };
  starterQuestions: StarterQuestionsDraft;
  availableModes: Array<'script' | 'free'>;
  /** `status` is the publish preflight fact: an inactive script refuses publishing (§5.2.1). */
  script: { id: string; title: string; slug: string; coverUrl: string | null; status: string } | null;
  /** Script card frozen into the published version (§5.1); null when no script is bound. */
  scriptSnapshot: { title: string; worldSetting: string } | null;
  /**
   * Whether the stored payload re-validates as a complete `CharacterDraft`. Captured legacy content
   * is shown as-is with the issues listed here (the operator needs to see it in order to fix it);
   * only publishing refuses an invalid payload.
   */
  validity: { valid: boolean; issues: ValidationIssue[] };
  /**
   * Runtime prerequisites a published version still needs in order to serve a turn (§5.2.1).
   * Reported next to the publish confirmation; publish itself is never blocked by it.
   */
  preflight: CharacterPublishPreflight;
}

/**
 * Publish preflight: what a new turn needs that is not a property of this character at all.
 * `ready: false` does not refuse publishing (an operator must be able to stage content), it states
 * that the published version cannot serve a turn until the missing prerequisite is published.
 */
export interface CharacterPublishPreflight {
  /** Enabled model tiers that have at least one published model-profile version. */
  readyModelTiers: number;
  /** False when every turn would be refused with `model_profile_unavailable`. */
  ready: boolean;
  /** Operator-facing warning; null when a new turn can be pinned. */
  warning: string | null;
}

export const MODEL_PROFILE_PREFLIGHT_WARNING =
  '运行前置缺失：当前没有已发布的模型档位版本，发布后新回合会被拒绝（需先发布模型档位）。';

export type CharacterDraftBaseline = { expectedUpdatedAt: string } | { versionId: string };

/** Result of the explicit first-draft action: the baseline the edit page renders next. */
export interface CharacterFirstDraftRecord {
  characterId: string;
  versionId: string;
  versionNo: number;
  updatedAt: Date;
  /** The seeded draft may be invalid (legacy content): that is why the operator has to edit it. */
  validity: { valid: boolean; issues: ValidationIssue[] };
}

function isPayloadObject(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload);
}

function displayText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function displayQuestions(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((question): question is string => typeof question === 'string') : [];
}

/**
 * Display-only read of a stored payload that does not re-validate (captured legacy content, §5.3).
 * Missing or malformed fields become empty values so the preview still renders what is stored.
 */
function previewPayload(payload: unknown): CharacterDraft {
  const value = isPayloadObject(payload) ? payload : {};
  const rawPrompt = isPayloadObject(value.prompt) ? value.prompt : {};
  const rawQuestions = isPayloadObject(value.starterQuestions) ? value.starterQuestions : {};
  const rawSnapshot = isPayloadObject(value.scriptSnapshot) ? value.scriptSnapshot : null;
  return {
    name: displayText(value.name),
    avatarUrl: displayText(value.avatarUrl),
    identity: displayText(value.identity),
    description: displayText(value.description),
    scriptId: typeof value.scriptId === 'string' && value.scriptId ? value.scriptId : null,
    initialRelationship: displayText(value.initialRelationship),
    agentId: displayText(value.agentId),
    starterQuestions: {
      script: displayQuestions(rawQuestions.script),
      free: displayQuestions(rawQuestions.free),
    },
    prompt: {
      systemPrompt: displayText(rawPrompt.systemPrompt),
      personalityPrompt: displayText(rawPrompt.personalityPrompt),
      scenarioPrompt: displayText(rawPrompt.scenarioPrompt),
      safetyPrompt: displayText(rawPrompt.safetyPrompt),
      outputFormatPrompt: displayText(rawPrompt.outputFormatPrompt),
    },
    ...(rawSnapshot
      ? { scriptSnapshot: { title: displayText(rawSnapshot.title), worldSetting: displayText(rawSnapshot.worldSetting) } }
      : {}),
  };
}

/**
 * A stored payload that no longer validates (captured legacy content) stays readable as stored;
 * publishing is the only strict reader. The issues always travel with the payload.
 */
function payloadState(payload: unknown): { payload: CharacterDraft; validity: { valid: boolean; issues: ValidationIssue[] } } {
  try {
    return { payload: validateCharacterDraft(payload), validity: { valid: true, issues: [] } };
  } catch (error) {
    if (!(error instanceof ContentValidationError)) throw error;
    return { payload: previewPayload(payload), validity: { valid: false, issues: error.issues } };
  }
}

/** One immutable stored version as the editor reads it: text plus the verdict on that text. */
export interface CharacterVersionState {
  versionId: string;
  versionNo: number;
  updatedAt: Date;
  payload: CharacterDraft;
  validity: { valid: boolean; issues: ValidationIssue[] };
}

/**
 * Everything one edit page needs about the stored versions of a character: the published payload,
 * the newest draft payload (if any), the baseline a save must carry, and the divergence between
 * them. Persona text is served here, so the editor never has to hide a draft it cannot read.
 */
export interface CharacterEditState {
  characterId: string;
  status: 'active' | 'inactive';
  agentId: string | null;
  scriptId: string | null;
  sortOrder: number;
  published: CharacterVersionState | null;
  draft: CharacterVersionState | null;
  editable: { versionId: string; versionNo: number; updatedAt: Date; source: 'draft' | 'published' } | null;
  changedFields: string[];
  /** Runtime prerequisites of the publish, shown beside the publish confirmation (§5.2.1). */
  preflight: CharacterPublishPreflight;
}

/**
 * The payload a first draft seeds from: the character's stored display fields plus its newest
 * `character_prompts` row, with empty strings where a legacy row has no value. This mirrors the
 * §5.3 capture (`character-capture.ts`) for the rows that capture never touches (inactive legacy
 * rows, rows created before versioning); unlike the capture it produces a *draft* and is allowed to
 * be invalid — unreadable legacy content is exactly why the operator needs an editable baseline.
 */
export function characterFirstDraftPayload(
  character: CharacterRow,
  prompt: CharacterPromptRow | null,
): CharacterDraft {
  const questions: Record<string, unknown> = isPayloadObject(character.starterQuestions) ? character.starterQuestions : {};
  return {
    name: displayText(character.name),
    avatarUrl: displayText(character.avatarUrl),
    identity: displayText(character.identity),
    description: displayText(character.description),
    scriptId: character.scriptId ?? null,
    initialRelationship: displayText(character.initialRelationship),
    agentId: displayText(character.agentId),
    sortOrder: character.sortOrder,
    starterQuestions: {
      script: displayQuestions(questions.script),
      free: displayQuestions(questions.free),
    },
    prompt: {
      systemPrompt: displayText(prompt?.systemPrompt),
      personalityPrompt: displayText(prompt?.personalityPrompt),
      scenarioPrompt: displayText(prompt?.scenarioPrompt),
      safetyPrompt: displayText(prompt?.safetyPrompt),
      outputFormatPrompt: displayText(prompt?.outputFormatPrompt),
    },
  };
}

function toVersionState(version: ContentVersionRow): CharacterVersionState {
  const state = payloadState(version.payload);
  return {
    versionId: version.id,
    versionNo: version.versionNo,
    updatedAt: version.createdAt,
    payload: state.payload,
    validity: state.validity,
  };
}

/**
 * The runtime prerequisite the turn pin enforces (`model_profile_unavailable`): an enabled model
 * tier with a published model-profile version. Database-wide, not per character, and read-only.
 */
export async function getCharacterPublishPreflight(): Promise<CharacterPublishPreflight> {
  const [row] = await db
    .select({ readyModelTiers: sql<number>`count(distinct ${modelProfileVersions.profileId})::int` })
    .from(modelProfileVersions)
    .innerJoin(modelProfiles, eq(modelProfiles.id, modelProfileVersions.profileId))
    .where(and(eq(modelProfiles.enabled, true), eq(modelProfileVersions.status, 'published')));
  const readyModelTiers = Number(row?.readyModelTiers ?? 0);
  const ready = readyModelTiers > 0;
  return {
    readyModelTiers,
    ready,
    warning: ready ? null : MODEL_PROFILE_PREFLIGHT_WARNING,
  };
}

/** Minimal character reference for pages that only need a name (session filter summary). */
export async function getCharacterSummary(id: string): Promise<{ id: string; name: string; status: 'active' | 'inactive' } | null> {
  const [row] = await db
    .select({ id: characters.id, name: characters.name, status: characters.status })
    .from(characters)
    .where(eq(characters.id, id))
    .limit(1);
  return row ?? null;
}

function promptOf(payload: PromptDraft) {
  return {
    systemPrompt: payload.systemPrompt,
    personalityPrompt: payload.personalityPrompt,
    scenarioPrompt: payload.scenarioPrompt,
    safetyPrompt: payload.safetyPrompt,
    outputFormatPrompt: payload.outputFormatPrompt,
  };
}

/** Draft versions never carry the server-derived script snapshot; only the activation does. */
function draftPayload(payload: CharacterDraft): CharacterDraft {
  const draft: CharacterDraft = { ...payload };
  delete draft.scriptSnapshot;
  return draft;
}

function flattenDraft(payload: unknown): Map<string, string> {
  const flat = new Map<string, string>();
  if (!isPayloadObject(payload)) return flat;
  for (const field of DRAFT_FIELDS) {
    const value = payload[field];
    if (NESTED_DIFF_FIELDS.includes(field) && isPayloadObject(value)) {
      for (const [nested, nestedValue] of Object.entries(value)) {
        flat.set(`${field}.${nested}`, JSON.stringify(nestedValue ?? null));
      }
    } else {
      flat.set(field, JSON.stringify(value ?? null));
    }
  }
  return flat;
}

/** Changed field names (dotted for nested persona/starter-question entries) only. */
function changedDraftFields(draft: unknown, base: unknown): string[] {
  const left = flattenDraft(draft);
  const right = flattenDraft(base);
  const names = new Set([...left.keys(), ...right.keys()]);
  return [...names].filter(name => left.get(name) !== right.get(name)).sort();
}

function assertKnownPatch(patch: Partial<CharacterDraft>) {
  const unknown = Object.keys(patch).filter(key => !(DRAFT_FIELDS as ReadonlyArray<string>).includes(key));
  if (unknown.length > 0) throw new ValidationError(`character_patch_unknown_field: ${unknown.join(',')}`);
}

async function assertScriptBinding(tx: CharacterTransactionClient, scriptId: string | null) {
  if (!scriptId) return;
  const [script] = await tx.select({ id: scripts.id }).from(scripts).where(eq(scripts.id, scriptId)).limit(1);
  if (!script) throw new ValidationError('character_script_not_found');
}

async function assertPublishable(tx: CharacterTransactionClient, payload: CharacterDraft) {
  if (!ROLEPLAY_AGENT_IDS.includes(payload.agentId)) throw new ValidationError('character_agent_unavailable');
  if (!payload.scriptId) return null;
  const [script] = await tx
    .select({ status: scripts.status, title: scripts.title, worldSetting: scripts.worldSetting })
    .from(scripts)
    .where(eq(scripts.id, payload.scriptId))
    .limit(1);
  if (!script) throw new ValidationError('character_script_not_found');
  if (script.status !== 'active') throw new ValidationError('character_script_unavailable');
  // The exact script card the published content version freezes for this turn (§5.1).
  return { title: script.title, worldSetting: script.worldSetting };
}

async function legacyDraftBase(tx: CharacterTransactionClient, character: CharacterRow) {
  const [prompt] = await tx.select().from(characterPrompts).where(eq(characterPrompts.characterId, character.id)).limit(1);
  return {
    ...character,
    prompt: prompt ? promptOf({
      systemPrompt: prompt.systemPrompt,
      personalityPrompt: prompt.personalityPrompt ?? '',
      scenarioPrompt: prompt.scenarioPrompt ?? '',
      safetyPrompt: prompt.safetyPrompt ?? '',
      outputFormatPrompt: prompt.outputFormatPrompt ?? '',
    }) : {},
  };
}

function toRecord(character: CharacterRow, version: ContentVersionRow, payload: CharacterDraft): AdminCharacterRecord {
  return {
    id: character.id,
    versionId: version.id,
    versionNo: version.versionNo,
    updatedAt: version.createdAt,
    status: character.status,
    publishedVersionId: character.publishedVersionId,
    payload,
  };
}

export const ADMIN_CHARACTER_STATUSES: readonly AdminCharacterStatus[] = ['active', 'inactive'];
export const ADMIN_CHARACTER_STATUS_INVALID = '角色发布状态只能是已上架或未上架';

type CharacterPageRow = { character: CharacterRow; prompt: CharacterPromptRow | null };
type VersionFacts = { id: string; versionNo: number; status: string; payload: unknown };

/**
 * The page itself: the display row plus the legacy prompt row. Nothing else is joined here, so
 * `LIMIT`/`OFFSET` bound the statement (a join would make the planner build the whole matched set
 * before the limit).
 */
function characterPageQuery() {
  return db
    .select({ character: characters, prompt: characterPrompts })
    .from(characters)
    .leftJoin(characterPrompts, eq(characterPrompts.characterId, characters.id));
}

/** The published version each row's pointer names: primary-key lookups, at most one per page row. */
async function publishedVersionsOf(rows: CharacterPageRow[]): Promise<Map<string, VersionFacts>> {
  const pointerIds = rows
    .map(row => row.character.publishedVersionId)
    .filter((id): id is string => Boolean(id));
  if (pointerIds.length === 0) return new Map();
  const versions = await db
    .select({
      id: contentVersions.id,
      entityId: contentVersions.entityId,
      versionNo: contentVersions.versionNo,
      status: contentVersions.status,
      payload: contentVersions.payload,
    })
    .from(contentVersions)
    .where(and(eq(contentVersions.entityType, 'character'), inArray(contentVersions.id, pointerIds)));
  // Keyed by character, and only when the version really belongs to that character: a corrupted
  // pointer then reports `线上版本缺失` instead of another character's payload.
  const byPointer = new Map(rows.map(row => [row.character.publishedVersionId, row.character.id]));
  return new Map(versions
    .filter(version => byPointer.get(version.id) === version.entityId)
    .map(version => [version.entityId, version]));
}

/**
 * The newest version per page row, as one `DISTINCT ON (entity_id)` read: one row per character even
 * though every save leaves a version behind. `content_versions_entity_version_unique` serves the
 * per-entity ordering, so this is not a scan of the whole version history.
 */
async function newestVersionsOf(ids: string[]): Promise<Map<string, VersionFacts>> {
  if (ids.length === 0) return new Map();
  const versions = await db
    .selectDistinctOn([contentVersions.entityId], {
      id: contentVersions.id,
      entityId: contentVersions.entityId,
      versionNo: contentVersions.versionNo,
      status: contentVersions.status,
      payload: contentVersions.payload,
    })
    .from(contentVersions)
    .where(and(eq(contentVersions.entityType, 'character'), inArray(contentVersions.entityId, ids)))
    .orderBy(contentVersions.entityId, desc(contentVersions.versionNo));
  return new Map(versions.map(version => [version.entityId, version]));
}

/**
 * One term matches name substring, agent-id substring or bound-script-title substring. LIKE
 * metacharacters in the operator's term are escaped, so `100%` matches a literal percent sign. The
 * script title is an EXISTS instead of a join so a character never appears twice, and scripts that are
 * not bound to this row cannot match it.
 */
function characterSearchCondition(term: string) {
  const pattern = `%${escapeLikeTerm(term)}%`;
  return or(
    ilike(characters.name, pattern),
    ilike(characters.agentId, pattern),
    sql`exists (select 1 from "scripts" "s" where "s"."id" = "characters"."script_id" and "s"."title" ilike ${pattern})`,
  )!;
}

function characterListWhere(filters: AdminCharacterListFilters) {
  const conditions = [];
  const term = filters.query?.trim();
  if (term) conditions.push(characterSearchCondition(term));
  if (filters.status) {
    if (!ADMIN_CHARACTER_STATUSES.includes(filters.status)) throw new ValidationError(ADMIN_CHARACTER_STATUS_INVALID);
    conditions.push(eq(characters.status, filters.status));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * The last publish task per character, as one `DISTINCT ON (entity_id)` read for exactly the page's
 * ids: one row per character, so a task history that grows with every publish never widens the page.
 */
async function lastPublishTaskOf(
  ids: string[],
): Promise<Map<string, Pick<PublishTaskRow, 'id' | 'entityId' | 'versionId' | 'status' | 'recoveryState' | 'lastError' | 'createdAt' | 'updatedAt'>>> {
  if (ids.length === 0) return new Map();
  const tasks = await db
    .selectDistinctOn([publishTasks.entityId], {
      id: publishTasks.id,
      entityId: publishTasks.entityId,
      versionId: publishTasks.versionId,
      status: publishTasks.status,
      recoveryState: publishTasks.recoveryState,
      lastError: publishTasks.lastError,
      createdAt: publishTasks.createdAt,
      updatedAt: publishTasks.updatedAt,
    })
    .from(publishTasks)
    .where(and(eq(publishTasks.entityType, 'character'), inArray(publishTasks.entityId, ids)))
    .orderBy(publishTasks.entityId, desc(publishTasks.createdAt), desc(publishTasks.id));
  return new Map(tasks.map(task => [task.entityId, task]));
}

/**
 * The list shape from the page rows. Both `listAdminCharacters` (a bounded page) and
 * `loadCharacterListItem` (one character) go through here, so the three separate states — publish
 * status, draft divergence, last publish task — cannot drift apart between the list and the
 * single-character pages.
 *
 * Each of the three per-row facts is one keyed read for *all* page rows (published version by
 * pointer, newest version, last task), so the statement count is constant and no character is read
 * on its own (no N+1).
 */
async function assembleCharacterItems(
  rows: CharacterPageRow[],
  facts: { published: Map<string, VersionFacts>; newest: Map<string, VersionFacts> },
): Promise<AdminCharacterListItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map(row => row.character.id);
  const lastTask = await lastPublishTaskOf(ids);

  return rows.map(({ character, prompt }) => {
    const live = facts.published.get(character.id) ?? null;
    const newest = facts.newest.get(character.id) ?? null;
    const task = lastTask.get(character.id);
    const hasDraft = newest?.status === 'draft';
    return {
      character,
      prompt,
      publishState: {
        status: character.status,
        publishedVersionId: live?.id ?? null,
        publishedVersionNo: live?.versionNo ?? null,
      },
      draftState: {
        hasDraft,
        draftVersionId: hasDraft ? newest!.id : null,
        draftVersionNo: hasDraft ? newest!.versionNo : null,
        changedFields: hasDraft ? changedDraftFields(newest!.payload, live?.payload ?? null) : [],
      },
      // Already-loaded payload, validated in process: no extra read per published character.
      publishedValidity: live ? payloadState(live.payload).validity : null,
      lastPublishTask: task
        ? {
          id: task.id,
          versionId: task.versionId,
          status: task.status,
          recoveryState: task.recoveryState,
          lastError: task.lastError,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        }
        : null,
    };
  });
}

/**
 * One bounded page of the character list (§4.2 display order, AC-18): a count statement plus a page
 * statement, never a full-table assembly. Ordering is `sort_order, name, id`, so a page cannot
 * reorder between reads and equal sort values keep a stable position.
 *
 * Statement count for a page: **5** with rows (page, count, published versions, newest versions, last
 * tasks), **2** when the page is empty. Every one of them is bounded by `pageSize`, so the count does
 * not grow with the table or with how much version/task history a character has.
 */
export async function listAdminCharacters(
  params: PaginationParams & AdminCharacterListFilters = {},
): Promise<PaginatedResult<AdminCharacterListItem>> {
  const { page, pageSize, offset } = normalizePagination(params);
  const where = characterListWhere(params);

  const [rows, totalRow] = await Promise.all([
    characterPageQuery()
      .where(where)
      // Managed display order (§4.2 排序): sortOrder first, then a stable tiebreaker for equal values.
      .orderBy(characters.sortOrder, characters.name, characters.id)
      .limit(pageSize)
      .offset(offset),
    db.select({ total: count() }).from(characters).where(where),
  ]);

  const ids = rows.map(row => row.character.id);
  const [published, newest] = await Promise.all([publishedVersionsOf(rows), newestVersionsOf(ids)]);
  return {
    items: await assembleCharacterItems(rows, { published, newest }),
    total: totalRow[0]?.total ?? 0,
    page,
    pageSize,
  };
}

/**
 * One character, the same shape as its list row: the detail route and both single-character pages
 * read exactly one character instead of loading (and re-validating) every character's versions.
 */
export async function loadCharacterListItem(id: string): Promise<AdminCharacterListItem | null> {
  const [row] = await characterPageQuery().where(eq(characters.id, id)).limit(1);
  if (!row) return null;
  const [published, newest] = await Promise.all([publishedVersionsOf([row]), newestVersionsOf([row.character.id])]);
  const [item] = await assembleCharacterItems([row], { published, newest });
  return item ?? null;
}

/**
 * The editor's single read: both stored payloads (persona included), the validity of each and the
 * exact baseline a save must carry. The baseline is the newest draft when one exists, otherwise the
 * published version; a save on a stale baseline is still the documented 409, never a silent write.
 */
export async function getCharacterEditState(id: string): Promise<CharacterEditState> {
  const [character] = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  if (!character) throw new NotFoundError('Character');
  const [latest] = await db
    .select()
    .from(contentVersions)
    .where(and(eq(contentVersions.entityType, 'character'), eq(contentVersions.entityId, id)))
    .orderBy(desc(contentVersions.versionNo))
    .limit(1);
  const [publishedRow] = character.publishedVersionId
    ? await db.select().from(contentVersions).where(eq(contentVersions.id, character.publishedVersionId)).limit(1)
    : [];
  const draftRow = latest?.status === 'draft' ? latest : undefined;
  const published = publishedRow ? toVersionState(publishedRow) : null;
  const draft = draftRow ? toVersionState(draftRow) : null;
  return {
    preflight: await getCharacterPublishPreflight(),
    characterId: character.id,
    status: character.status,
    agentId: character.agentId,
    scriptId: character.scriptId,
    sortOrder: character.sortOrder,
    published,
    draft,
    editable: draft
      ? { versionId: draft.versionId, versionNo: draft.versionNo, updatedAt: draft.updatedAt, source: 'draft' }
      : published
        ? { versionId: published.versionId, versionNo: published.versionNo, updatedAt: published.updatedAt, source: 'published' }
        : null,
    changedFields: draftRow ? changedDraftFields(draftRow.payload, publishedRow?.payload ?? null) : [],
  };
}

/** Published version lookup for the exact pointer a chat turn must read (step B/C read helper). */
export async function getPublishedCharacterVersion(id: string): Promise<{ character: CharacterRow; version: ContentVersionRow } | null> {
  const [row] = await db
    .select({ character: characters, version: contentVersions })
    .from(characters)
    .innerJoin(contentVersions, eq(contentVersions.id, characters.publishedVersionId))
    .where(eq(characters.id, id))
    .limit(1);
  return row ?? null;
}

/** Draft-versus-published divergence as changed field names only. */
export async function getCharacterDraftDiff(id: string): Promise<CharacterDraftDiff> {
  const [character] = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  if (!character) throw new NotFoundError('Character');
  const [latest] = await db
    .select()
    .from(contentVersions)
    .where(and(eq(contentVersions.entityType, 'character'), eq(contentVersions.entityId, id)))
    .orderBy(desc(contentVersions.versionNo))
    .limit(1);
  const published = character.publishedVersionId
    ? (await db.select().from(contentVersions).where(eq(contentVersions.id, character.publishedVersionId)).limit(1))[0]
    : undefined;
  const hasDraft = latest?.status === 'draft';
  return {
    characterId: id,
    draftVersionId: hasDraft ? latest!.id : null,
    draftVersionNo: hasDraft ? latest!.versionNo : null,
    publishedVersionId: published?.id ?? null,
    changedFields: hasDraft ? changedDraftFields(latest!.payload, published?.payload ?? null) : [],
  };
}

/** One immutable version of exactly this character, or the documented 404. */
async function versionOfCharacter(characterId: string, versionId: string): Promise<ContentVersionRow> {
  const [version] = await db
    .select()
    .from(contentVersions)
    .where(and(
      eq(contentVersions.id, versionId),
      eq(contentVersions.entityType, 'character'),
      eq(contentVersions.entityId, characterId),
    ))
    .limit(1);
  if (!version) throw new NotFoundError('Character version');
  return version;
}

/**
 * Default preview target: the newest draft (the version a publish would activate), otherwise the
 * published version. Only a character with neither has nothing to preview.
 */
async function defaultPreviewVersion(character: CharacterRow): Promise<ContentVersionRow> {
  const [draft] = await db
    .select()
    .from(contentVersions)
    .where(and(
      eq(contentVersions.entityType, 'character'),
      eq(contentVersions.entityId, character.id),
      eq(contentVersions.status, 'draft'),
    ))
    .orderBy(desc(contentVersions.versionNo))
    .limit(1);
  if (draft) return draft;
  if (character.publishedVersionId) {
    const [published] = await db
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.id, character.publishedVersionId))
      .limit(1);
    if (published) return published;
  }
  // Says which two things are absent, instead of claiming a published version is missing.
  throw new NotFoundError('Character draft or published version');
}

/**
 * Display-only preview (script card, character detail, starter questions) taken from an immutable
 * version payload. No chat, generation or trial conversation is involved.
 *
 * The default target is the version the operator is working on: the newest draft when one exists,
 * otherwise the published version. A draft-only character — for instance one just created — is
 * exactly the case this surface exists for, so it must preview rather than answer 404. An explicit
 * `versionId` keeps its meaning: that one version, nothing else.
 */
export async function getCharacterPreview(id: string, versionId?: string): Promise<CharacterPreview> {
  const [character] = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  if (!character) throw new NotFoundError('Character');
  const version = versionId
    ? await versionOfCharacter(character.id, versionId)
    : await defaultPreviewVersion(character);
  // Preview is display-only: captured legacy content is shown as stored, publish stays strict.
  const state = payloadState(version.payload);
  const payload = state.payload;
  const script = payload.scriptId
    ? (await db
      .select({ id: scripts.id, title: scripts.title, slug: scripts.slug, coverUrl: scripts.coverUrl, status: scripts.status })
      .from(scripts)
      .where(eq(scripts.id, payload.scriptId))
      .limit(1))[0] ?? null
    : null;
  return {
    preflight: await getCharacterPublishPreflight(),
    characterId: character.id,
    versionId: version.id,
    versionNo: version.versionNo,
    versionStatus: version.status,
    isPublished: character.publishedVersionId === version.id && version.status === 'published',
    card: {
      name: payload.name,
      avatarUrl: payload.avatarUrl,
      identity: payload.identity,
      description: payload.description,
    },
    detail: {
      name: payload.name,
      avatarUrl: payload.avatarUrl,
      identity: payload.identity,
      description: payload.description,
      initialRelationship: payload.initialRelationship,
      scriptId: payload.scriptId ?? null,
    },
    starterQuestions: payload.starterQuestions,
    availableModes: payload.scriptId ? ['script', 'free'] : ['free'],
    script,
    scriptSnapshot: payload.scriptSnapshot ?? null,
    validity: state.validity,
  };
}

export async function createCharacterDraft(
  actor: IdentityAdminActor,
  input: CharacterDraft,
  requestId?: string,
): Promise<AdminCharacterRecord> {
  if (input.scriptSnapshot !== undefined && input.scriptSnapshot !== null) {
    // The script card is server-derived at publish; a client value would be unverifiable evidence.
    throw new ValidationError('character_script_snapshot_system_owned');
  }
  const draft = draftPayload(validateCharacterDraft(input));
  if (!ROLEPLAY_AGENT_IDS.includes(draft.agentId)) {
    // Routing ids come from the versioned agent contract; an operator cannot invent one (§5.2/§8).
    throw new ValidationError('character_agent_unavailable');
  }
  return db.transaction(async (tx) => {
    await assertScriptBinding(tx, draft.scriptId ?? null);
    const [character] = await tx.insert(characters).values({
      name: draft.name,
      avatarUrl: draft.avatarUrl,
      identity: draft.identity,
      description: draft.description,
      scriptId: draft.scriptId ?? null,
      initialRelationship: draft.initialRelationship,
      agentId: draft.agentId,
      starterQuestions: draft.starterQuestions,
      sortOrder: draft.sortOrder ?? 0,
      status: 'inactive',
    }).returning();
    if (!character) throw new Error('character_create_failed');
    const [version] = await tx.insert(contentVersions).values({
      entityType: 'character',
      entityId: character.id,
      versionNo: 1,
      status: 'draft',
      contentHash: hashContentPayload(draft),
      payload: draft,
      ...creatorColumns(actor),
    }).returning();
    if (!version) throw new Error('character_draft_create_failed');
    await recordAdminAuditInTransaction(tx, {
      actor,
      action: 'admin.character.draft.create',
      objectType: 'character',
      objectId: character.id,
      requestId,
      result: 'committed',
      summary: { versionId: version.id, versionNo: version.versionNo },
    });
    return toRecord(character, version, draft);
  });
}

/**
 * Explicit operator action for an existing character that has **no content version at all**: an
 * inactive legacy row (the §5.3 capture only tames `status='active'`) or any row created before
 * versioning. Without it that character can never be edited, completed or published —
 * `publishCharacter` requires a draft, and its one-time agent assignment is unreachable too.
 *
 * The draft is seeded from the stored row plus its `character_prompts` row. Validation is only used
 * to store an already-complete seed canonically; an unreadable legacy payload is stored verbatim and
 * is exactly what the operator has to open and repair. Nothing is written on page load — only this
 * action writes, and it writes exactly once.
 */
export async function createFirstCharacterDraft(
  actor: IdentityAdminActor,
  id: string,
  requestId?: string,
): Promise<CharacterFirstDraftRecord> {
  try {
    return await db.transaction(async (tx) => {
      // The character row is the serialization point every other version writer already locks, so
      // two concurrent calls cannot both observe "no version" and insert version 1 twice.
      const [character] = await tx
        .select()
        .from(characters)
        .where(eq(characters.id, id))
        .limit(1)
        .for('update');
      if (!character) throw new NotFoundError('Character');
      const versions = await tx
        .select({ versionNo: contentVersions.versionNo, status: contentVersions.status })
        .from(contentVersions)
        .where(and(eq(contentVersions.entityType, 'character'), eq(contentVersions.entityId, id)))
        .orderBy(desc(contentVersions.versionNo));
      // An existing draft or published version already IS an editable baseline: this action would
      // only duplicate it, so it answers the documented 409 instead of a second "first" version.
      const hasBaseline = versions.some(version => version.status === 'draft' || version.status === 'published');
      if (hasBaseline) throw new ConflictError('character_first_draft_exists');
      const [prompt] = await tx
        .select()
        .from(characterPrompts)
        .where(eq(characterPrompts.characterId, id))
        .limit(1);
      const seeded = characterFirstDraftPayload(character, prompt ?? null);
      const state = payloadState(seeded);
      // A seed that already validates is stored canonically, so publishing it needs no extra save
      // (publish re-validates and compares the hash); an invalid seed is stored verbatim.
      const draft = state.validity.valid ? draftPayload(state.payload) : seeded;
      const [version] = await tx.insert(contentVersions).values({
        entityType: 'character',
        entityId: id,
        // A version-less character starts at 1; a chain that only kept superseded versions
        // continues instead of colliding with the unique (entity, entity_id, version_no) index.
        versionNo: (versions[0]?.versionNo ?? 0) + 1,
        status: 'draft',
        contentHash: hashContentPayload(draft),
        payload: draft,
        ...creatorColumns(actor),
      }).returning();
      if (!version) throw new Error('character_first_draft_create_failed');
      await recordAdminAuditInTransaction(tx, {
        actor,
        action: 'admin.character.first_draft.create',
        objectType: 'character',
        objectId: id,
        requestId,
        result: 'committed',
        summary: { versionId: version.id, versionNo: version.versionNo, seededFrom: 'character_rows' },
      });
      return {
        characterId: id,
        versionId: version.id,
        versionNo: version.versionNo,
        updatedAt: version.createdAt,
        validity: state.validity,
      };
    });
  } catch (error) {
    // Belt and braces for a writer that does not take the character lock (the §5.3 capture runs
    // inside the migration): the unique index stays the last word on "only one version 1".
    if ((error as { code?: string }).code === '23505') throw new ConflictError('character_first_draft_exists');
    throw error;
  }
}

/**
 * Every save inserts a new immutable version and supersedes the previous draft in one transaction.
 * The baseline is the latest version of this character; a mismatched baseline is a 409, never a
 * silent overwrite. Publishing or unpublishing does not invalidate an in-flight edit baseline.
 */
export async function updateCharacterDraft(
  actor: IdentityAdminActor,
  id: string,
  baseline: CharacterDraftBaseline,
  patch: Partial<CharacterDraft>,
  requestId?: string,
): Promise<AdminCharacterRecord> {
  assertKnownPatch(patch);
  return db.transaction(async (tx) => {
    const conflict = () => new ConflictError('character_draft_conflict');
    const [current] = await tx
      .select()
      .from(characters)
      .where(eq(characters.id, id))
      .limit(1)
      .for('update');
    if (!current) throw new NotFoundError('Character');
    const [latest] = await tx
      .select()
      .from(contentVersions)
      .where(and(eq(contentVersions.entityType, 'character'), eq(contentVersions.entityId, id)))
      .orderBy(desc(contentVersions.versionNo))
      .limit(1)
      .for('update');
    if ('versionId' in baseline) {
      if (!latest || latest.id !== baseline.versionId) throw conflict();
    } else {
      const baselineAt = latest ? latest.createdAt : current.updatedAt;
      if (baselineAt.toISOString() !== baseline.expectedUpdatedAt) throw conflict();
    }
    if (current.agentId !== null && patch.agentId !== undefined && patch.agentId !== current.agentId) {
      // The routing id is system-owned once assigned; a legacy row captured with `agent_id IS NULL`
      // may name one exactly once (see `publishCharacter`, which stores it on first activation).
      throw new ConflictError('character_agent_id_system_owned');
    }
    const base = latest && isPayloadObject(latest.payload)
      ? latest.payload
      : await legacyDraftBase(tx, current);
    // A published payload carries the server-derived script snapshot; drafts never keep it.
    const draft = draftPayload(validateCharacterDraft({ ...base, ...patch }));
    if (current.agentId && draft.agentId !== current.agentId) {
      throw new ConflictError('character_agent_id_system_owned');
    }
    if (current.publishedVersionId) {
      // A published character's script ownership is stable: re-binding it must create a new
      // character so historical user data is never inherited by another role.
      const [published] = await tx
        .select({ payload: contentVersions.payload })
        .from(contentVersions)
        .where(eq(contentVersions.id, current.publishedVersionId))
        .limit(1);
      const publishedScriptId = isPayloadObject(published?.payload) ? published.payload.scriptId ?? null : null;
      if ((draft.scriptId ?? null) !== publishedScriptId) {
        throw new ConflictError('character_script_change_requires_new_character');
      }
    }
    await assertScriptBinding(tx, draft.scriptId ?? null);
    await tx.update(contentVersions).set({ status: 'superseded', publishedAt: null }).where(and(
      eq(contentVersions.entityType, 'character'),
      eq(contentVersions.entityId, id),
      eq(contentVersions.status, 'draft'),
    ));
    const [version] = await tx.insert(contentVersions).values({
      entityType: 'character',
      entityId: id,
      versionNo: (latest?.versionNo ?? 0) + 1,
      status: 'draft',
      contentHash: hashContentPayload(draft),
      payload: draft,
      ...creatorColumns(actor),
    }).returning();
    if (!version) throw new Error('character_draft_create_failed');
    await recordAdminAuditInTransaction(tx, {
      actor,
      action: 'admin.character.draft.update',
      objectType: 'character',
      objectId: id,
      requestId,
      result: 'committed',
      summary: { changedFields: Object.keys(patch), versionId: version.id, versionNo: version.versionNo },
    });
    return toRecord(current, version, draft);
  });
}

/**
 * Publishes the exact bound version: one advisory-locked, idempotent task; display fields and the
 * published pointer switch in one transaction, so no reader observes a half-published character.
 * FastClaw console state is not part of success (PG is the only source of truth).
 *
 * Batch 3 step 1 (plan W): once the publish is committed, the three FastClaw base-context files are
 * REGENERATED from the published version and the result is recorded as an `agent_context_version`.
 * That step is deliberately outside the publish transaction and can never fail the publish — a
 * cross-system problem is reported as `baseContext.status` (`pending`/`failed`) with the previous
 * record kept, and the admin can rebuild on demand.
 */
export async function publishCharacter(
  actor: IdentityAdminActor,
  id: string,
  versionId: string,
  idempotencyKey: string,
  requestId?: string,
): Promise<{
  id: string;
  versionId: string;
  taskId: string;
  idempotencyKey: string;
  status: string;
  replayed: boolean;
  auditStatus: 'committed' | 'pending';
  baseContext: BaseContextSyncResult;
}> {
  const auditKey = `publish_character:${idempotencyKey}`;
  const published = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${idempotencyKey}))`);

    const [existingTask] = await tx
      .select()
      .from(publishTasks)
      .where(eq(publishTasks.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existingTask) {
      const [existingVersion] = await tx
        .select()
        .from(contentVersions)
        .where(eq(contentVersions.id, existingTask.versionId))
        .limit(1);
      if (existingTask.entityType !== 'character' || existingTask.entityId !== id ||
          existingTask.versionId !== versionId || !existingVersion ||
          existingVersion.entityType !== 'character' || existingVersion.entityId !== id ||
          !matchesIdentityActor(actor, existingTask.createdBy, existingTask.createdByAdminAccountId) ||
          existingTask.desiredHash !== desiredPublishHash('character', id, existingVersion.id, existingVersion.contentHash)) {
        throw new ConflictError('character_publish_conflict');
      }
      return { task: existingTask, replayed: true };
    }

    const [character] = await tx
      .select()
      .from(characters)
      .where(eq(characters.id, id))
      .limit(1)
      .for('update');
    if (!character) throw new NotFoundError('Character');
    const [version] = await tx
      .select()
      .from(contentVersions)
      .where(and(
        eq(contentVersions.id, versionId),
        eq(contentVersions.entityType, 'character'),
        eq(contentVersions.entityId, id),
      ))
      .limit(1)
      .for('update');
    if (!version) throw new NotFoundError('Character version');
    // Whether this version can be activated at all is decided by its state, so that question is
    // answered before canonical validation: a live version that no longer validates is still
    // `character_version_already_published` (409), not a payload error that hides the real conflict.
    const reactivating = version.status === 'published' &&
      character.publishedVersionId === version.id && character.status === 'inactive';
    if (version.status !== 'draft' && !reactivating) {
      throw new ConflictError(version.status === 'published'
        ? 'character_version_already_published'
        : 'character_version_not_publishable');
    }
    // Canonical re-validation keeps the hash independent of jsonb key ordering.
    const payload = validateCharacterDraft(version.payload);
    // A version that is already published was integrity-checked and frozen when it was first
    // activated (tamed legacy versions carry a database-computed hash), so only a draft must still
    // match its stored hash; reactivation after unpublish keeps working without rewriting it.
    if (version.status !== 'published' && version.contentHash !== hashContentPayload(payload)) {
      throw new ConflictError('character_version_hash_mismatch');
    }
    if (character.agentId !== null && character.agentId !== payload.agentId) {
      throw new ConflictError('character_agent_id_system_owned');
    }
    const scriptSnapshot = await assertPublishable(tx, payload);
    // Server-derived script card captured inside this transaction; the client cannot supply it.
    const publishedPayload: CharacterDraft = scriptSnapshot ? { ...payload, scriptSnapshot } : payload;
    const publishedHash = hashContentPayload(publishedPayload);
    // A reactivated version stays immutable: it keeps the payload and hash frozen by its first
    // activation, so history that pins this version never changes retroactively.
    const activationHash = reactivating ? version.contentHash : publishedHash;

    const now = new Date();
    const desiredHash = desiredPublishHash('character', id, version.id, activationHash);
    const [task] = await tx.insert(publishTasks).values({
      idempotencyKey,
      entityType: 'character',
      entityId: id,
      versionId: version.id,
      status: 'processing',
      desiredHash,
      recoveryState: 'audit_pending',
      ...creatorColumns(actor),
      updatedAt: now,
    }).returning();
    if (!task) throw new Error('publish_task_create_failed');

    await tx.update(characters).set({
      name: payload.name,
      avatarUrl: payload.avatarUrl,
      identity: payload.identity,
      description: payload.description,
      scriptId: payload.scriptId ?? null,
      initialRelationship: payload.initialRelationship,
      starterQuestions: payload.starterQuestions,
      // Omission keeps the current value instead of resetting the managed order.
      sortOrder: payload.sortOrder ?? character.sortOrder,
      // The first activation of a legacy character with no routing id stores the id this draft
      // named; from then on it is system-owned and immutable.
      agentId: character.agentId ?? payload.agentId,
      status: 'active',
      publishedVersionId: version.id,
      updatedAt: now,
    }).where(eq(characters.id, id));
    const promptValues = promptOf(payload.prompt);
    const [existingPrompt] = await tx
      .select({ id: characterPrompts.id })
      .from(characterPrompts)
      .where(eq(characterPrompts.characterId, id))
      .limit(1)
      .for('update');
    if (existingPrompt) {
      await tx.update(characterPrompts).set({ ...promptValues, updatedAt: now }).where(eq(characterPrompts.id, existingPrompt.id));
    } else {
      await tx.insert(characterPrompts).values({ characterId: id, ...promptValues, updatedAt: now });
    }
    await tx.update(contentVersions).set({
      status: 'superseded',
      publishedAt: null,
    }).where(and(
      eq(contentVersions.entityType, 'character'),
      eq(contentVersions.entityId, id),
      eq(contentVersions.status, 'published'),
      ne(contentVersions.id, version.id),
    ));
    await tx.update(contentVersions).set({
      status: 'published',
      publishedAt: now,
      // A first activation freezes the server-derived snapshot into the immutable published
      // payload; reactivation keeps what the first activation froze.
      ...(reactivating ? {} : { payload: publishedPayload, contentHash: publishedHash }),
    }).where(eq(contentVersions.id, version.id));
    const [committedTask] = await tx.update(publishTasks).set({
      status: 'committed',
      appliedHash: desiredHash,
      recoveryState: 'audit_pending',
      updatedAt: now,
    }).where(eq(publishTasks.id, task.id)).returning();
    if (!committedTask) throw new Error('publish_task_commit_failed');

    await recordAdminAuditInTransaction(tx, {
      actor,
      action: 'admin.character.publish',
      objectType: 'character',
      objectId: id,
      requestId,
      taskId: task.id,
      dedupeKey: auditKey,
      result: 'audit_pending',
      summary: { versionId: version.id, versionNo: version.versionNo, desiredHash },
    });
    return { task: committedTask, replayed: false };
  });

  return {
    id: published.task.entityId,
    versionId: published.task.versionId,
    taskId: published.task.id,
    idempotencyKey,
    status: published.task.status,
    replayed: published.replayed,
    auditStatus: await settlePublishAudit(auditKey, published.task),
    baseContext: await syncBaseContextAfterPublish(actor, published.task.entityId),
  };
}

/**
 * Publish-time base-context sync, isolated from the publish outcome: any failure (FastClaw down, write
 * rejected, record unwritable) is returned as a visible status and never thrown. A replayed publish is
 * synced again on purpose — that is the safe way to repair an earlier `pending`/`failed` sync.
 */
async function syncBaseContextAfterPublish(
  actor: IdentityAdminActor,
  characterId: string,
): Promise<BaseContextSyncResult> {
  try {
    return await syncCharacterBaseContext({
      characterId,
      source: 'publish',
      capturedByAdminAccountId: actor.kind === 'admin_account' ? actor.adminAccountId : null,
    });
  } catch {
    return {
      characterId,
      agentId: null,
      status: 'failed',
      reason: 'base_context_sync_error',
      written: false,
      version: null,
    };
  }
}

/** Relocks the audit intent and appends one recovery event under the current actor. */
export async function finalizeCharacterPublishAudit(
  actor: IdentityAdminActor,
  idempotencyKey: string,
  requestId?: string,
): Promise<{ taskId: string; versionId: string; alreadyFinalized: boolean }> {
  let bound: { taskId: string; versionId: string } | undefined;
  const outcome = await finalizePendingAdminAudit(actor, {
    dedupeKey: `publish_character:${idempotencyKey}`,
    action: 'admin.character.publish',
    objectType: 'character',
    requestId,
    recovery: {
      action: 'admin.character.publish.finalize_audit',
      objectType: 'character',
      dedupeKeyPrefix: 'publish_character_audit_recovery',
    },
    verify: async (tx, audit) => {
      const conflict = () => new ConflictError('character_publish_audit_conflict');
      const [task] = await tx
        .select()
        .from(publishTasks)
        .where(eq(publishTasks.idempotencyKey, idempotencyKey))
        .limit(1)
        .for('update');
      if (!task || task.entityType !== 'character' || task.entityId !== audit.objectId) throw conflict();
      const [version] = await tx
        .select()
        .from(contentVersions)
        .where(eq(contentVersions.id, task.versionId))
        .limit(1);
      if (!version || version.entityType !== 'character' || version.entityId !== task.entityId) throw conflict();
      const summary = audit.summary as Record<string, unknown> | null;
      if (!summary || task.status !== 'committed' || task.appliedHash !== task.desiredHash ||
          summary.versionId !== version.id || summary.versionNo !== version.versionNo ||
          summary.desiredHash !== task.desiredHash ||
          task.desiredHash !== desiredPublishHash('character', task.entityId, version.id, version.contentHash)) {
        throw conflict();
      }
      await tx.update(publishTasks).set({
        recoveryState: null,
        lastError: null,
        updatedAt: new Date(),
      }).where(eq(publishTasks.id, task.id));
      bound = { taskId: task.id, versionId: version.id };
      return { objectId: task.entityId, summary: { originalAuditId: audit.id, taskId: task.id, versionId: version.id } };
    },
  });
  if (!bound) throw new ConflictError('character_publish_audit_conflict');
  return { ...bound, alreadyFinalized: outcome.alreadyFinalized };
}

/**
 * Removes public visibility and new-session eligibility only. Versions, the published pointer,
 * publish tasks and audit history stay intact; no user data is touched.
 */
export async function unpublishCharacter(
  actor: IdentityAdminActor,
  id: string,
  requestId?: string,
): Promise<{
  id: string;
  status: 'inactive';
  publishedVersionId: string | null;
  changed: boolean;
  auditStatus: 'committed' | 'not_required';
}> {
  return db.transaction(async (tx) => {
    const [character] = await tx
      .select()
      .from(characters)
      .where(eq(characters.id, id))
      .limit(1)
      .for('update');
    if (!character) throw new NotFoundError('Character');
    if (character.status === 'inactive') {
      return {
        id: character.id,
        status: 'inactive' as const,
        publishedVersionId: character.publishedVersionId,
        changed: false,
        auditStatus: 'not_required' as const,
      };
    }
    await tx.update(characters).set({ status: 'inactive', updatedAt: new Date() }).where(eq(characters.id, id));
    await recordAdminAuditInTransaction(tx, {
      actor,
      action: 'admin.character.unpublish',
      objectType: 'character',
      objectId: id,
      requestId,
      result: 'committed',
      summary: { publishedVersionId: character.publishedVersionId },
    });
    return {
      id: character.id,
      status: 'inactive' as const,
      publishedVersionId: character.publishedVersionId,
      changed: true,
      auditStatus: 'committed' as const,
    };
  });
}
