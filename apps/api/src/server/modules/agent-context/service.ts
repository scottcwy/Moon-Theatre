import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { agentContextVersions, characters, contentVersions } from '../../db/schema.js';
import { NotFoundError } from '../../http/error-types.js';
import { recordAdminAudit, type IdentityAdminActor } from '../admin/audit.js';
import {
  isFastClawConfiguredForSystemFiles,
  readRoleSystemFiles,
  writeAgentSystemFile,
  type FastClawSystemFileFailure,
} from '../fastclaw/system-files.js';
import {
  ROLE_SYSTEM_FILES,
  hashRoleFiles,
  renderPublishedAgentContext,
  type RenderedAgentContext,
  type RoleSystemFile,
} from './render.js';

/**
 * Batch 3 step 1 (plan W) — the published PG version owns the persona; the FastClaw base context
 * (SOUL.md / IDENTITY.md / USER.md) is a DERIVED, versioned cache of it.
 *
 * Two facts are kept separate on purpose, because they can disagree:
 *  - `agent_context_versions` records what was written to FastClaw and from which published version
 *    (immutable, hash-deduped, never rewritten);
 *  - the live FastClaw files are what the runtime actually reads, and an operator can still hand-edit
 *    them in the FastClaw console. Publish/rebuild overwrite such an edit; the drift read detects it
 *    in between and reports it instead of pretending the systems are in sync.
 *
 * FastClaw's context assembly is untouched: a turn still gets SOUL/IDENTITY/USER + memory + guards.
 */
export type AgentContextSource = 'publish' | 'manual' | 'startup';

/** Visible outcome of a publish-time or manual sync. Never a claim of success by omission. */
export type BaseContextStatus = 'synced' | 'pending' | 'unchanged' | 'failed';

export type BaseContextDriftStatus = 'in-sync' | 'drifted' | 'unavailable' | 'unrecorded';

export interface AgentContextVersionView {
  id: string;
  agentId: string;
  /** Per-agent display ordinal (`b#`): 1 for the first recorded context of that agent. */
  displayNo: number;
  contentHash: string;
  source: AgentContextSource;
  capturedByAdminAccountId: string | null;
  contentVersionId: string | null;
  contentVersionNo: number | null;
  createdAt: Date;
}

export interface BaseContextSyncResult {
  characterId: string;
  agentId: string | null;
  status: BaseContextStatus;
  /** Machine reason for `pending`/`failed` (a FastClaw failure code or a local one). */
  reason: string | null;
  /** True only when the three files were actually written to FastClaw by this call. */
  written: boolean;
  version: AgentContextVersionView | null;
}

export interface CharacterBaseContext {
  characterId: string;
  agentId: string | null;
  status: BaseContextDriftStatus;
  recorded: AgentContextVersionView | null;
  /** Live FastClaw files, hashed. `readable: false` means "could not look", never "in sync". */
  live: { readable: boolean; contentHash: string | null; failure: FastClawSystemFileFailure | null };
  published: { versionId: string | null; versionNo: number | null; contentHash: string | null };
  /** Whether the recorded context is the render of the currently published version. */
  matchesPublished: boolean | null;
  checkedAt: Date;
}

type AgentContextQueryClient = Pick<typeof db, 'select' | 'insert'>;
type AgentContextReadClient = Pick<typeof db, 'select'>;

const versionColumns = {
  id: agentContextVersions.id,
  agentId: agentContextVersions.agentId,
  contentHash: agentContextVersions.contentHash,
  source: agentContextVersions.source,
  capturedByAdminAccountId: agentContextVersions.capturedByAdminAccountId,
  contentVersionId: agentContextVersions.contentVersionId,
  contentVersionNo: agentContextVersions.contentVersionNo,
  createdAt: agentContextVersions.createdAt,
};

type AgentContextVersionRow = {
  [K in keyof typeof versionColumns]: (typeof agentContextVersions.$inferSelect)[K];
};

/**
 * Per-agent ordinal of each requested version, in ONE statement: the base context badge (`b#`) is a
 * position in that agent's capture history, never a global id or a timestamp guess.
 */
