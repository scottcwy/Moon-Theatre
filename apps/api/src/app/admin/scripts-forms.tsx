'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminRequest, AdminRequestError } from './request.js';
import { MediaField } from './media-forms.js';
import { coverDraftBody, coverNeedsSaveBeforePublish, coverPublishBody, newCoverPublishKey } from './script-cover.js';

/**
 * Cover-only script editor. Saving writes a normal script draft version through the existing strict
 * PATCH route; publishing is offered only for an already-uploaded (`active`) script, because
 * `publishScript` would otherwise also change the status. The copy never claims a draft is live.
 */
export function ScriptCoverForm({
  scriptId, title, status, coverUrl, draftVersionNo, baselineAt,
}: {
  scriptId: string;
  title: string;
  status: string;
  coverUrl: string | null;
  draftVersionNo: number | null;
  baselineAt: string;
}) {
  const router = useRouter();
  const busy = useRef(false);
  const publishKey = useRef(newCoverPublishKey(scriptId));
  const [value, setValue] = useState(coverUrl ?? '');
  const [baseline, setBaseline] = useState(baselineAt);
  // What the server currently stores (and whether a draft version exists). `publish` uses both to
  // avoid writing a second identical draft before activating the one it already has.
  const [savedUrl, setSavedUrl] = useState(coverUrl ?? '');
  const [hasDraft, setHasDraft] = useState(draftVersionNo !== null);
  const [pending, setPending] = useState<'save' | 'publish' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const active = status === 'active';

  async function save(): Promise<void> {
    const saved = await adminRequest<{ updatedAt: string }>(
      `/api/admin/scripts/${encodeURIComponent(scriptId)}`, 'PATCH', coverDraftBody(baseline, value),
    );
    setBaseline(saved.updatedAt);
    setSavedUrl(value);
    setHasDraft(true);
  }

  function failureCopy(cause: unknown): string {
    const failure = cause instanceof AdminRequestError ? cause : new AdminRequestError('操作未完成，请稍后重试。');
    if (failure.code === 'script_edit_conflict') return '剧本已被其他管理员修改：请刷新本页后重新编辑，本次没有写入。';
    if (failure.code === 'publish_idempotency_conflict' || failure.code === 'script_publish_audit_conflict') {
      return '这次发布的幂等标识已被使用：请刷新页面后重新发布。';
    }
    if (failure.redirectTo) window.location.assign(failure.redirectTo);
    return failure.message;
  }

  async function submitSave() {
    if (busy.current) return;
    busy.current = true;
    setPending('save');
    setError('');
    setNotice('');
    try {
      await save();
      setNotice(active
        ? '封面已保存为草稿；点击“保存并发布封面”后小程序才会生效。'
        : '封面已保存为草稿；该剧本尚未上架，上架后才会生效。');
      router.refresh();
    } catch (cause) {
      setError(failureCopy(cause));
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  async function submitPublish() {
    if (busy.current) return;
    busy.current = true;
    setPending('publish');
    setError('');
    setNotice('');
    try {
      // Publish exactly the current draft. When the cover is unchanged and a draft already carries it,
      // saving first would add a duplicate draft version + audit event for one cover change; when the
      // field (or the draft's cover) changed, the save is what makes the publish activate this cover.
      // Residual, documented limit: skipping the save publishes the *newest* draft version, so a draft
      // another admin saved meanwhile would be activated instead of failing with `script_edit_conflict`
      // (the confirmation copy says exactly that). Closing it needs a publish body that names the
      // version id, which the shared script publish route does not accept yet.
      if (coverNeedsSaveBeforePublish({ savedUrl, hasDraft, manualUrl: value })) await save();
      const result = await adminRequest<{ auditStatus: string }>(
        `/api/admin/scripts/${encodeURIComponent(scriptId)}`, 'POST', coverPublishBody(publishKey.current),
      );
      publishKey.current = newCoverPublishKey(scriptId);
      setConfirming(false);
      setNotice(result.auditStatus === 'pending'
        ? '封面已发布，但审计仍在恢复中：内容已切换，请在发布任务里核对审计状态。'
        : '封面已发布，小程序刷新后生效。已发布的旧封面引用保持可用。');
      router.refresh();
    } catch (cause) {
      setError(failureCopy(cause));
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  return <form
    className="script-cover-form"
    aria-label={`编辑剧本封面 ${title}`}
    aria-busy={pending !== null}
    onSubmit={event => { event.preventDefault(); void submitSave(); }}
  >
    <fieldset disabled={pending !== null}>
      <MediaField
        name="coverUrl"
        label="封面地址"
        value={value}
        onValueChange={setValue}
        disabled={pending !== null}
        previewAlt={`剧本《${title}》封面预览`}
        required={false}
      />
    </fieldset>
    <p className="muted">
      手动粘贴的地址（包括此前已在用的外链）继续有效；上传只会把新地址填入同一个字段。
      保存会生成剧本草稿版本，不会改动线上内容。
    </p>
    <div className="editor-actions">
      <button className="primary" type="submit" disabled={pending !== null}>
        {pending === 'save' ? '正在保存…' : '保存封面草稿'}
      </button>
      {active && <button
        type="button"
        disabled={pending !== null}
        onClick={() => { setConfirming(true); setError(''); setNotice(''); }}
      >保存并发布封面</button>}
    </div>
    {confirming && <div className="notice warning" role="alert">
      <p>我确认发布该剧本当前的封面：发布会把最新草稿版本切换为线上版本，小程序刷新后生效；已发布的旧封面引用不会被删除。</p>
      <div className="editor-actions">
        <button className="primary" type="button" disabled={pending !== null} onClick={() => { void submitPublish(); }}>
          {pending === 'publish' ? '正在发布…' : '确认发布'}
        </button>
        <button type="button" disabled={pending !== null} onClick={() => setConfirming(false)}>取消</button>
      </div>
    </div>}
    {!active && <p className="notice" role="status">
      该剧本尚未上架：本页只保存封面草稿，不会改变上架状态；上架后封面才会在小程序展示。
    </p>}
    <div role="alert" aria-live="assertive">{error && <p className="notice error">{error}</p>}</div>
    <div role="status" aria-live="polite">{notice && <p className="notice success">{notice}</p>}</div>
  </form>;
}
