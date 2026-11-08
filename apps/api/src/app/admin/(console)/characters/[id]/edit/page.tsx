import Link from 'next/link';
import { ROLEPLAY_AGENTS } from '@juben-sha/shared';
import { getCharacterEditState, getCharacterPreview, listPublishTasks, loadCharacterListItem, readCharacterBaseContext } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { LoadError, formatAdminDate } from '../../../../ui.js';
import { ADMIN_UUID } from '../../../../character-data.js';
import { baseContextSourceLabel, describeBaseContext, describeCharacterReadiness, describePublishTask, fieldIssueText, scriptPublishWarning } from '../../../../character-copy.js';
import { BaseContextRebuildAction, CharacterEditForm, CharacterFirstDraftAction, CharacterPublishActions, FinalizeAuditAction } from '../../../../character-forms.js';
import { characterEditValues } from '../../../../character-patch.js';
import { NotFoundError } from '@/server/http/errors.js';

const PUBLISH_TASK_LIMIT = 5;

function CharacterMissing() {
  return <div>
    <h1>角色卡不存在</h1>
    <p className="page-description">该角色可能已被移除。请返回角色卡列表重新选择。</p>
    <p><Link href="/admin/characters">返回角色卡列表</Link></p>
  </div>;
}

/**
 * Four sections: 展示资料 / 角色人设 / 开场引导 / 预览与发布.
 *
 * The editable base is the newest draft when one exists, otherwise the published version, and
 * `getCharacterEditState` returns that version's payload — persona text included — so a pending
 * draft never locks the persona section. A save carries the exact baseline of that version; a stale
 * baseline is still the documented 409.
 */
