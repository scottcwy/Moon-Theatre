import Link from 'next/link';
import { getCharacterPreview, loadCharacterListItem, readCharacterBaseContext } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { NotFoundError } from '@/server/http/errors.js';
import { LoadError, formatAdminDate } from '../../../../ui.js';
import { ADMIN_UUID } from '../../../../character-data.js';
import { baseContextSourceLabel, describeBaseContext, describeCharacterReadiness, describeImageRisks, describePublishTask, fieldIssueText, scriptPublishWarning } from '../../../../character-copy.js';
import { BaseContextRebuildAction, CharacterPublishActions } from '../../../../character-forms.js';

function CharacterMissing() {
  return <div>
    <h1>角色卡不存在</h1>
    <p className="page-description">该角色可能已被移除。请返回角色卡列表重新选择。</p>
    <p><Link href="/admin/characters">返回角色卡列表</Link></p>
  </div>;
}

/** Neither a draft nor a published version exists: nothing to preview, and the page says which. */
function NoContentVersion({ requested, characterId }: { requested: boolean; characterId: string }) {
  return <div>
    <h1>展示预览不可用</h1>
    {requested
      ? <p className="page-description">该版本不存在，或不属于这张角色卡。请返回编辑页重新打开预览。</p>
      : <>
        <p className="page-description">该角色还没有任何内容版本（既没有草稿，也没有线上版本），因此无法预览。</p>
        <p className="muted">预览需要一个内容版本：在编辑页使用“创建首个草稿”以该角色当前保存的资料生成首个草稿，之后即可预览、保存并发布。</p>
      </>}
    <p>
      <Link href={`/admin/characters/${characterId}/edit`}>去编辑页创建首个草稿</Link>
      {' · '}
      <Link href="/admin/characters">返回角色卡列表</Link>
    </p>
  </div>;
}

/**
 * Display preview only: the script card, the character detail and the starter questions exactly as
 * stored, plus the validity marker and the image risks that can be judged from the payload. No chat,
 * no generation, no image processing — persona prompt text is never part of this surface.
 */
