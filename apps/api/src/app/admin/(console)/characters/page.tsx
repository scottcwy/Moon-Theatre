import Link from 'next/link';
import { listAdminCharacters, listAdminScripts } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { AdminTable, formatAdminDate, LoadError } from '../../ui.js';
import {
  CHARACTER_PAGE_INVALID,
  CHARACTER_QUERY_TOO_LONG,
  CHARACTER_SEARCH_MAX_LENGTH,
  CHARACTER_STATUS_FILTER_INVALID,
  CHARACTER_STATUS_LABELS,
  CHARACTER_UNPUBLISH_ANCHOR,
  CHARACTER_UNPUBLISH_ENTRY,
  characterFieldLabel,
  describeCharacterReadiness,
  describePublishTask,
} from '../../character-copy.js';

type SearchParams = Record<string, string | string[] | undefined>;

const PAGE_SIZE = 20;

function first(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

/**
 * Character list (AC-18): one bounded page plus a count, never the whole table. Publish status, draft
 * divergence and the last publish task stay three separate columns, and each row's payload validity
 * comes from the same page read instead of a preview read per character.
 *
 * The search term matches the character name, the agent id or the bound script title; an unusable
 * value is reported and not applied rather than silently widening a 1000-character list.
 */
export default async function CharactersPage(props: { searchParams?: Promise<SearchParams> }) {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  const query = (await props?.searchParams) ?? {};
  const rawTerm = first(query.q);
  const rawStatus = first(query.status);
  const rawPage = first(query.page);
  const parsedPage = Number.parseInt(rawPage ?? '1', 10);
  const pageInvalid = rawPage !== undefined && rawPage !== '' && (!Number.isInteger(parsedPage) || parsedPage < 1);
  const requestedPage = pageInvalid ? 1 : Math.max(1, parsedPage);

  const trimmedTerm = rawTerm?.trim() ?? '';
  const term = trimmedTerm.length > 0 && trimmedTerm.length <= CHARACTER_SEARCH_MAX_LENGTH ? trimmedTerm : undefined;
  const validStatus = rawStatus === 'active' || rawStatus === 'inactive' ? rawStatus : undefined;
  const hasFilters = Boolean(term || validStatus);

  let characters: Awaited<ReturnType<typeof listAdminCharacters>>;
  let scripts: Awaited<ReturnType<typeof listAdminScripts>>;
  try {
    [characters, scripts] = await Promise.all([
      listAdminCharacters({
        page: requestedPage,
        pageSize: PAGE_SIZE,
        ...(term ? { query: term } : {}),
        ...(validStatus ? { status: validStatus } : {}),
      }),
      listAdminScripts(),
    ]);
  } catch {
    return <LoadError subject="角色卡" />;
  }
  const scriptTitles = new Map(scripts.map(script => [script.id, script.title]));

  const activeFilters = [
    ...(term ? [`关键词「${term}」`] : []),
    ...(validStatus ? [CHARACTER_STATUS_LABELS[validStatus]] : []),
  ];

  const pageLink = (target: number) => {
    const params = new URLSearchParams();
    params.set('page', String(target));
    if (term) params.set('q', term);
    if (validStatus) params.set('status', validStatus);
    return `/admin/characters?${params.toString()}`;
  };
  const lastPage = Math.max(1, Math.ceil(characters.total / characters.pageSize));

  return (
    <div>
      <div className="page-heading">
        <div>
          <h1>角色卡片</h1>
          <p className="page-description">维护角色卡的展示资料、人设与开场引导，发布后进入该角色的玩家会话查看聊天历史。</p>
        </div>
        <Link className="button primary" href="/admin/characters/new">新建角色</Link>
      </div>

      <form className="filter-bar" method="get" action="/admin/characters" aria-label="搜索角色卡">
        <label>搜索关键词
          <input name="q" defaultValue={rawTerm ?? ''} maxLength={CHARACTER_SEARCH_MAX_LENGTH + 1} placeholder="角色名 / Agent 标识 / 剧本标题" spellCheck={false} autoCapitalize="none" />
        </label>
        <label>发布状态
          <select name="status" defaultValue={validStatus ?? ''}>
            <option value="">全部</option>
            <option value="active">已上架</option>
            <option value="inactive">未上架</option>
          </select>
        </label>
        <button className="primary" type="submit">搜索</button>
        {hasFilters && <Link className="button" href="/admin/characters">清除筛选</Link>}
      </form>

      {activeFilters.length > 0 && <p className="muted filter-summary" role="status">当前筛选：{activeFilters.join(' · ')}</p>}
      {rawStatus && !validStatus && <div className="notice warning" role="status">{CHARACTER_STATUS_FILTER_INVALID}</div>}
      {rawTerm && !term && <div className="notice warning" role="status">{CHARACTER_QUERY_TOO_LONG}</div>}
      {pageInvalid && <div className="notice warning" role="status">{CHARACTER_PAGE_INVALID}</div>}

      <AdminTable
        label="角色卡列表，可横向滚动"
        isEmpty={characters.items.length === 0}
        emptyMessage={hasFilters
          ? `当前筛选下没有匹配的角色卡（${activeFilters.join(' · ')}）。可清除筛选查看全部角色。`
          : '暂无角色卡。可以用“新建角色”先创建一张草稿，补全人设后再发布。'}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">角色</th>
              <th scope="col">归属剧本</th>
              <th scope="col">发布状态</th>
              <th scope="col">草稿变更</th>
              <th scope="col">最近发布任务</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {characters.items.map((item) => {
              const id = item.character.id;
              const readiness = describeCharacterReadiness({
                status: item.publishState.status,
                publishedVersionId: item.publishState.publishedVersionId,
                validity: item.publishedValidity,
              });
              const task = describePublishTask(item.lastPublishTask);
              return (
                <tr key={id} data-character-id={id}>
                  <td>
                    <strong>{item.character.name}</strong>
                    <span className="under identifier">{item.character.agentId ?? '未绑定 Agent 标识'}</span>
                    {/* Mobile (§4.1): reachable without horizontally scrolling the table to the last column. */}
                    {item.publishState.status === 'active' && <span className="under">
                      <Link href={`/admin/characters/${id}/preview#${CHARACTER_UNPUBLISH_ANCHOR}`} data-character-unpublish-entry>{CHARACTER_UNPUBLISH_ENTRY}</Link>
                    </span>}
                    {readiness.level === 'warning' && <p className="notice warning" role="status">
                      {readiness.label}
                      <span className="under"><Link href={`/admin/characters/${id}/edit`}>去补全人设并发布</Link></span>
                    </p>}
                  </td>
                  <td>{item.character.scriptId ? scriptTitles.get(item.character.scriptId) ?? item.character.scriptId : '无剧本（仅自由聊天）'}</td>
                  <td>
                    <span className="tag" data-status={item.publishState.status}>{item.publishState.status === 'active' ? '已上架' : '未上架'}</span>
                    <span className="under">{item.publishState.publishedVersionNo == null ? '无线上版本' : `线上 v${item.publishState.publishedVersionNo}`}</span>
                  </td>
                  <td>
                    {item.draftState.hasDraft ? <>
                      <span className="tag warn">有草稿改动</span>
                      <span className="under">{item.draftState.changedFields.map(characterFieldLabel).join('、') || '内容未变化'}</span>
                      <span className="under">草稿 v{item.draftState.draftVersionNo}</span>
                    </> : <span className="tag">无草稿</span>}
                  </td>
                  <td>
                    <span className={`tag ${task.tone === 'ok' ? 'ok' : task.tone === 'error' ? 'error' : task.tone === 'warn' ? 'warn' : ''}`}>{task.label}</span>
                    <span className="under">{item.lastPublishTask ? formatAdminDate(item.lastPublishTask.updatedAt) : '尚未发布'}</span>
                    {item.lastPublishTask?.lastError && <details className="note-cell"><summary>查看失败原因</summary><p className="muted">{item.lastPublishTask.lastError}</p></details>}
                  </td>
                  <td className="character-actions">
                    <Link href={`/admin/characters/${id}/edit`}>编辑</Link>
                    <Link href={`/admin/characters/${id}/preview`}>预览</Link>
                    <Link href={`/admin/sessions?characterId=${id}`}>玩家会话</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </AdminTable>
      <p className="muted table-total">
        共 {characters.total} 个角色，本页显示 {characters.items.length} 个（第 {characters.page} / {lastPage} 页）
        {characters.page < lastPage && <>{' · '}<Link href={pageLink(characters.page + 1)}>下一页</Link></>}
        {characters.page > 1 && <>{' · '}<Link href={pageLink(characters.page - 1)}>上一页</Link></>}
        {' · '}发布状态、草稿变更与最近发布结果是三件独立的事，不合并成一个状态。
      </p>
    </div>
  );
}
