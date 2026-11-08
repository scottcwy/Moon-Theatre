import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { agentContextVersions, agentCurrentContext, characters, contentVersions } from '../../db/schema.js';
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
 * WHICH recorded version is current is an explicit pointer (`agent_current_context`), never
 * `max(created_at)`: recording is hash-deduped, so publishing A → B → A re-uses the old A row whose
 * `created_at` is older than B's. Ordering by capture time would then claim drift against B while the
 * runtime holds A, and no rebuild could ever clear it. The pointer is written in the same transaction
 * as the record, only after the written bytes were read back and verified.
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
type AgentContextTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

/**
 * The base context the runtime is CURRENTLY running: the version named by `agent_current_context`, or
 * null when the agent has no current record. Never a `max(created_at)` guess (see the module comment).
 */
export async function getCurrentAgentContextVersion(
  agentId: string,
  client: AgentContextReadClient = db,
): Promise<AgentContextVersionView | null> {
  const [row] = await client
    .select(versionColumns)
    .from(agentCurrentContext)
    .innerJoin(agentContextVersions, eq(agentContextVersions.id, agentCurrentContext.versionId))
    .where(eq(agentCurrentContext.agentId, agentId))
    .limit(1);
  if (!row) return null;
  const numbers = await displayNumbers([row.id], client);
  return toView(row, numbers.get(row.id) ?? 1);
}

/**
 * The id a newly accepted turn must reference. One local read, no cross-service call: the accept
 * transaction may not depend on FastClaw, and a turn without a record stays unattributed.
 */