async function displayNumbers(ids: string[], client: AgentContextReadClient = db): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await client
    .select({
      id: agentContextVersions.id,
      // Fully qualified on purpose: drizzle omits the table name for a column of the FROM table,
      // and inside a correlated subquery the bare names would bind to the inner alias.
      no: sql<number>`(
        SELECT count(*)::int FROM "agent_context_versions" w
        WHERE w."agent_id" = "agent_context_versions"."agent_id"
          AND (w."created_at", w."id") <= ("agent_context_versions"."created_at", "agent_context_versions"."id")
      )`,
    })
    .from(agentContextVersions)
    .where(inArray(agentContextVersions.id, ids));
  return new Map(rows.map((row) => [row.id, Number(row.no)]));
}

function toView(row: AgentContextVersionRow, displayNo: number): AgentContextVersionView {
  return {
    id: row.id,
    agentId: row.agentId,
    displayNo,
    contentHash: row.contentHash,
    source: row.source as AgentContextSource,
    capturedByAdminAccountId: row.capturedByAdminAccountId,
    contentVersionId: row.contentVersionId,
    contentVersionNo: row.contentVersionNo,
    createdAt: row.createdAt,
  };
}

/** The newest recorded base context of an agent, or null when nothing was ever recorded. */
export async function getLatestAgentContextVersion(
  agentId: string,
  client: AgentContextReadClient = db,
): Promise<AgentContextVersionView | null> {
  const [row] = await client
    .select(versionColumns)
    .from(agentContextVersions)
    .where(eq(agentContextVersions.agentId, agentId))
    .orderBy(desc(agentContextVersions.createdAt), desc(agentContextVersions.id))
    .limit(1);
  if (!row) return null;
  const numbers = await displayNumbers([row.id], client);
  return toView(row, numbers.get(row.id) ?? 1);
}

/**
 * The id a newly accepted turn must reference. One local read, no cross-service call: the accept
 * transaction may not depend on FastClaw, and a turn without a record stays unattributed.
 */
export async function latestAgentContextVersionId(
  client: AgentContextReadClient,
  agentId: string | null,
): Promise<string | null> {
  if (!agentId) return null;
  const [row] = await client
    .select({ id: agentContextVersions.id })
    .from(agentContextVersions)
    .where(eq(agentContextVersions.agentId, agentId))
    .orderBy(desc(agentContextVersions.createdAt), desc(agentContextVersions.id))
    .limit(1);
  return row?.id ?? null;
}

/** Base-context ordinals for a page of turn attributions, in one read. */
export async function getAgentContextDisplayNumbers(ids: string[]): Promise<Map<string, number>> {
  return displayNumbers(ids.filter((id) => id));
}

export interface RecordAgentContextInput {
  agentId: string;
  rendered: RenderedAgentContext;
  source: AgentContextSource;
  capturedByAdminAccountId?: string | null;
  characterId?: string | null;
  contentVersionId?: string | null;
  contentVersionNo?: number | null;
}

/**
 * Records one immutable base-context version. Hash-deduped: the same rendered bytes for the same
 * agent keep the row they already have (`created: false`), so re-publishing an unchanged character
 * appends nothing and a recorded capture is never rewritten.
 */
export async function recordAgentContextVersion(
  input: RecordAgentContextInput,
  client: AgentContextQueryClient = db,
): Promise<{ version: AgentContextVersionView; created: boolean }> {
  const { agentId, rendered } = input;
  const [inserted] = await client
    .insert(agentContextVersions)
    .values({
      agentId,
      contentHash: rendered.contentHash,
      snapshot: {
        agentId,
        contentHash: rendered.contentHash,
        characterId: input.characterId ?? null,
        contentVersionId: input.contentVersionId ?? null,
        contentVersionNo: input.contentVersionNo ?? null,
        files: rendered.files,
        fileHashes: rendered.fileHashes,
        counts: rendered.counts,
      },
      source: input.source,
      capturedByAdminAccountId: input.capturedByAdminAccountId ?? null,
      contentVersionId: input.contentVersionId ?? null,
      contentVersionNo: input.contentVersionNo ?? null,
    })
    .onConflictDoNothing({ target: [agentContextVersions.agentId, agentContextVersions.contentHash] })
    .returning(versionColumns);

  const row = inserted ?? (await client
    .select(versionColumns)
    .from(agentContextVersions)
    .where(and(
      eq(agentContextVersions.agentId, agentId),
      eq(agentContextVersions.contentHash, rendered.contentHash),
    ))
    .limit(1))[0];
  if (!row) throw new Error('agent_context_version_record_failed');
  const numbers = await displayNumbers([row.id], client);
  return {
    version: toView(row, numbers.get(row.id) ?? 1),
    created: Boolean(inserted),
  };
}

