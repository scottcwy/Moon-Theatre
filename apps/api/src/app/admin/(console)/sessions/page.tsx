import Link from 'next/link';
import { AdminTable, adminStatus, formatAdminDate, LoadError } from '../../ui.js';
import { getCharacterSummary, listSessions } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { isAdminCalendarDay } from '@/server/modules/admin/query.js';
import { ADMIN_UUID } from '../../character-data.js';

interface SessionRow {
  id: string;
  userId: string;
  characterId: string;
  title: string | null;
  modelTier: string;
  mode: string;
  status: string;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  characterName: string | null;
  userName: string | null;
}

type SearchParams = Record<string, string | string[] | undefined>;
type ChatMode = 'script' | 'free';

const PAGE_SIZE = 50;
const MODE_LABELS: Record<ChatMode, string> = { script: '剧本模式', free: '自由模式' };
const STATUS_LABELS: Record<string, string> = { active: '进行中', archived: '已归档' };

function first(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

/**
 * Player sessions (§6 / AC-04): user, character, chat mode, status and created-date range combine as
 * server-side filters, so the character → sessions entry lands directly on that character's sessions
 * and a complaint about one day does not require paging through every session. All filters survive
 * pagination.
 */
export default async function SessionsPage(props: { searchParams?: Promise<SearchParams> }) {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  const query = (await props?.searchParams) ?? {};
  const userId = first(query.userId);
  const status = first(query.status);
  const characterId = first(query.characterId);
  const mode = first(query.mode);
  const from = first(query.from);
  const to = first(query.to);
  const page = Number.parseInt(first(query.page) ?? '1', 10);
  const requestedPage = Number.isInteger(page) && page > 0 ? page : 1;
  const validUserId = userId && ADMIN_UUID.test(userId) ? userId : undefined;
  const validStatus = status === 'active' || status === 'archived' ? status : undefined;
  const validCharacterId = characterId && ADMIN_UUID.test(characterId) ? characterId : undefined;
  const validMode: ChatMode | undefined = mode === 'script' || mode === 'free' ? mode : undefined;
  const validFrom = from && isAdminCalendarDay(from) ? from : undefined;
  const validTo = to && isAdminCalendarDay(to) ? to : undefined;
  // An inverted range describes no day at all, so it is reported and not applied (like a bad id).
  const invertedRange = Boolean(validFrom && validTo && validFrom > validTo);
  const appliedFrom = invertedRange ? undefined : validFrom;
  const appliedTo = invertedRange ? undefined : validTo;

  let sessions: Awaited<ReturnType<typeof listSessions>>;
  let character: Awaited<ReturnType<typeof getCharacterSummary>> = null;
  try {
    [sessions, character] = await Promise.all([
      listSessions({
        page: requestedPage,
        pageSize: PAGE_SIZE,
        ...(validUserId ? { userId: validUserId } : {}),
        ...(validStatus ? { status: validStatus } : {}),
        ...(validCharacterId ? { characterId: validCharacterId } : {}),
        ...(validMode ? { mode: validMode } : {}),
        ...(appliedFrom ? { from: appliedFrom } : {}),
        ...(appliedTo ? { to: appliedTo } : {}),
      }),
      validCharacterId ? getCharacterSummary(validCharacterId) : Promise.resolve(null),
    ]);
  } catch {
    return <LoadError subject="玩家会话" />;
  }

  const hasFilters = Boolean(validUserId || validStatus || validCharacterId || validMode || appliedFrom || appliedTo);
  const dateLabel = appliedFrom && appliedTo
    ? `创建日期 ${appliedFrom} 至 ${appliedTo}`
    : appliedFrom ? `创建日期 自 ${appliedFrom}` : appliedTo ? `创建日期 至 ${appliedTo}` : undefined;
  const characterLabel = validCharacterId
    ? character ? `角色《${character.name}》` : '角色已不存在'
    : undefined;
  const activeFilters = [
    ...(characterLabel ? [characterLabel] : []),
    ...(validUserId ? [`玩家 ID ${validUserId}`] : []),
    ...(validMode ? [MODE_LABELS[validMode]] : []),
    ...(validStatus ? [STATUS_LABELS[validStatus] ?? validStatus] : []),
    ...(dateLabel ? [dateLabel] : []),
  ];

  const pageLink = (target: number) => {
    const params = new URLSearchParams();
    params.set('page', String(target));
    if (validCharacterId) params.set('characterId', validCharacterId);
    if (validMode) params.set('mode', validMode);
    if (validUserId) params.set('userId', validUserId);
    if (validStatus) params.set('status', validStatus);
    if (appliedFrom) params.set('from', appliedFrom);
    if (appliedTo) params.set('to', appliedTo);
    return `/admin/sessions?${params.toString()}`;
  };

  return (
    <div>
      <h1>玩家会话</h1>
      <p className="page-description">按玩家、角色、模式、状态与会话创建日期定位会话，进入单个会话查看分页聊天历史与该回合使用的角色卡版本。</p>

      <form className="filter-bar" method="get" action="/admin/sessions" aria-label="筛选玩家会话">
        <label>玩家 ID
          <input name="userId" defaultValue={validUserId ?? ''} placeholder="用户 UUID" spellCheck={false} autoCapitalize="none" />
        </label>
        <label>角色
          <input name="characterId" defaultValue={validCharacterId ?? ''} placeholder="角色 UUID" spellCheck={false} autoCapitalize="none" />
        </label>
        <label>聊天模式
          <select name="mode" defaultValue={validMode ?? ''}>
            <option value="">全部</option>
            <option value="script">剧本模式</option>
            <option value="free">自由模式</option>
          </select>
        </label>
        <label>会话状态
          <select name="status" defaultValue={validStatus ?? ''}>
            <option value="">全部</option>
            <option value="active">进行中</option>
            <option value="archived">已归档</option>
          </select>
        </label>
        <label>创建日期（起）
          <input name="from" type="date" defaultValue={validFrom ?? ''} aria-describedby="session-date-note" />
        </label>
        <label>创建日期（止）
          <input name="to" type="date" defaultValue={validTo ?? ''} aria-describedby="session-date-note" />
        </label>
        <button className="primary" type="submit">筛选</button>
        {hasFilters && <Link className="button" href="/admin/sessions">清除筛选</Link>}
      </form>

      {activeFilters.length > 0 && <p className="muted filter-summary" role="status">
        当前筛选：{activeFilters.join(' · ')}
        {validCharacterId && <>{' · '}<Link href={`/admin/characters/${validCharacterId}/edit`}>返回角色编辑</Link></>}
      </p>}

      {userId && !validUserId && <div className="notice warning" role="status">
        玩家 ID 需为完整 UUID（可从会话详情或玩家接口复制），当前输入未用于筛选。
      </div>}
      {characterId && !validCharacterId && <div className="notice warning" role="status">
        角色 ID 需为完整 UUID，当前输入未用于筛选。可从角色卡列表进入该角色的玩家会话。
      </div>}
      {mode && !validMode && <div className="notice warning" role="status">
        模式只能是剧本或自由，当前输入未用于筛选。
      </div>}
      <p className="muted" id="session-date-note">创建日期按 UTC 自然日筛选，起止当天都包含在内；只填一侧表示从该日起或截至该日。</p>
      {((from && !validFrom) || (to && !validTo)) && <div className="notice warning" role="status">
        创建日期需为 YYYY-MM-DD（例如 2026-11-01），当前输入未用于筛选。
      </div>}
      {invertedRange && <div className="notice warning" role="status">
        开始日期不能晚于结束日期，当前日期范围未用于筛选。
      </div>}

      <AdminTable
        label="玩家会话列表，可横向滚动"
        isEmpty={sessions.items.length === 0}
        emptyMessage={hasFilters
          ? `当前筛选下暂无玩家会话${activeFilters.length > 0 ? `（${activeFilters.join(' · ')}）` : ''}。可清除筛选查看全部会话。`
          : '暂无玩家会话。玩家开始聊天后，会话将显示在这里。'}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">玩家</th>
              <th scope="col">角色</th>
              <th scope="col">模型档位</th>
              <th scope="col">聊天模式</th>
              <th scope="col">状态</th>
              <th scope="col">更新时间</th>
              <th scope="col">聊天历史</th>
            </tr>
          </thead>
          <tbody>
            {
              sessions.items.map((row) => {
                const s = row as SessionRow;
                return (
                <tr key={s.id}>
                  <td>{s.userName || s.userId?.slice(0, 8)}</td>
                  <td>{s.characterName || s.characterId?.slice(0, 8)}</td>
                  <td>{adminStatus(s.modelTier)}</td>
                  <td>{s.mode === 'script' || s.mode === 'free' ? MODE_LABELS[s.mode] : adminStatus(s.mode)}</td>
                  <td>
                    <span className="tag" data-status={s.status}>
                      {adminStatus(s.status)}
                    </span>
                  </td>
                  <td>
                    {s.updatedAt ? formatAdminDate(s.updatedAt as string) : '-'}
                  </td>
                  <td><Link href={`/admin/sessions/${s.id}`}>查看聊天历史</Link></td>
                </tr>
                );
              })
            }
          </tbody>
        </table>
      </AdminTable>
      <p className="muted table-total">
        共 {sessions.total} 条会话，本页显示 {sessions.items.length} 条
        {sessions.total > (sessions.page ?? 1) * (sessions.pageSize ?? PAGE_SIZE) && <>{' · '}<Link href={pageLink((sessions.page ?? 1) + 1)}>下一页</Link></>}
        {(sessions.page ?? 1) > 1 && <>{' · '}<Link href={pageLink((sessions.page ?? 1) - 1)}>上一页</Link></>}
      </p>
    </div>
  );
}
