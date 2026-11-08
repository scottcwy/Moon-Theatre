import Link from 'next/link';
import { getAdminScriptCoverState } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { NotFoundError } from '@/server/http/errors.js';
import { LoadError, formatAdminDate } from '../../../ui.js';
import { ADMIN_UUID } from '../../../character-data.js';
import { ScriptCoverForm } from '../../../scripts-forms.js';

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
 */
export default async function ScriptCoverPage({ params }: { params: Promise<{ id: string }> }) {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  const { id } = await params;
  if (!ADMIN_UUID.test(id)) return <ScriptMissing />;

  let state: Awaited<ReturnType<typeof getAdminScriptCoverState>>;
  try {
    state = await getAdminScriptCoverState(id);
  } catch (cause) {
    if (cause instanceof NotFoundError) return <ScriptMissing />;
    return <LoadError subject="剧本封面" />;
  }

  const baselineIso = new Date(state.baselineAt).toISOString();

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
  </div>;
}
