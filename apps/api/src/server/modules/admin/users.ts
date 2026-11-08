import { and, count, desc, eq, ilike, like, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { characters, chatSessions, users, walletAccounts } from '../../db/schema.js';
import { NotFoundError, ValidationError } from '../../http/errors.js';
import { normalizePagination, type PaginatedResult, type PaginationParams } from './pagination.js';
import { recordAdminAuditInTransaction, type IdentityAdminActor } from './audit.js';

/**
 * User operations (AC-11): search/profile of a miniapp player and the ban/unban switch.
 *
 * These are the *user* namespace only. Administrator identity lives in `admin_accounts` inside the
 * independent admin boundary, so an administrator whose account id equals a player's UUID keeps
 * working when that player is banned. Banning changes exactly one column (`users.status`) plus the
 * row's `updated_at`; it never touches `wallet_accounts`/`wallet_transactions`, never deletes a user,
 * a session or a message, and never rewrites history. Enforcement is the existing `verifyAuth`
 * lookup, which already refuses a JWT whose user is not `active` — so an already-issued credential
 * stops authorizing new business requests immediately and works again after an unban.
 *
 * Nothing here reads or returns persona/system prompts, chat bodies or credential material: the list
 * carries aggregates, the profile carries ids, counts and a masked openid prefix.
 */
export type AdminUserStatus = 'active' | 'banned';
export const ADMIN_USER_STATUSES: readonly AdminUserStatus[] = ['active', 'banned'];
export const ADMIN_USER_STATUS_INVALID = '用户状态只能是正常或已封禁';
/** Bounded "recent sessions" window on the user profile; the full list lives on the session page. */
export const ADMIN_USER_RECENT_SESSION_LIMIT = 10;

const USER_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id is a client error, never a driver failure reported as a dependency outage. */
function requireUserId(value: string): string {
  if (!USER_ID_SHAPE.test(value)) throw new ValidationError('admin_input_invalid');
  return value;
}

/**
 * Aggregates are correlated scalar subqueries in the *same* statement as the page, so a page of 50
 * users is two statements in total (page + count) instead of one query per row. Table and column
 * names are spelled out because drizzle omits the qualifier for a column that belongs to the query's
 * own FROM table, which would bind `"users"."id"` to the innermost alias.
 */
const balancePointsExpr = sql<number>`
  coalesce((select "wa"."balance_points" from "wallet_accounts" "wa" where "wa"."user_id" = "users"."id"), 0)
`.mapWith(Number);
const sessionCountExpr = sql<number>`
  (select count(*) from "chat_sessions" "cs" where "cs"."user_id" = "users"."id")
`.mapWith(Number);
const messageCountExpr = sql<number>`
  (select count(*) from "messages" "m"
     inner join "chat_sessions" "cs" on "cs"."id" = "m"."session_id"
    where "cs"."user_id" = "users"."id")
`.mapWith(Number);
/**
 * Timestamps leave the aggregate as explicit UTC ISO-8601 text (`to_char`) instead of a driver-shaped
 * value: an expression column has no table OID the driver can map back, so this keeps one unambiguous
 * representation for JSON and for the page's `formatAdminDate`.
 */
const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const lastMessageAtExpr = sql<string | null>`
  (select to_char(max("m"."created_at") at time zone 'UTC', ${sql.raw(ISO_UTC)}) from "messages" "m"
     inner join "chat_sessions" "cs" on "cs"."id" = "m"."session_id"
    where "cs"."user_id" = "users"."id")
`;
const lastSessionAtExpr = sql<string | null>`
  (select to_char(max("cs"."updated_at") at time zone 'UTC', ${sql.raw(ISO_UTC)}) from "chat_sessions" "cs" where "cs"."user_id" = "users"."id")
`;

/** Normalizes an aggregate timestamp (UTC ISO text or Date) into a `Date`. */
function asDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

/** `%`/`_`/`\` are literal characters of the operator's term, not LIKE syntax. */
function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

/**
 * One term matches three ways: nickname substring, openid prefix (the miniapp identifier's leading
 * characters) and user-id text prefix (a pasted full UUID matches exactly). Case-insensitive, so an
 * upper-case UUID copy still finds its row.
 */
function searchCondition(term: string) {
  const escaped = escapeLikeTerm(term);
  return or(
    ilike(users.nickname, `%${escaped}%`),
    like(users.openid, `${escaped}%`),
    sql`lower("users"."id"::text) like ${`${escaped.toLowerCase()}%`}`,
  )!;
}

export interface AdminUserListFilters {
  /** Nickname substring, openid prefix or user-id prefix. Blank means "no search". */
  query?: string;
  status?: AdminUserStatus;
}

export interface AdminUserListItem {
  id: string;
  nickname: string | null;
  status: AdminUserStatus;
  createdAt: Date;
  balancePoints: number;
  sessionCount: number;
  lastMessageAt: Date | null;
}

export async function listAdminUsers(
  params: PaginationParams & AdminUserListFilters,
): Promise<PaginatedResult<AdminUserListItem>> {
  const { page, pageSize, offset } = normalizePagination(params);

  const conditions = [];
  const term = params.query?.trim();
  if (term) conditions.push(searchCondition(term));
  if (params.status) {
    if (!ADMIN_USER_STATUSES.includes(params.status)) throw new ValidationError(ADMIN_USER_STATUS_INVALID);
    conditions.push(eq(users.status, params.status));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRow] = await Promise.all([
    db
      .select({
        id: users.id,
        nickname: users.nickname,
        status: users.status,
        createdAt: users.createdAt,
        balancePoints: balancePointsExpr,
        sessionCount: sessionCountExpr,
        lastMessageAt: lastMessageAtExpr,
      })
      .from(users)
      .where(where)
      // Deterministic: newest first, ties broken by id so a bounded page never reorders between reads.
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: count() }).from(users).where(where),
  ]);

  return {
    items: items.map(item => ({ ...item, lastMessageAt: asDate(item.lastMessageAt) })) as AdminUserListItem[],
    total: totalRow[0]?.total ?? 0,
    page,
    pageSize,
  };
}

