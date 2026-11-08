import Link from 'next/link';
import { getAdminScriptCoverState, listPublishTasks } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { NotFoundError } from '@/server/http/errors.js';
import { LoadError, formatAdminDate } from '../../../ui.js';
import { ADMIN_UUID } from '../../../character-data.js';
import { describePublishTask } from '../../../character-copy.js';
import { AUDIT_RECOVERY_COPY } from '../../../audit-recovery-copy.js';
import { FinalizeAuditAction } from '../../../audit-recovery.js';
import { ScriptCoverForm } from '../../../scripts-forms.js';

const PUBLISH_TASK_LIMIT = 5;

function ScriptMissing() {
  return <div>
    <h1>剧本不存在</h1>
    <p className="page-description">该剧本可能已被移除。请返回剧本封面列表重新选择。</p>
    <p><Link href="/admin/scripts">返回剧本封面列表</Link></p>
  </div>;
}

/**
 * Cover-only editor. It shows the live cover, the newest draft and the strict PATCH baseline as
 * three separate facts, and never renders the local filesystem path of an asset.
 *
 * The bounded publish-task history below is the recovery entry point (AC-19): a task whose published
 * business result committed but whose audit settle failed stays `audit_pending`, and the shared
 * finalize-only action completes that intent. It never re-publishes the cover and reads only the
 * existing task list — there is no second status source.
 */
export default async function ScriptCoverPage({ params }: { params: Promise<{ id: string }> }) {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  const { id } = await params;
  if (!ADMIN_UUID.test(id)) return <ScriptMissing />;

  let state: Awaited<ReturnType<typeof getAdminScriptCoverState>>;
  let publishTasks: Awaited<ReturnType<typeof listPublishTasks>>;
  try {
    state = await getAdminScriptCoverState(id);
    publishTasks = await listPublishTasks('script', id, PUBLISH_TASK_LIMIT);
  } catch (cause) {
    if (cause instanceof NotFoundError) return <ScriptMissing />;
    return <LoadError subject="剧本封面" />;
  }

  const baselineIso = new Date(state.baselineAt).toISOString();
  const pendingAuditTasks = publishTasks.filter(task => task.recoveryState === 'audit_pending');

  return <div>
    <div className="page-heading">
      <div>
        <h1>剧本封面 · {state.script.title}</h1>
        <p className="page-description">只维护封面素材：保存会生成剧本草稿，发布后小程序生效；已发布版本引用的旧封面继续可访问。</p>
      </div>
      <Link className="button" href="/admin/scripts">返回剧本封面列表</Link>
    </div>

    <section className="panel" aria-labelledby="script-cover-facts">
      <h2 id="script-cover-facts">当前状态</h2>
      <dl>
        <dt>上架状态</dt>
        <dd><span className="tag" data-status={state.script.status}>{state.script.status === 'active' ? '已上架' : '未上架'}</span></dd>
        <dt>线上封面</dt>
        <dd>{state.script.coverUrl ?? '未配置'}</dd>
        <dt>最新草稿</dt>
        <dd>{state.draftVersionNo == null
          ? '无草稿'
          : `v${state.draftVersionNo}（封面：${state.draftCoverUrl ?? '未配置'}）`}</dd>
        <dt>保存基准</dt>
        <dd><time dateTime={baselineIso} data-script-cover-baseline={baselineIso}>{formatAdminDate(state.baselineAt)}</time></dd>
      </dl>
      <p className="muted">保存基准用于发现并发编辑：若其他管理员已保存，本页保存会被拒绝并要求刷新，不会静默覆盖。</p>
    </section>

    <section className="panel" aria-labelledby="script-cover-form-heading">
      <h2 id="script-cover-form-heading">封面素材</h2>
      <ScriptCoverForm
        scriptId={state.script.id}
        title={state.script.title}
        status={state.script.status}
        coverUrl={state.editableCoverUrl}
        draftVersionNo={state.draftVersionNo}
        baselineAt={baselineIso}
      />
    </section>

    <section className="panel" aria-labelledby="script-publish-tasks">
      <h2 id="script-publish-tasks">发布任务记录</h2>
      <p className="muted">只显示该剧本最近 {PUBLISH_TASK_LIMIT} 次封面发布尝试，用于追踪处理中、失败与审计恢复状态。</p>
      {publishTasks.length === 0
        ? <p className="empty">该剧本还没有发布任务记录。</p>
        : <>
          {pendingAuditTasks.length > 0 && <p className="muted">
            有 {pendingAuditTasks.length} 个任务已提交但审计仍待恢复。可尝试完成审计收尾。{AUDIT_RECOVERY_COPY.note}
          </p>}
          <div className="table-wrap" role="region" aria-label="剧本发布任务列表，可横向滚动" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">绑定版本</th>
                  <th scope="col">任务结果</th>
                  <th scope="col">恢复状态</th>
                  <th scope="col">失败原因</th>
                  <th scope="col">更新时间</th>
                  <th scope="col">审计收尾</th>
                </tr>
              </thead>
              <tbody>
                {publishTasks.map(publishTask => {
                  const taskState = describePublishTask(publishTask);
                  return <tr key={publishTask.id} data-publish-task-id={publishTask.id}>
                    <td>{publishTask.versionNo == null ? '版本未知' : `版本 v${publishTask.versionNo}`}</td>
                    <td><span className="tag" data-status={taskState.tone === 'ok' ? 'active' : taskState.tone === 'error' ? 'failed' : taskState.tone === 'warn' ? 'pending' : 'inactive'}>{taskState.label}</span></td>
                    <td>{publishTask.recoveryState === 'audit_pending' ? '审计待恢复' : publishTask.recoveryState ?? '无'}</td>
                    <td>{publishTask.lastError ?? '—'}</td>
                    <td>{formatAdminDate(publishTask.updatedAt)}</td>
                    <td>{publishTask.recoveryState === 'audit_pending'
                      ? <FinalizeAuditAction
                        endpoint={`/api/admin/publish-tasks/${encodeURIComponent(publishTask.id)}/finalize-audit`}
                        identifier={publishTask.id}
                      />
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