export default async function CharacterPreviewPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  const { id } = await params;
  const query = (await searchParams) ?? {};
  if (!ADMIN_UUID.test(id)) return <CharacterMissing />;
  const requested = typeof query.versionId === 'string' && ADMIN_UUID.test(query.versionId) ? query.versionId : undefined;

  let item: Awaited<ReturnType<typeof loadCharacterListItem>> = null;
  let preview: Awaited<ReturnType<typeof getCharacterPreview>>;
  try {
    // One character's publish state, not the whole list with every character's payload.
    item = await loadCharacterListItem(id);
  } catch {
    return <LoadError subject="角色卡预览" />;
  }
  if (!item) return <CharacterMissing />;
  try {
    preview = await getCharacterPreview(id, requested);
  } catch (cause) {
    // A missing version is not a dependency failure: say which version is unavailable.
    if (cause instanceof NotFoundError) return <NoContentVersion requested={Boolean(requested)} characterId={id} />;
    return <LoadError subject="角色卡预览" />;
  }

  // S1 readiness judges the *live* content (published payload from the list read), while the header
  // and `#preview-validity` judge the version being previewed. A bad draft never alarms a healthy
  // published character, and an unusable live version is still reported when a draft previews fine.
  const readiness = describeCharacterReadiness({
    status: item.publishState.status,
    publishedVersionId: item.publishState.publishedVersionId,
    validity: item.publishedValidity ?? null,
  });
  const risks = describeImageRisks({
    avatarUrl: preview.card.avatarUrl,
    scriptCoverUrl: preview.script?.coverUrl ?? null,
    scriptTitle: preview.script?.title ?? null,
  });
  const task = describePublishTask(item.lastPublishTask);
  const scriptWarning = scriptPublishWarning(preview.script?.status);
  const targetVersionId = item.draftState.draftVersionId ?? item.publishState.publishedVersionId;
  const targetVersionNo = item.draftState.draftVersionId ? item.draftState.draftVersionNo : item.publishState.publishedVersionNo;
  const previewedIsPublished = preview.versionStatus === 'published';
  // Batch 3 step 1: the derived base context is reported next to the publish controls, because that is
  // where the two facts diverge (published version vs what the FastClaw console actually holds).
  let baseContext: Awaited<ReturnType<typeof readCharacterBaseContext>> | null = null;
  let baseContextReadFailed = false;
  try {
    baseContext = await readCharacterBaseContext(id);
  } catch {
    baseContextReadFailed = true;
  }
  const base = describeBaseContext(baseContext);

  return <div>
    <div className="page-heading">
      <div>
        <h1>展示预览 · {preview.card.name || item.character.name}</h1>
        <p className="page-description">
          正在预览：<span
            className={`tag ${previewedIsPublished ? 'ok' : 'warn'}`}
            data-preview-version-no={preview.versionNo}
            data-preview-version-status={preview.versionStatus}
          >{previewedIsPublished ? `线上版本 v${preview.versionNo}` : `草稿 v${preview.versionNo}（尚未发布）`}</span>
          {' · '}内容校验：{preview.validity.valid ? '通过' : `${preview.validity.issues.length} 项未通过`}
          {' · '}发布状态：{item.publishState.status === 'active' ? '已上架' : '未上架'}
          {' · '}最近发布任务：{task.label}
        </p>
        <p className="muted">{requested
          ? `已指定版本 v${preview.versionNo} 预览；发布目标仍是发布动作中标注的选定版本（草稿优先）。`
          : '未指定版本：默认预览最新草稿；没有草稿时预览线上版本。发布会使用同一原则选定的版本。'}</p>
      </div>
      <Link className="button" href={`/admin/characters/${id}/edit`}>返回编辑</Link>
    </div>

    {readiness.level === 'warning' && <div className="notice warning" role="status">
      <strong>{readiness.label}</strong>
      <ul className="issue-list">{readiness.details.map(detail => <li key={detail}>{detail}</li>)}</ul>
      <p><Link href={`/admin/characters/${id}/edit`}>去补全人设并发布</Link></p>
    </div>}

    <div className="preview-grid">
      <section className="panel preview-card" aria-labelledby="preview-script">
        <h2 id="preview-script">剧本卡片</h2>
        {preview.script
          ? <>
            <div className="preview-cover">{preview.script.coverUrl ? <img src={preview.script.coverUrl} alt={`剧本《${preview.script.title}》封面预览`} /> : <span>封面未配置</span>}</div>
            <p><strong>{preview.script.title}</strong></p>
            <p className="muted">{preview.scriptSnapshot?.worldSetting || '未记录世界观快照'}</p>
            <p className="muted identifier">slug: {preview.script.slug}</p>
          </>
          : <p className="muted">无剧本（仅自由聊天）：不会展示剧本卡片。</p>}
      </section>

      <section className="panel preview-card" aria-labelledby="preview-detail">
        <h2 id="preview-detail">角色详情</h2>
        <div className="preview-avatar">{preview.detail.avatarUrl ? <img src={preview.detail.avatarUrl} alt={`角色${preview.detail.name}头像预览`} /> : <span>头像未配置</span>}</div>
        <p><strong>{preview.detail.name}</strong> · {preview.detail.identity}</p>
        <p className="muted">{preview.detail.description}</p>
        <dl>
          <dt>关系起点</dt><dd>{preview.detail.initialRelationship}</dd>
          <dt>可用模式</dt><dd>{preview.availableModes.includes('script') ? '剧本模式 + 自由模式' : '仅自由模式'}</dd>
        </dl>
      </section>

      <section className="panel preview-card" aria-labelledby="preview-questions">
        <h2 id="preview-questions">开场提问</h2>
        <h3>剧本模式</h3>
        {preview.starterQuestions.script.length > 0
          ? <ul>{preview.starterQuestions.script.map((question, index) => <li key={`script-${index}`}>{question}</li>)}</ul>
          : <p className="muted">未设置剧本开场提问。</p>}
        <h3>自由模式</h3>
        {preview.starterQuestions.free.length > 0
          ? <ul>{preview.starterQuestions.free.map((question, index) => <li key={`free-${index}`}>{question}</li>)}</ul>
          : <p className="muted">未设置自由开场提问。</p>}
      </section>
    </div>

    <section className="panel" aria-labelledby="preview-validity">
      <h2 id="preview-validity">校验与素材风险</h2>
      {preview.validity.valid
        ? <p className="muted">内容校验通过：展示字段、五段人设与开场引导均可发布。</p>
        : <div className="notice error" role="alert">
          <strong>内容校验未通过，发布会被拒绝：</strong>
          <ul className="issue-list">{preview.validity.issues.map(issue => <li key={`${issue.path}:${issue.message}`}>{fieldIssueText(issue)}</li>)}</ul>
        </div>}
      <ul className="issue-list">{risks.map(risk => <li key={risk.message} className={risk.level === 'warning' ? 'error' : 'muted'}>{risk.message}</li>)}</ul>
    </section>

    <section className="panel" aria-labelledby="preview-publish">
      <h2 id="preview-publish">发布与下架</h2>
      <p className="muted">发布会把选定版本切换为线上版本：新回合使用该版本，进行中的回合按原版本结束。发布任务与审计结果会持久记录。</p>
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
        <p>运行时会话仍使用 FastClaw 控制台里的实时文件；按已发布版本重建会覆盖手改。</p>
        <BaseContextRebuildAction characterId={id} />
      </div>}
      {!baseContextReadFailed && baseContext?.recorded && baseContext.matchesPublished === false && <p className="notice warning" role="status" data-base-context-stale>
        已发布版本还没有写入 FastClaw：可重建基础上下文，或重新发布一次。
      </p>}
      {scriptWarning && <div className="notice warning" role="alert" data-preflight="script">
        <strong>{scriptWarning}</strong>
        <p>内容校验通过并不代表可发布：草稿仍可保存，上架剧本后才能发布此角色。</p>
      </div>}
      <CharacterPublishActions
        characterId={id}
        versionId={targetVersionId}
        versionNo={targetVersionNo}
        published={item.publishState.status === 'active'}
        canPublish={Boolean(targetVersionId)}
        canUnpublish={item.publishState.status === 'active'}
        preflightWarning={preview.preflight.warning}
      />
    </section>
  </div>;
}