async function loadPublishedSource(characterId: string): Promise<{
  characterId: string;
  agentId: string | null;
  publishedVersionId: string | null;
  publishedVersionNo: number | null;
  rendered: RenderedAgentContext | null;
}> {
  const [row] = await db
    .select({
      characterId: characters.id,
      agentId: characters.agentId,
      publishedVersionId: characters.publishedVersionId,
      publishedVersionNo: contentVersions.versionNo,
      payload: contentVersions.payload,
    })
    .from(characters)
    .leftJoin(contentVersions, eq(contentVersions.id, characters.publishedVersionId))
    .where(eq(characters.id, characterId))
    .limit(1);
  if (!row) throw new NotFoundError('Character');
  let rendered: RenderedAgentContext | null = null;
  if (row.payload) {
    try {
      rendered = renderPublishedAgentContext(row.payload);
    } catch {
      // A published payload that cannot render a persona is reported, never patched with filler.
      rendered = null;
    }
  }
  return {
    characterId: row.characterId,
    agentId: row.agentId,
    publishedVersionId: row.publishedVersionId,
    publishedVersionNo: row.publishedVersionNo ?? null,
    rendered,
  };
}

export interface SyncCharacterBaseContextInput {
  characterId: string;
  source: AgentContextSource;
  capturedByAdminAccountId?: string | null;
  timeoutMs?: number;
}

/**
 * Derives the three files from the character's PUBLISHED version and makes FastClaw match it.
 *
 * Status semantics (returned to the operator, never hidden):
 *  - `synced`     — the live files and the record now both match the published version;
 *  - `unchanged`  — they already did; nothing was written and no version was recorded;
 *  - `pending`    — FastClaw could not be read (not configured / unreachable / unauthorized), so
 *                   nothing was written or recorded and the last good record is kept;
 *  - `failed`     — FastClaw was reachable but rejected a write, or the record could not be stored.
 *
 * This function never throws for a cross-system problem: a publish must stay successful.
 */
export async function syncCharacterBaseContext(
  input: SyncCharacterBaseContextInput,
): Promise<BaseContextSyncResult> {
  const source = await loadPublishedSource(input.characterId);
  const agentId = source.agentId ?? null;
  const base = { characterId: input.characterId, agentId };
  if (!source.publishedVersionId || !source.rendered) {
    return { ...base, status: 'failed', reason: 'character_version_unavailable', written: false, version: null };
  }
  if (!agentId) {
    return { ...base, status: 'failed', reason: 'character_agent_unavailable', written: false, version: null };
  }

  const desired = source.rendered;
  const recorded = await getLatestAgentContextVersion(agentId);
  const live = await readRoleSystemFiles(agentId, { timeoutMs: input.timeoutMs });
  if (!live.ok) {
    // Not "failed": FastClaw was not reachable to write at all. The old record stays the last good one.
    return { ...base, status: 'pending', reason: live.code, written: false, version: recorded };
  }

  const liveHash = hashRoleFiles(live.files);
  if (liveHash === desired.contentHash) {
    if (recorded && recorded.contentHash === desired.contentHash) {
      return { ...base, status: 'unchanged', reason: null, written: false, version: recorded };
    }
    // The files already match (e.g. a previous write whose record was lost): record, do not rewrite.
    const stored = await recordAgentContextVersion({
      agentId,
      rendered: desired,
      source: input.source,
      capturedByAdminAccountId: input.capturedByAdminAccountId ?? null,
      characterId: input.characterId,
      contentVersionId: source.publishedVersionId,
      contentVersionNo: source.publishedVersionNo,
    });
    return { ...base, status: 'synced', reason: null, written: false, version: stored.version };
  }

  // The live files differ from the published version: this is where a FastClaw-console hand edit is
  // overwritten (plan W: the published PG version is the single source).
  for (const name of ROLE_SYSTEM_FILES) {
    const write = await writeAgentSystemFile({
      agentId,
      name,
      content: desired.files[name as RoleSystemFile],
      timeoutMs: input.timeoutMs,
    });
    if (!write.ok) {
      // Partial write stays visible: no version is recorded, so the drift read keeps reporting it.
      return { ...base, status: 'failed', reason: `${write.code}:${name}`, written: true, version: recorded };
    }
  }

  try {
    const stored = await recordAgentContextVersion({
      agentId,
      rendered: desired,
      source: input.source,
      capturedByAdminAccountId: input.capturedByAdminAccountId ?? null,
      characterId: input.characterId,
      contentVersionId: source.publishedVersionId,
      contentVersionNo: source.publishedVersionNo,
    });
    return { ...base, status: 'synced', reason: null, written: true, version: stored.version };
  } catch {
    return { ...base, status: 'failed', reason: 'record_failed', written: true, version: recorded };
  }
}

