import Link from 'next/link';
import { listAdminCharacters, listAdminScripts } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { AdminTable, formatAdminDate, LoadError } from '../../ui.js';
import { characterFieldLabel, describeCharacterReadiness, describePublishTask } from '../../character-copy.js';

/**
 * Character list: publish status, draft divergence and the last publish result stay three separate
 * columns, plus the reason a live character cannot answer new turns.
 */
export default async function CharactersPage() {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;

  let characters: Awaited<ReturnType<typeof listAdminCharacters>>;
  let scripts: Awaited<ReturnType<typeof listAdminScripts>>;
  try {
    // Readiness rides on the list read itself (`publishedValidity`), so the list costs one query
    // set regardless of how many characters are published.
    [characters, scripts] = await Promise.all([listAdminCharacters(), listAdminScripts()]);
  } catch {
    return <LoadError subject="角色卡" />;
  }
  const scriptTitles = new Map(scripts.map(script => [script.id, script.title]));

  return (
    <div>
      <div className="page-heading">
        <div>
          <h1>角色卡片</h1>
          <p className="page-description">维护角色卡的展示资料、人设与开场引导，发布后进入该角色的玩家会话查看聊天历史。</p>
        </div>
        <Link className="button primary" href="/admin/characters/new">新建角色</Link>
      </div>
      <AdminTable
        label="角色卡列表，可横向滚动"
        isEmpty={characters.length === 0}
        emptyMessage="暂无角色卡。可以用“新建角色”先创建一张草稿，补全人设后再发布。"
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
            {characters.map((item) => {
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
      <p className="muted table-total">共 {characters.length} 个角色 · 发布状态、草稿变更与最近发布结果是三件独立的事，不合并成一个状态。</p>
    </div>
  );
}