export default async function CharacterEditPage({ params }: { params: Promise<{ id: string }> }) {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  const { id } = await params;
  if (!ADMIN_UUID.test(id)) return <CharacterMissing />;

  let state: Awaited<ReturnType<typeof getCharacterEditState>>;
  try {
    state = await getCharacterEditState(id);
  } catch (cause) {
    if (cause instanceof NotFoundError) return <CharacterMissing />;
    return <LoadError subject="角色卡编辑" />;
  }

  let item: Awaited<ReturnType<typeof loadCharacterListItem>> = null;
  let preview: Awaited<ReturnType<typeof getCharacterPreview>> | null = null;
  let publishTasks: Awaited<ReturnType<typeof listPublishTasks>>;
  try {
    // Exactly this character, not the whole list with every character's payload (§9.3 scale).
    [item, preview, publishTasks] = await Promise.all([
      loadCharacterListItem(id),
      state.editable ? getCharacterPreview(id, state.editable.versionId) : Promise.resolve(null),
      listPublishTasks('character', id, PUBLISH_TASK_LIMIT),
    ]);
  } catch {
    return <LoadError subject="角色卡编辑" />;
  }
  if (!item) return <CharacterMissing />;

  // Batch 3 step 1: the derived FastClaw base context (latest recorded version vs the live files).
  // A failure to read it degrades to an explicit "无法核对" line instead of failing the page.
  let baseContext: Awaited<ReturnType<typeof readCharacterBaseContext>> | null = null;
  let baseContextReadFailed = false;
  try {
    baseContext = await readCharacterBaseContext(id);
  } catch {
    baseContextReadFailed = true;
  }
  const base = describeBaseContext(baseContext);

  const editable = state.editable;
  // The text a save starts from: the draft payload when a draft exists, otherwise the published one.
  const source = state.draft ?? state.published;
  const payload = source?.payload ?? null;
  const readiness = describeCharacterReadiness({
    status: state.status,
    publishedVersionId: state.published?.versionId ?? null,
    validity: state.published?.validity ?? null,
  });
  const task = describePublishTask(item.lastPublishTask);
  const scriptWarning = scriptPublishWarning(preview?.script?.status);
  const pendingAuditTasks = publishTasks.filter(publishTask => publishTask.recoveryState === 'audit_pending');

  return <div>
    <div className="page-heading">
      <div>
        <h1>{item.character.name}</h1>
        <p className="page-description">编辑展示资料、角色人设与开场引导；保存只生成草稿，发布后才影响线上与正式聊天。</p>
      </div>
      <Link className="button" href="/admin/characters">返回角色卡列表</Link>
    </div>

    {readiness.level === 'warning' && <div className="notice warning" role="status">
      <strong>{readiness.label}</strong>
      <ul className="issue-list">{readiness.details.map(detail => <li key={detail}>{detail}</li>)}</ul>
      <p>修复方式：在本页把人设等必填内容补全，保存一次完整草稿后发布。</p>
    </div>}

    {!editable || !payload
      ? <section className="panel" aria-labelledby="section-first-draft">
        <h2 id="section-first-draft">暂无可编辑内容</h2>
        <p className="muted" id="first-draft-note">
          该角色是早于内容版本功能建立的存量数据（或未被存量纳管覆盖的未上架角色），还没有任何内容版本，
          因此无法建立编辑基准。创建首个草稿会以该角色当前保存的展示资料
          {item.prompt ? '和已保存的角色人设' : '（该角色没有已保存的角色人设，人设段落为空）'}为起点生成草稿版本，
          之后即可用正常流程编辑、保存与发布。创建是显式操作，不会在打开本页时自动写入；
          同时执行时只会生成一个草稿，另一位管理员会收到冲突提示。
        </p>
        {state.agentId === null && <p className="muted" id="first-draft-agent-note">
          该角色尚未绑定 Agent 标识（agent_id 为空）：首个草稿创建后，本页会出现一次性 Agent 绑定选择，
          保存草稿后随发布写入。
        </p>}
        {payload == null && <CharacterFirstDraftAction characterId={id} />}
      </section>
      : <CharacterEditForm
        characterId={id}
        versionId={editable.versionId}
        versionNo={editable.versionNo}
        editedFrom={editable.source}
        agentId={state.agentId}
        agentOptions={ROLEPLAY_AGENTS.map(agent => ({ agentId: agent.agentId, name: agent.name }))}
        scriptTitle={preview?.script?.title ?? null}
        scriptStatus={preview?.script?.status ?? null}
        values={characterEditValues(payload, state.agentId, state.sortOrder)}
      />}

    <section className="panel" aria-labelledby="section-publish">
      <h2 id="section-publish">预览与发布</h2>
      <p className="muted">
        发布状态：{state.status === 'active' ? '已上架' : '未上架'}
        {state.published == null ? '（无线上版本）' : `（线上 v${state.published.versionNo}）`}
        {' · '}最近发布任务：{task.label}
        {item.lastPublishTask ? `（${formatAdminDate(item.lastPublishTask.updatedAt)}）` : ''}
      </p>
      {source && !source.validity.valid
        ? <div className="notice error" role="alert">
          <strong>该版本无法通过内容校验，发布会被拒绝：</strong>
          <ul className="issue-list">{source.validity.issues.map(issue => <li key={`${issue.path}:${issue.message}`}>{fieldIssueText(issue)}</li>)}</ul>
        </div>
        : <p className="muted">内容校验：通过。展示与开场引导可在预览页核对图片裁切与文字。</p>}
      <p><Link href={`/admin/characters/${id}/preview`}>打开展示预览</Link> · <Link href={`/admin/sessions?characterId=${id}`}>查看该角色的玩家会话</Link></p>
      {scriptWarning && <div className="notice warning" role="status" data-preflight="script">
        <strong>{scriptWarning}</strong>
        <p>草稿仍可保存；上架剧本后才能发布此角色。</p>
      </div>}
      <CharacterPublishActions
        characterId={id}
        versionId={editable?.versionId ?? null}
        versionNo={editable?.versionNo ?? null}
        published={state.status === 'active'}
        canPublish={Boolean(editable)}
        canUnpublish={state.status === 'active'}
        preflightWarning={state.preflight.warning}
      />
    </section>

    <section className="panel" aria-labelledby="section-base-context" data-base-context-status={baseContextReadFailed ? 'read-failed' : baseContext?.status ?? 'unknown'}>
      <h2 id="section-base-context">基础上下文（FastClaw 派生缓存）</h2>
      <p>
        基础上下文：{baseContextReadFailed
          ? <span className="tag warn">无法读取基础上下文状态</span>
          : <>
            <strong data-base-context-badge>{base.badge}</strong>
            {baseContext?.recorded ? ` · ${formatAdminDate(baseContext.recorded.createdAt)} · ${baseContextSourceLabel(baseContext.recorded.source)}` : ''}
            {' · '}<span className={`tag ${base.tone === 'ok' ? 'ok' : 'warn'}`} data-base-context-label>{base.label}</span>
          </>}
      </p>
      {base.notice && <div className="notice warning" role="status" data-base-context-notice>
        <strong>{base.notice}</strong>
        <p>按已发布版本重建会覆盖控制台手改；不重建时运行时会话仍使用控制台里的实时文件。</p>
      </div>}
      {!baseContextReadFailed && baseContext?.recorded && baseContext.matchesPublished === false && <div className="notice warning" role="status" data-base-context-stale>
        <strong>已发布版本还没有写入 FastClaw</strong>
        <p>当前记录对应更早的已发布版本（发布时的写入未成功或尚未执行）。重建会重新写入并记录；发布结果本身不受影响。</p>
      </div>}
      <p className="muted">
        运行人设 = 基础上下文（SOUL.md / IDENTITY.md / USER.md，本页可追溯的记录）+ 按回合注入的已发布版本人设 + 记忆与输出约束；
        运行时会话仍使用控制台里的实时文件。
        这里显示的是<b>当前版本</b>：最近一次写入 FastClaw 并通过回读校验的记录（内容回到旧版本时也以当前指针为准）。
        发布成功后会按已发布版本重新生成这三份文件并写入 FastClaw，内容未变化时不新增记录；控制台手改会在下次发布或重建时被覆盖。
        记录的是采集时刻的内容，记忆与用户画像仍由 FastClaw 维护，不在此范围内。
      </p>
      <BaseContextRebuildAction characterId={id} disabled={baseContextReadFailed} />
    </section>

    <section className="panel" aria-labelledby="section-publish-tasks">
      <h2 id="section-publish-tasks">发布任务记录</h2>
      <p className="muted">只显示该角色最近 {PUBLISH_TASK_LIMIT} 次发布尝试，用于追踪处理中、失败与审计恢复状态。</p>
      {publishTasks.length === 0
        ? <p className="empty">该角色还没有发布任务记录。</p>
        : <>
          {pendingAuditTasks.length > 0 && <p className="muted">
            有 {pendingAuditTasks.length} 个任务已提交但审计仍待恢复。可尝试完成审计收尾：只补记缺失的审计结果，不会重新执行发布；审计依据无法确认时会返回冲突，发布结果保持不变。
          </p>}
          <div className="table-wrap" role="region" aria-label="发布任务列表，可横向滚动" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">绑定版本</th>
                  <th scope="col">任务结果</th>
                  <th scope="col">恢复状态</th>
                  <th scope="col">失败原因</th>
                  <th scope="col">创建时间</th>
                  <th scope="col">更新时间</th>
                  <th scope="col">审计收尾</th>
                </tr>
              </thead>
              <tbody>
                {publishTasks.map((publishTask) => {
                  const taskState = describePublishTask(publishTask);
                  return <tr key={publishTask.id} data-publish-task-id={publishTask.id}>
                    <td>{publishTask.versionNo == null ? '版本未知' : `版本 v${publishTask.versionNo}`}</td>
                    <td><span className={`tag ${taskState.tone === 'ok' ? 'ok' : taskState.tone === 'error' ? 'error' : taskState.tone === 'warn' ? 'warn' : ''}`}>{taskState.label}</span></td>
                    <td>{publishTask.recoveryState === 'audit_pending' ? '审计待恢复' : publishTask.recoveryState ?? '无'}</td>
                    <td>{publishTask.lastError ?? '—'}</td>
                    <td>{formatAdminDate(publishTask.createdAt)}</td>
                    <td>{formatAdminDate(publishTask.updatedAt)}</td>
                    <td>{publishTask.recoveryState === 'audit_pending'
                      ? <FinalizeAuditAction taskId={publishTask.id} />
                      : '—'}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </>}
    </section>
  </div>;
}