/**
 * Latest recorded base context vs the live FastClaw files. Never infers a match: an unreadable
 * FastClaw is `unavailable`, an empty history is `unrecorded`, and only an equal hash is `in-sync`.
 */
export async function readCharacterBaseContext(
  characterId: string,
  options: { timeoutMs?: number } = {},
): Promise<CharacterBaseContext> {
  const source = await loadPublishedSource(characterId);
  const agentId = source.agentId ?? null;
  const publishedHash = source.rendered?.contentHash ?? null;
  const recorded = agentId ? await getLatestAgentContextVersion(agentId) : null;
  const checkedAt = new Date();

  let live: CharacterBaseContext['live'] = { readable: false, contentHash: null, failure: null };
  if (agentId && isFastClawConfiguredForSystemFiles()) {
    const result = await readRoleSystemFiles(agentId, { timeoutMs: options.timeoutMs });
    live = result.ok
      ? { readable: true, contentHash: hashRoleFiles(result.files), failure: null }
      : { readable: false, contentHash: null, failure: result.code };
  } else if (agentId) {
    live = { readable: false, contentHash: null, failure: 'not_configured' };
  }

  const status: BaseContextDriftStatus = !recorded
    ? 'unrecorded'
    : !live.readable
      ? 'unavailable'
      : live.contentHash === recorded.contentHash ? 'in-sync' : 'drifted';

  return {
    characterId,
    agentId,
    status,
    recorded,
    live,
    published: { versionId: source.publishedVersionId, versionNo: source.publishedVersionNo, contentHash: publishedHash },
    matchesPublished: recorded && publishedHash ? recorded.contentHash === publishedHash : null,
    checkedAt,
  };
}

/**
 * The explicit admin action: rebuild the base context from the published version on demand (after a
 * console hand edit, or to retry a `pending`/`failed` publish sync). Same content ⇒ same record.
 */
export async function rebuildCharacterBaseContext(input: {
  actor: IdentityAdminActor;
  characterId: string;
  requestId?: string;
  timeoutMs?: number;
}): Promise<{ sync: BaseContextSyncResult; baseContext: CharacterBaseContext }> {
  const sync = await syncCharacterBaseContext({
    characterId: input.characterId,
    source: 'manual',
    capturedByAdminAccountId: input.actor.kind === 'admin_account' ? input.actor.adminAccountId : null,
    timeoutMs: input.timeoutMs,
  });
  await recordAdminAudit({
    actor: input.actor,
    action: 'admin.character.base_context.rebuild',
    objectType: 'character',
    objectId: input.characterId,
    requestId: input.requestId,
    result: sync.status === 'failed' ? 'failed' : 'committed',
    summary: {
      status: sync.status,
      reason: sync.reason,
      written: sync.written,
      agentId: sync.agentId,
      agentContextVersionId: sync.version?.id ?? null,
      agentContextVersionNo: sync.version?.displayNo ?? null,
    },
  });
  return { sync, baseContext: await readCharacterBaseContext(input.characterId, { timeoutMs: input.timeoutMs }) };
}
