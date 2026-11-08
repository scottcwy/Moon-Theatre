import type { AdminUserStatus } from '@/server/modules/admin/index.js';

/**
 * Chinese copy for user operations (AC-11). One module so the list page, the profile page and the
 * ban/unban form cannot drift apart, and so the wording that matters — the operator is told that a
 * ban invalidates the player's existing credentials — is testable text rather than a JSX literal.
 */
export const USER_STATUS_LABELS: Record<AdminUserStatus, string> = { active: '正常', banned: '已封禁' };

export function userStatusLabel(status: string): string {
  return USER_STATUS_LABELS[status as AdminUserStatus] ?? status;
}

/** Mirrors the server-side cap in `listAdminUsersQuerySchema`. */
export const USER_SEARCH_MAX_LENGTH = 128;

export const USER_STATUS_FILTER_INVALID = '用户状态筛选只能是正常或已封禁，当前输入未用于筛选。';
export const USER_QUERY_TOO_LONG = `搜索关键词最多 ${USER_SEARCH_MAX_LENGTH} 个字符，当前输入未用于筛选。`;
export const USER_PAGE_INVALID = '页码需为大于 0 的整数，当前输入未用于分页。';

/**
 * The decisive consequence, stated before the operator confirms: a ban does not "hide" the player, it
 * removes authorization from credentials that were already issued.
 */
export const USER_BAN_EFFECT_NOTE =
  '封禁后该用户的现有登录凭据立即无法调用新的用户业务请求（已接受的请求可结束）。解封后恢复正常权限；封禁不改动钱包余额与流水，也不删除会话或消息。';

export const USER_BAN_CONFIRMATION = '我确认封禁该用户：其现有登录凭据将立即无法调用新的用户业务请求，解封后可恢复。';
export const USER_UNBAN_CONFIRMATION = '我确认解除该用户的封禁：其现有登录凭据恢复调用权限。';

export const USER_BAN_SUCCESS = '已封禁该用户，其现有登录凭据不再授权新的用户业务请求。';
export const USER_UNBAN_SUCCESS = '已解除该用户的封禁，其登录凭据恢复调用权限。';
export const USER_STATUS_UNCHANGED = '用户状态已是目标状态，本次没有新的变更，也没有新增审计记录。';

export function describeUserStatusChange(result: { status: AdminUserStatus; changed: boolean }): string {
  if (!result.changed) return USER_STATUS_UNCHANGED;
  return result.status === 'banned' ? USER_BAN_SUCCESS : USER_UNBAN_SUCCESS;
}