export interface AdminUserWalletSummary {
  /** false when the player has no wallet row yet; the balances are then zero, not "unknown". */
  exists: boolean;
  balancePoints: number;
  totalRechargedPoints: number;
  totalConsumedPoints: number;
}

export interface AdminUserRecentSession {
  id: string;
  characterId: string;
  characterName: string | null;
  title: string | null;
  mode: string;
  status: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminUserProfile {
  user: {
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
    status: AdminUserStatus;
    /** Masked openid prefix: enough to confirm a search hit, never the full login identifier. */
    openidPreview: string;
    createdAt: Date;
    updatedAt: Date;
  };
  wallet: AdminUserWalletSummary;
  stats: {
    sessionCount: number;
    messageCount: number;
    lastMessageAt: Date | null;
    lastSessionAt: Date | null;
  };
  recentSessions: AdminUserRecentSession[];
}

/** `openid` is a login identifier, so a page never prints all of it. */
export function maskOpenidPreview(openid: string): string {
  const keep = Math.min(8, Math.max(2, openid.length - 1));
  return `${openid.slice(0, keep)}…`;
}

export async function getAdminUser(id: string): Promise<AdminUserProfile> {
  const userId = requireUserId(id);

  const [row] = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
      status: users.status,
      openid: users.openid,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      balancePoints: walletAccounts.balancePoints,
      totalRechargedPoints: walletAccounts.totalRechargedPoints,
      totalConsumedPoints: walletAccounts.totalConsumedPoints,
      sessionCount: sessionCountExpr,
      messageCount: messageCountExpr,
      lastMessageAt: lastMessageAtExpr,
      lastSessionAt: lastSessionAtExpr,
    })
    .from(users)
    .leftJoin(walletAccounts, eq(walletAccounts.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) throw new NotFoundError('User');

  // Recent sessions only (ids + display context); the transcript and persona text stay on the
  // session/version pages behind their own guards and access audit.
  const recentSessions = await db
    .select({
      id: chatSessions.id,
      characterId: chatSessions.characterId,
      characterName: characters.name,
      title: chatSessions.title,
      mode: chatSessions.mode,
      status: chatSessions.status,
      messageCount: sql<number>`
        (select count(*) from "messages" "m" where "m"."session_id" = "chat_sessions"."id")
      `.mapWith(Number),
      createdAt: chatSessions.createdAt,
      updatedAt: chatSessions.updatedAt,
    })
    .from(chatSessions)
    .leftJoin(characters, eq(chatSessions.characterId, characters.id))
    .where(eq(chatSessions.userId, userId))
    .orderBy(desc(chatSessions.updatedAt), desc(chatSessions.id))
    .limit(ADMIN_USER_RECENT_SESSION_LIMIT);

  return {
    user: {
      id: row.id,
      nickname: row.nickname,
      avatarUrl: row.avatarUrl,
      status: row.status,
      openidPreview: maskOpenidPreview(row.openid),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    wallet: {
      exists: row.balancePoints !== null,
      balancePoints: row.balancePoints ?? 0,
      totalRechargedPoints: row.totalRechargedPoints ?? 0,
      totalConsumedPoints: row.totalConsumedPoints ?? 0,
    },
    stats: {
      sessionCount: row.sessionCount,
      messageCount: row.messageCount,
      lastMessageAt: asDate(row.lastMessageAt),
      lastSessionAt: asDate(row.lastSessionAt),
    },
    recentSessions,
  };
}

export interface AdminUserStatusChange {
  user: { id: string; nickname: string | null; status: AdminUserStatus; updatedAt: Date };
  previousStatus: AdminUserStatus;
  /** false when the requested status already held: nothing was written and no audit was appended. */
  changed: boolean;
  /** The audit row of this transition; null for an idempotent no-op. */
  auditId: string | null;
}

/**
 * Ban/unban in one transaction: lock the user row, flip `status`, and append the audit event with the
 * authenticated administrator as the actor. A missing user is `404`, a malformed id or an unknown
 * status is `400`; both refuse before any write. The row lock makes concurrent duplicate requests
 * serialize into one transition plus one no-op, so an "audit once" guarantee does not need a dedupe
 * key: only a real transition can reach the audit insert, and a failed insert rolls the write back.
 */
export async function setAdminUserStatus(
  actor: IdentityAdminActor,
  userId: string,
  status: AdminUserStatus,
  requestId?: string,
): Promise<AdminUserStatusChange> {
  const id = requireUserId(userId);
  if (!ADMIN_USER_STATUSES.includes(status)) throw new ValidationError(ADMIN_USER_STATUS_INVALID);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: users.id, nickname: users.nickname, status: users.status, updatedAt: users.updatedAt })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
      .for('update');

    if (!row) throw new NotFoundError('User');
    if (row.status === status) {
      return { user: { ...row, status }, previousStatus: row.status, changed: false, auditId: null };
    }

    const [updated] = await tx
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id, nickname: users.nickname, status: users.status, updatedAt: users.updatedAt });

    const auditId = await recordAdminAuditInTransaction(tx, {
      actor,
      action: status === 'banned' ? 'admin.user.ban' : 'admin.user.unban',
      objectType: 'user',
      objectId: id,
      requestId,
      result: 'committed',
      summary: { from: row.status, to: status },
    });

    return { user: updated!, previousStatus: row.status, changed: true, auditId };
  });
}