export async function currentAgentContextVersionId(
  client: AgentContextReadClient,
  agentId: string | null,
): Promise<string | null> {
  if (!agentId) return null;
  const [row] = await client
    .select({ id: agentCurrentContext.versionId })
    .from(agentCurrentContext)
    .where(eq(agentCurrentContext.agentId, agentId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Makes a recorded version the current one. Must run in the same transaction as the record insert, so
 * "a capture exists" and "this capture is what FastClaw holds" can never disagree.
 */
async function setCurrentAgentContextVersion(
  client: AgentContextQueryClient,
  agentId: string,
  versionId: string,
): Promise<void> {
  await client
    .insert(agentCurrentContext)
    .values({ agentId, versionId })
    .onConflictDoUpdate({
      target: agentCurrentContext.agentId,
      set: { versionId, updatedAt: sql`now()` },
    });
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
 * Records one immutable base-context version AND makes it the current one (A → B → A repoints to the
 * existing A row; it never appends a second copy of the same bytes).
 *
 * The two writes are one transaction: a record that is not current would be a claim about a capture
 * nothing points at. Callers that already own a transaction pass its client and get the same atomicity.
 */
export async function recordAgentContextVersion(
  input: RecordAgentContextInput,
  client?: AgentContextQueryClient,
): Promise<{ version: AgentContextVersionView; created: boolean }> {
  if (client) return recordAndPointCurrent(client, input);
  return db.transaction((tx) => recordAndPointCurrent(tx, input));
}

async function recordAndPointCurrent(
  client: AgentContextQueryClient,
  input: RecordAgentContextInput,
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
  await setCurrentAgentContextVersion(client, agentId, row.id);
  const numbers = await displayNumbers([row.id], client);
  return {
    version: toView(row, numbers.get(row.id) ?? 1),
    created: Boolean(inserted),
  };
}

async function loadPublishedSource(characterId: string, client: AgentContextReadClient = db): Promise<{
  characterId: string;
  agentId: string | null;
  publishedVersionId: string | null;
  publishedVersionNo: number | null;
  rendered: RenderedAgentContext | null;
}> {
  const [row] = await client
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
 *  - `failed`     — FastClaw was reachable but rejected a write (`written` says whether all three PUTs
 *                   landed), the read-back did not match (`write_not_verified`), or the record could
 *                   not be stored (`record_failed`).
 *
 * This function never throws for a cross-system problem: a publish must stay successful.
 */
export async function syncCharacterBaseContext(
  input: SyncCharacterBaseContextInput,
): Promise<BaseContextSyncResult> {
  // The agent id is needed to take the per-agent lock, and it is system-owned (never re-bound).
  const head = await loadPublishedSource(input.characterId);
  const agentId = head.agentId ?? null;
  if (!agentId) {
    return {
      characterId: input.characterId, agentId: null, status: 'failed',
      reason: 'character_agent_unavailable', written: false, version: null,
    };
  }
  try {
    // One sync per agent at a time, and the published source is re-read INSIDE the lock: two admins
    // publishing (or a publish plus a rebuild) can no longer interleave read → write → record, which
    // would leave the current pointer on the version whose sync merely finished last.
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${agentId}))`);
      return syncInsideAgentLock(tx, input, agentId);
    });
  } catch (error) {
    if (error instanceof BaseContextRecordError) {
      return {
        characterId: input.characterId, agentId, status: 'failed', reason: 'record_failed',
        written: error.written, version: error.version,
      };
    }
    throw error;
  }
}

/** A record/pointer write failed after the file operations: `written` preserves what really happened. */
class BaseContextRecordError extends Error {
  constructor(readonly written: boolean, readonly version: AgentContextVersionView | null) {
    super('agent_context_record_failed');
    this.name = 'BaseContextRecordError';
  }
}

async function storeContext(
  tx: AgentContextTransaction,
  input: SyncCharacterBaseContextInput,
  agentId: string,
  source: { publishedVersionId: string; publishedVersionNo: number | null; rendered: RenderedAgentContext },
  written: boolean,
  current: AgentContextVersionView | null,
): Promise<AgentContextVersionView> {
  try {
    // Record and repoint the current version in this same transaction: an append-only, deduped
    // history cannot say which row is live, so the pointer is the only honest source of "current".
    const stored = await recordAgentContextVersion({
      agentId,
      rendered: source.rendered,
      source: input.source,
      capturedByAdminAccountId: input.capturedByAdminAccountId ?? null,
      characterId: input.characterId,
      contentVersionId: source.publishedVersionId,
      contentVersionNo: source.publishedVersionNo,
    }, tx);
    return stored.version;
  } catch {
    throw new BaseContextRecordError(written, current);
  }
}

async function syncInsideAgentLock(
  tx: AgentContextTransaction,
  input: SyncCharacterBaseContextInput,
  agentId: string,
): Promise<BaseContextSyncResult> {
  const source = await loadPublishedSource(input.characterId, tx);
  const base = { characterId: input.characterId, agentId };
  if (!source.publishedVersionId || !source.rendered) {
    return { ...base, status: 'failed', reason: 'character_version_unavailable', written: false, version: null };
  }
  if (!source.agentId) {
    return { ...base, status: 'failed', reason: 'character_agent_unavailable', written: false, version: null };
  }

  const desired = source.rendered;
  const published = {
    publishedVersionId: source.publishedVersionId,
    publishedVersionNo: source.publishedVersionNo,
    rendered: desired,
  };
  const current = await getCurrentAgentContextVersion(agentId, tx);
  const live = await readRoleSystemFiles(agentId, { timeoutMs: input.timeoutMs });
  if (!live.ok) {
    // Not "failed": FastClaw was not reachable to write at all. The old record stays the last good one.
    return { ...base, status: 'pending', reason: live.code, written: false, version: current };
  }

  const liveHash = hashRoleFiles(live.files);
  if (liveHash === desired.contentHash) {
    if (current && current.contentHash === desired.contentHash) {
      return { ...base, status: 'unchanged', reason: null, written: false, version: current };
    }
    // The files already match (e.g. a previous write whose record was lost): record (and thereby
    // repoint current), do not rewrite. This is also the A → B → A case once the files match again.
    const version = await storeContext(tx, input, agentId, published, false, current);
    return { ...base, status: 'synced', reason: null, written: false, version };
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
      // A partial write stays visible: no version is recorded and current is NOT repointed, so the
      // drift read keeps reporting it. `written` is false because not all three PUTs landed.
      return { ...base, status: 'failed', reason: `${write.code}:${name}`, written: false, version: current };
    }
  }

  // A PUT can answer 200 without the bytes being visible afterwards (dropped write, concurrent
  // overwrite). Read them back so such a state is `failed` instead of `synced` forever.
  // Note: FastClaw's setup API scopes BOTH GET and PUT by the authenticated user, so this check
  // cannot detect a credential that is not the agent owner — it only sees the row it just wrote.
  // Keeping FASTCLAW_API_KEY aligned with `agents.user_id` is an operational requirement.
  const verified = await readRoleSystemFiles(agentId, { timeoutMs: input.timeoutMs });
  if (!verified.ok) {
    return { ...base, status: 'failed', reason: `write_not_verified:${verified.code}`, written: true, version: current };
  }
  for (const name of ROLE_SYSTEM_FILES) {
    const file = name as RoleSystemFile;
    if (verified.files[file] !== desired.files[file]) {
      return { ...base, status: 'failed', reason: `write_not_verified:${name}`, written: true, version: current };
    }
  }
  if (hashRoleFiles(verified.files) !== desired.contentHash) {
    return { ...base, status: 'failed', reason: 'write_not_verified', written: true, version: current };
  }

  const version = await storeContext(tx, input, agentId, published, true, current);
  return { ...base, status: 'synced', reason: null, written: true, version };
}

/**
 * The CURRENT recorded base context vs the live FastClaw files. Never infers a match: an unreadable
 * FastClaw is `unavailable`, no current record is `unrecorded`, and only an equal hash is `in-sync`.
 */
export async function readCharacterBaseContext(
  characterId: string,
  options: { timeoutMs?: number } = {},
): Promise<CharacterBaseContext> {
  const source = await loadPublishedSource(characterId);
  const agentId = source.agentId ?? null;
  const publishedHash = source.rendered?.contentHash ?? null;
  const recorded = agentId ? await getCurrentAgentContextVersion(agentId) : null;
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
