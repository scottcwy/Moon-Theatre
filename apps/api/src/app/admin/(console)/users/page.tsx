import Link from 'next/link';
import { listAdminUsers } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { AdminTable, formatAdminDate, LoadError } from '../../ui.js';
import {
  USER_PAGE_INVALID,
  USER_QUERY_TOO_LONG,
  USER_SEARCH_MAX_LENGTH,
  USER_STATUS_FILTER_INVALID,
  USER_STATUS_LABELS,
  userStatusLabel,
} from '../../user-copy.js';

interface UserRow {
  id: string;
  nickname: string | null;
  status: string;
  createdAt: string | Date;
  balancePoints: number | string;
  sessionCount: number | string;
  lastMessageAt: string | Date | null;
}

type SearchParams = Record<string, string | string[] | undefined>;

const PAGE_SIZE = 20;

function first(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

/**
 * User search (AC-11 / §6): one term plus a status filter, server-side, with filter-preserving
 * pagination. The term matches nickname substring, openid prefix or user-id prefix; an unusable value
 * is reported and not applied rather than silently widening the query.
 */
export default async function UsersPage(props: { searchParams?: Promise<SearchParams> }) {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  const query = (await props?.searchParams) ?? {};
  const rawTerm = first(query.q);
  const rawStatus = first(query.status);
  const rawPage = first(query.page);
  const parsedPage = Number.parseInt(rawPage ?? '1', 10);
  const pageInvalid = rawPage !== undefined && rawPage !== '' && (!Number.isInteger(parsedPage) || parsedPage < 1);
  const requestedPage = pageInvalid ? 1 : Math.max(1, parsedPage);

  const trimmedTerm = rawTerm?.trim() ?? '';
  const term = trimmedTerm.length > 0 && trimmedTerm.length <= USER_SEARCH_MAX_LENGTH ? trimmedTerm : undefined;
  const validStatus = rawStatus === 'active' || rawStatus === 'banned' ? rawStatus : undefined;
  const hasFilters = Boolean(term || validStatus);

  let users: Awaited<ReturnType<typeof listAdminUsers>>;
  try {
    users = await listAdminUsers({
      page: requestedPage,
      pageSize: PAGE_SIZE,
      ...(term ? { query: term } : {}),
      ...(validStatus ? { status: validStatus } : {}),
    });
  } catch {
    return <LoadError subject="用户" />;
  }

  const activeFilters = [
    ...(term ? [`关键词「${term}」`] : []),
    ...(validStatus ? [USER_STATUS_LABELS[validStatus]] : []),
  ];

  const pageLink = (target: number) => {
    const params = new URLSearchParams();
    params.set('page', String(target));
    if (term) params.set('q', term);
    if (validStatus) params.set('status', validStatus);
    return `/admin/users?${params.toString()}`;
  };
  const lastPage = Math.max(1, Math.ceil(users.total / users.pageSize));

  return (
    <div>
      <h1>用户管理</h1>
      <p className="page-description">按用户 ID、昵称或 openid 前缀搜索玩家，查看余额、会话数与最近消息时间；进入用户详情可查看其最近会话，并封禁或解封。</p>

      <form className="filter-bar" method="get" action="/admin/users" aria-label="搜索用户">
        <label>搜索关键词
          <input name="q" defaultValue={rawTerm ?? ''} maxLength={USER_SEARCH_MAX_LENGTH + 1} placeholder="用户 ID / 昵称 / openid 前缀" spellCheck={false} autoCapitalize="none" />
        </label>
        <label>用户状态
          <select name="status" defaultValue={validStatus ?? ''}>
            <option value="">全部</option>
            <option value="active">正常</option>
            <option value="banned">已封禁</option>
          </select>
        </label>
        <button className="primary" type="submit">搜索</button>
        {hasFilters && <Link className="button" href="/admin/users">清除筛选</Link>}
      </form>

      {activeFilters.length > 0 && <p className="muted filter-summary" role="status">当前筛选：{activeFilters.join(' · ')}</p>}
      {rawStatus && !validStatus && <div className="notice warning" role="status">{USER_STATUS_FILTER_INVALID}</div>}
      {rawTerm && !term && <div className="notice warning" role="status">{USER_QUERY_TOO_LONG}</div>}
      {pageInvalid && <div className="notice warning" role="status">{USER_PAGE_INVALID}</div>}

      <AdminTable
        label="用户列表，可横向滚动"
        isEmpty={users.items.length === 0}
        emptyMessage={hasFilters
          ? `当前筛选下没有匹配的用户（${activeFilters.join(' · ')}）。可清除筛选查看全部用户。`
          : '暂无用户。玩家首次登录后会出现在这里。'}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">用户</th>
              <th scope="col">昵称</th>
              <th scope="col">状态</th>
              <th scope="col" className="numeric">余额点数</th>
              <th scope="col" className="numeric">会话数</th>
              <th scope="col">最后消息</th>
              <th scope="col">注册时间</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {(users.items as unknown as UserRow[]).map((row) => (
              <tr key={row.id} data-user-status={row.status}>
                <td className="identifier"><Link href={`/admin/users/${row.id}`}>{row.id.slice(0, 8)}</Link></td>
                <td>{row.nickname || '未设置昵称'}</td>
                <td><span className="tag" data-status={row.status}>{userStatusLabel(row.status)}</span></td>
                <td className="numeric">{Number(row.balancePoints ?? 0)}</td>
                <td className="numeric">{Number(row.sessionCount ?? 0)}</td>
                <td>{formatAdminDate(row.lastMessageAt)}</td>
                <td>{formatAdminDate(row.createdAt)}</td>
                <td><Link href={`/admin/users/${row.id}`}>查看详情</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </AdminTable>

      <p className="muted table-total">
        共 {users.total} 位用户，本页显示 {users.items.length} 位（第 {users.page} / {lastPage} 页）
        {users.page < lastPage && <>{' · '}<Link href={pageLink(users.page + 1)}>下一页</Link></>}
        {users.page > 1 && <>{' · '}<Link href={pageLink(users.page - 1)}>上一页</Link></>}
      </p>
    </div>
  );
}
