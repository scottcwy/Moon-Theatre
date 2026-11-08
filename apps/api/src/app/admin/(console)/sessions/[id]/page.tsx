import Link from 'next/link';
import { getSessionMetadata, listMessages, recordAdminAudit } from '@/server/modules/admin/index.js';
import { getTurnVersionAttributions } from '@/server/modules/chat/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { LoadError, adminStatus, formatAdminDate } from '../../../ui.js';
import { ADMIN_UUID } from '../../../character-data.js';

const PAGE_SIZE = 20;

type SearchParams = Record<string, string | string[] | undefined>;

interface TranscriptMessage {
  id: string;
  role: string;
  content: string;
  mood: string | null;
  modelTier: string | null;
  tokensUsed: number | null;
  pointsConsumed: number | null;
  createdAt: Date | string;
}

function first(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

export default async function SessionHistoryPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const identity = await requireAdminPageAuth();
  if (!identity) return <AdminIdentityRequired />;
  const { id } = await params;
  const query = (await searchParams) ?? {};
  if (!ADMIN_UUID.test(id)) {
    return <div><h1>会话不存在</h1><p><Link href="/admin/sessions">返回玩家会话</Link></p></div>;
  }
  const requestedPage = Number.parseInt(first(query.page) ?? '1', 10);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  let detail: Awaited<ReturnType<typeof getSessionMetadata>>;
  try {
    // Metadata only (G3): the transcript is read page by page below, never loaded to render the header.
    detail = await getSessionMetadata(id);
  } catch {
    return <LoadError subject="会话" />;
  }

  let transcript: Awaited<ReturnType<typeof listMessages>>;
  let attributions: Awaited<ReturnType<typeof getTurnVersionAttributions>>;
  try {
    transcript = await listMessages({ sessionId: id, page, pageSize: PAGE_SIZE });
    const rows = transcript.items as TranscriptMessage[];
    attributions = await getTurnVersionAttributions(rows.filter(row => row.role === 'user').map(row => row.id));
  } catch {
    return <LoadError subject="聊天历史" />;
  }
  const rows = transcript.items as TranscriptMessage[];
  const byMessage = new Map(attributions.map(attribution => [attribution.userMessageId, attribution]));
  // One shared explanation for every turn that has no snapshot: the badge is text, not a dead link.
  const hasUnknownVersion = rows.some(row => row.role === 'user' && (byMessage.get(row.id)?.versionUnknown ?? true));

  try {
    await recordAdminAudit({
      actor: { kind: 'admin_account', adminAccountId: identity.adminAccountId },
      action: 'admin.chat_session.read',
      objectType: 'chat_session',
      objectId: id,
      result: 'committed',
      summary: { page: transcript.page, pageSize: transcript.pageSize, messageCount: rows.length, source: 'admin_page' },
    });
  } catch {
    return <section className="notice error" role="alert">
      <h1>无法记录本次聊天原文访问</h1>
      <p>聊天原文仅在访问审计持久化成功后展示。请稍后重试；若持续失败，请联系服务器维护人员。</p>
      <p><Link href="/admin/sessions">返回玩家会话</Link></p>
    </section>;
  }

  const totalPages = Math.max(1, Math.ceil(transcript.total / (transcript.pageSize || PAGE_SIZE)));
  const pageLink = (target: number) => `/admin/sessions/${id}?page=${target}`;

  return <div>
    <div className="page-heading">
      <div>
        <h1>聊天历史</h1>
        <p className="page-description">每个回合关联接受时的角色卡发布版本，点击版本标签可打开该回合使用的历史版本内容；基础上下文标签是该回合接受时记录的 FastClaw 基础上下文版本，没有记录时明确显示“基础上下文未记录”，不做推断。</p>
      </div>
      <Link className="button" href="/admin/sessions">返回会话列表</Link>
    </div>

    <section className="panel" aria-labelledby="session-meta">
      <h2 id="session-meta">会话信息</h2>
      <dl>
        <dt>玩家</dt><dd>{detail.userName || detail.userId}</dd>
        <dt>角色</dt><dd>{detail.characterName || detail.characterId}</dd>
        <dt>聊天模式</dt><dd>{detail.mode === 'script' ? '剧本模式' : '自由模式'}</dd>
        <dt>模型档位</dt><dd>{adminStatus(detail.modelTier)}</dd>
        <dt>会话状态</dt><dd><span className="tag" data-status={detail.status}>{adminStatus(detail.status)}</span></dd>
        <dt>创建时间</dt><dd>{formatAdminDate(detail.createdAt)}</dd>
        <dt>更新时间</dt><dd>{formatAdminDate(detail.updatedAt)}</dd>
        <dt>会话 ID</dt><dd className="identifier">{detail.id}</dd>
      </dl>
      <p><Link href={`/admin/characters/${detail.characterId}/edit`}>返回角色编辑</Link></p>
    </section>

    <section className="panel" aria-labelledby="session-transcript">
      <h2 id="session-transcript">聊天记录（第 {transcript.page} / {totalPages} 页，共 {transcript.total} 条）</h2>
      {rows.length === 0
        ? <p className="empty">本页没有消息。该会话可能还没有开始聊天，或该页已超出范围。</p>
        : <ol className="transcript">
          {rows.map(message => {
            const attribution = byMessage.get(message.id);
            return <li key={message.id} className="transcript-item" data-role={message.role}>
              <div className="transcript-meta">
                <span className="tag">{message.role === 'user' ? '玩家提问' : message.role === 'assistant' ? '角色回复' : '系统'}</span>
                {message.role === 'user' && (attribution && !attribution.versionUnknown
                  // AC-25 "可查看对应内容": the badge opens exactly this turn's version on the guarded
                  // preview page, which already renders any explicit `?versionId=` of the character.
                  ? <>
                    <Link
                      className="tag ok"
                      href={`/admin/characters/${detail.characterId}/preview?versionId=${attribution.contentVersionId}`}
                      title="打开该回合使用的角色卡版本内容"
                    >版本 v{attribution.contentVersionNo}</Link>
                    {' · '}
                    {/* Batch 3 step 1: the base context recorded at accept time, as a separate fact. */}
                    {attribution.agentContextVersionNo != null
                      ? <span className="tag ok" data-base-context-badge title="该回合接受时记录的 FastClaw 基础上下文版本">基础上下文 b{attribution.agentContextVersionNo}</span>
                      : <span className="tag warn" data-base-context-badge>基础上下文未记录</span>}
                  </>
                  : <span className="tag warn" aria-describedby={hasUnknownVersion ? 'version-unknown-note' : undefined}>版本未知</span>)}
                <span className="under">{formatAdminDate(message.createdAt)}{message.mood ? ` · ${message.mood}` : ''}{message.tokensUsed != null ? ` · ${message.tokensUsed} tokens` : ''}</span>
              </div>
              <p className="transcript-content">{message.content}</p>
            </li>;
          })}
        </ol>}
      <p className="table-total">
        {transcript.page > 1 && <><Link href={pageLink(transcript.page - 1)}>上一页</Link>{' · '}</>}
        第 {transcript.page} / {totalPages} 页
        {transcript.page < totalPages && <>{' · '}<Link href={pageLink(transcript.page + 1)}>下一页</Link></>}
      </p>
      {hasUnknownVersion && <p className="visually-hidden" id="version-unknown-note">
        该回合没有保存角色卡版本快照，无法打开历史版本内容。
      </p>}
      <p className="muted">访问已记录审计（管理员、时间、会话与页码）；审计记录不复制聊天原文。</p>
    </section>
  </div>;
}
