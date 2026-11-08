'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminRequest, AdminRequestError } from './request.js';
import { MediaField } from './media-forms.js';
import { characterFieldLabel, describeBaseContextSync, scriptPublishWarning, CHARACTER_UNPUBLISH_EFFECT, type BaseContextStatusLike } from './character-copy.js';
import {
  buildCharacterEditPatch,
  parseQuestions,
  controlOf,
  PERSONA_FIELDS,
  PERSONA_LABELS,
  type CharacterEditValues,
  type PersonaField,
} from './character-patch.js';

export type { CharacterEditValues } from './character-patch.js';

function FieldError({ control, message }: { control: string; message?: string }) {
  if (!message) return null;
  return <p className="field-error" id={`${control}-error`} role="alert">{message}</p>;
}

export function CharacterEditForm({
  characterId, versionId, versionNo, editedFrom, agentId, agentOptions, scriptTitle, scriptStatus, values,
}: {
  characterId: string;
  versionId: string;
  versionNo: number | null;
  editedFrom: 'draft' | 'published';
  /** The character row's stored agent id; NULL means a one-time assignment is still possible. */
  agentId: string | null;
  /** The published roleplay-agent contract ids, used only while `agentId` is NULL. */
  agentOptions: AgentOption[];
  scriptTitle: string | null;
  scriptStatus: string | null;
  values: CharacterEditValues;
}) {
  const router = useRouter();
  const busy = useRef(false);
  const [baseline, setBaseline] = useState({ versionId, versionNo });
  const [initial, setInitial] = useState(values);
  const [form, setForm] = useState(values);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const set = (key: Exclude<keyof CharacterEditValues, 'persona'>) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = event.target.value;
    setForm(current => ({ ...current, [key]: value }));
  };
  const setPersona = (field: PersonaField) => (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setForm(current => ({ ...current, persona: { ...current.persona, [field]: value } }));
  };
  const scriptWarning = scriptPublishWarning(scriptStatus);

  function buildPatch(): { patch: Record<string, unknown>; issues: Record<string, string> } {
    return buildCharacterEditPatch({
      form,
      initial,
      storedAgentId: agentId,
      agentOptions: agentOptions.map(agent => agent.agentId),
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    setError('');
    setSuccess('');
    const { patch, issues } = buildPatch();
    if (Object.keys(issues).length > 0) { setFieldErrors(issues); return; }
    setFieldErrors({});
    if (Object.keys(patch).length === 0) { setSuccess('没有需要保存的改动。'); return; }
    busy.current = true;
    setPending(true);
    try {
      const result = await adminRequest<{ versionId: string; versionNo: number }>(
        `/api/admin/characters/${encodeURIComponent(characterId)}/draft`, 'POST', { versionId: baseline.versionId, patch },
      );
      // The saved version becomes the next edit baseline, so two consecutive saves do not conflict
      // with the save this operator just made.
      setBaseline({ versionId: result.versionId, versionNo: result.versionNo });
      setInitial(form);
      setSuccess(`已保存草稿版本 v${result.versionNo}。草稿不影响线上展示与正式聊天，需发布后生效。`);
      router.refresh();
    } catch (cause) {
      const failure = cause instanceof AdminRequestError ? cause : new AdminRequestError('保存未完成，请稍后重试。');
      if (failure.code === 'character_draft_conflict') {
        setError('草稿已在其他页面更新：请刷新本页后重新编辑，或把两处改动人工合并后再保存。本次保存没有写入。');
      } else if (failure.code === 'character_draft_invalid') {
        const issuesPayload = failure.details as { issues?: Array<{ path: string; message: string }> } | undefined;
        setFieldErrors(Object.fromEntries((issuesPayload?.issues ?? []).map(issue => [controlOf(issue.path), `${characterFieldLabel(issue.path)}：请检查该字段。`])));
        setError('保存未通过服务端校验，请按字段提示修改后重试。');
      } else if (failure.code === 'character_agent_id_system_owned') {
        setError('Agent 标识由系统维护，不能在草稿中修改。');
      } else if (failure.code === 'character_script_change_requires_new_character') {
        setError('已发布角色的归属剧本不能更换：请新建角色，避免继承旧角色的用户数据。');
      } else {
        setError(failure.message);
      }
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const describedBy = (control: string) => fieldErrors[control] ? `${control}-error` : undefined;

  return <form className="character-editor" onSubmit={submit} aria-label="角色卡编辑" aria-busy={pending}>
    <section className="panel" aria-labelledby="section-display">
      <h2 id="section-display">展示资料</h2>
      <p className="muted">展示资料只影响卡片与详情展示；保存为草稿，发布后才对小程序生效。</p>
      <div className="field-grid">
        <label>姓名<input name="name" value={form.name} onChange={set('name')} disabled={pending} aria-describedby={describedBy('name')} required /></label>
        <label>身份<input name="identity" value={form.identity} onChange={set('identity')} disabled={pending} aria-describedby={describedBy('identity')} required /></label>
        <MediaField
          name="avatarUrl"
          label="头像地址"
          value={form.avatarUrl}
          onValueChange={value => setForm(current => ({ ...current, avatarUrl: value }))}
          disabled={pending}
          describedBy={describedBy('avatarUrl')}
          previewAlt="头像预览"
        />
        <label>关系起点<input name="initialRelationship" value={form.initialRelationship} onChange={set('initialRelationship')} disabled={pending} aria-describedby={describedBy('initialRelationship')} required /></label>
        <label>排序<input name="sortOrder" type="number" min={0} max={100000} step={1} value={form.sortOrder} onChange={set('sortOrder')} disabled={pending} aria-describedby={describedBy('sortOrder')} /></label>
        {agentId === null
          // Legacy row captured with `agent_id IS NULL`: the service accepts exactly one assignment,
          // so this is the only way the operator can repair it from the UI (S1).
          ? <label>Agent 标识（一次性绑定，来自已发布清单）
            <select name="agentId" value={form.agentId} onChange={set('agentId')} disabled={pending} aria-describedby={`agentId-note${fieldErrors.agentId ? ' agentId-error' : ''}`} required>
              <option value="">请选择</option>
              {agentOptions.map(agent => <option key={agent.agentId} value={agent.agentId}>{agent.name}（{agent.agentId}）</option>)}
            </select>
          </label>
          : <label>Agent 标识（系统维护）<input name="agentId" readOnly value={agentId} /></label>}
        <label>归属剧本（发布后不可更换）<input name="scriptTitle" readOnly value={scriptTitle ?? '无剧本（仅自由聊天）'} /></label>
      </div>
      {agentId === null && <p className="muted" id="agentId-note">
        该角色是未绑定 Agent 标识的旧数据（agent_id 为空），只能在此绑定一次：保存草稿后发布时写入，写入后不再允许修改。选择清单来自已发布的角色 Agent 契约。
      </p>}
      <FieldError control="agentId" message={fieldErrors.agentId} />
      {scriptWarning && <p className="notice warning" role="status" data-preflight="script">{scriptWarning}</p>}
      <FieldError control="name" message={fieldErrors.name} />
      <FieldError control="identity" message={fieldErrors.identity} />
      <FieldError control="avatarUrl" message={fieldErrors.avatarUrl} />
      <FieldError control="initialRelationship" message={fieldErrors.initialRelationship} />
      <FieldError control="sortOrder" message={fieldErrors.sortOrder} />
      <label>简介<textarea name="description" rows={3} value={form.description} onChange={set('description')} disabled={pending} aria-describedby={describedBy('description')} required /></label>
      <FieldError control="description" message={fieldErrors.description} />
    </section>

    <section className="panel" aria-labelledby="section-persona">
      <h2 id="section-persona">角色人设</h2>
      <p className="muted">五段人设是正式聊天实际使用的文本；系统安全底线与协议不可由内容覆盖，这里只做补充。</p>
      {PERSONA_FIELDS.map(field => <label key={field}>{PERSONA_LABELS[field]}
        <textarea
          name={field}
          rows={field === 'systemPrompt' ? 6 : 3}
          value={form.persona[field]}
          onChange={setPersona(field)}
          disabled={pending}
          aria-describedby={describedBy(field)}
        />
      </label>)}
      {PERSONA_FIELDS.map(field => <FieldError key={field} control={field} message={fieldErrors[field]} />)}
    </section>

    <section className="panel" aria-labelledby="section-questions">
      <h2 id="section-questions">开场引导</h2>
      <p className="muted">每行一条提问，最多 12 条。有剧本的角色可分别设置剧本与自由模式的提问；无剧本角色只使用自由模式。</p>
      <label>剧本模式开场提问<textarea name="questionsScript" rows={4} value={form.questionsScript} onChange={set('questionsScript')} disabled={pending} aria-describedby={describedBy('questionsScript')} /></label>
      <FieldError control="questionsScript" message={fieldErrors.questionsScript} />
      <label>自由模式开场提问<textarea name="questionsFree" rows={4} value={form.questionsFree} onChange={set('questionsFree')} disabled={pending} aria-describedby={describedBy('questionsFree')} /></label>
      <FieldError control="questionsFree" message={fieldErrors.questionsFree} />
    </section>

    <div className="editor-footer">
      <p className="muted">当前编辑基准：{baseline.versionNo == null ? '未知版本' : `版本 v${baseline.versionNo}`}（{editedFrom === 'draft' ? '草稿' : '线上版本'}）。保存会生成新的不可变草稿版本，发布只发布选定版本，进行中的回合继续使用原版本。</p>
      <p className="muted">保存冲突时：草稿已在其他页面更新，请刷新本页重新编辑，或把两处改动人工合并后再保存；不会静默覆盖。</p>
      <div className="editor-actions">
        <button className="primary" type="submit" disabled={pending}>{pending ? '正在保存…' : '保存为草稿'}</button>
        <button type="button" disabled={pending} onClick={() => window.location.reload()}>刷新本页</button>
      </div>
      <div role="alert" aria-live="assertive">{error && <p className="notice error">{error}</p>}</div>
      <div role="status" aria-live="polite">{success && <p className="notice success">{success}</p>}</div>
    </div>
  </form>;
}

export interface AgentOption { agentId: string; name: string }
export interface ScriptOption { id: string; title: string; status: string }

/**
 * Explicit "create the first draft" action for an existing character that has no content version at
 * all (inactive legacy row, or a row created before versioning). It is never a write on page load:
 * without it the editor, the one-time agent assignment and publishing are unreachable, because
 * publishing requires a draft. A concurrent call answers 409 and the page reloads into the winner's
 * draft, so two admins cannot create two "first" versions.
 */
export function CharacterFirstDraftAction({ characterId }: { characterId: string }) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  async function create() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage('');
    try {
      const created = await adminRequest<{ versionNo: number; validity: { valid: boolean } }>(
        `/api/admin/characters/${encodeURIComponent(characterId)}/first-draft`, 'POST', {},
      );
      setFailed(false);
      setMessage(created.validity.valid
        ? `已创建首个草稿版本 v${created.versionNo}：本页已可以正常编辑、保存并发布。`
        : `已创建首个草稿版本 v${created.versionNo}：内容仍不完整，请按字段提示补全后保存，再发布。`);
      router.refresh();
    } catch (cause) {
      const failure = cause instanceof AdminRequestError ? cause : new AdminRequestError('创建首个草稿未完成，请稍后重试。');
      setFailed(true);
      if (failure.code === 'character_first_draft_exists') {
        // Another admin won the race (or this page is stale): reload into the draft that exists.
        setMessage('该角色已经有草稿或线上版本，无需再次创建首个草稿。已为你刷新本页，请继续编辑。');
        router.refresh();
      } else {
        setMessage(failure.message);
      }
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <div className="first-draft" data-first-draft={characterId}>
    <button className="primary" type="button" onClick={create} disabled={pending}>
      {pending ? '正在创建…' : '创建首个草稿'}
    </button>
    {message && <p className={`notice ${failed ? 'error' : 'success'}`} role={failed ? 'alert' : 'status'}>{message}</p>}
  </div>;
}

const EMPTY_CREATE = {
  name: '', avatarUrl: '', identity: '', description: '', initialRelationship: '',
  sortOrder: '0', agentId: '', scriptId: '', questionsScript: '', questionsFree: '',
  persona: { systemPrompt: '', personalityPrompt: '', scenarioPrompt: '', safetyPrompt: '', outputFormatPrompt: '' } as Record<PersonaField, string>,
};

/**
 * Draft-only creation (§3 新建角色): the new character is `inactive` with draft version 1 and no
 * published pointer, so it never reaches the public list or accepts a turn before it is published.
 * The agent id can only be one of the versioned roleplay agent contract entries — the operator
 * cannot type a routing id.
 */
export function CharacterCreateForm({ agents, scripts }: { agents: AgentOption[]; scripts: ScriptOption[] }) {
  const busy = useRef(false);
  const [form, setForm] = useState(EMPTY_CREATE);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState('');

  const set = (key: Exclude<keyof typeof EMPTY_CREATE, 'persona'>) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = event.target.value;
    setForm(current => ({ ...current, [key]: value }));
  };
  const setPersona = (field: PersonaField) => (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setForm(current => ({ ...current, persona: { ...current.persona, [field]: value } }));
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    setError('');
    setIssues([]);
    const sortOrder = Number(form.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
      setFieldErrors({ sortOrder: '排序须为 0 到 100000 的整数。' });
      return;
    }
    if (!agents.some(agent => agent.agentId === form.agentId)) {
      setFieldErrors({ agentId: '请选择一个已发布的角色 Agent 标识。' });
      return;
    }
    setFieldErrors({});
    busy.current = true;
    setPending(true);
    try {
      const created = await adminRequest<{ id: string }>('/api/admin/characters', 'POST', {
        name: form.name,
        avatarUrl: form.avatarUrl,
        identity: form.identity,
        description: form.description,
        initialRelationship: form.initialRelationship,
        agentId: form.agentId,
        scriptId: form.scriptId || null,
        sortOrder,
        starterQuestions: { script: parseQuestions(form.questionsScript), free: parseQuestions(form.questionsFree) },
        prompt: { ...form.persona },
      });
      window.location.assign(`/admin/characters/${encodeURIComponent(created.id)}/edit`);
    } catch (cause) {
      const failure = cause instanceof AdminRequestError ? cause : new AdminRequestError('创建未完成，请稍后重试。');
      if (failure.code === 'character_draft_invalid') {
        const payload = failure.details as { issues?: Array<{ path: string; message: string }> } | undefined;
        const list = payload?.issues ?? [];
        setFieldErrors(Object.fromEntries(list.map(issue => [controlOf(issue.path), `${characterFieldLabel(issue.path)}：请检查该字段。`])));
        setIssues(list.map(issue => `${characterFieldLabel(issue.path)}：请检查该字段。`));
        setError('创建未通过服务端校验，请按字段提示修改后重试。');
      } else if (failure.code === 'character_agent_unavailable') {
        setError('该 Agent 标识不在已发布的角色 Agent 清单中，无法创建。');
      } else {
        setError(failure.message);
      }
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const describedBy = (control: string) => fieldErrors[control] ? `${control}-error` : undefined;
  const selectedScript = scripts.find(script => script.id === form.scriptId);
  const selectedScriptInactive = Boolean(selectedScript && selectedScript.status !== 'active');

  return <form className="character-editor" onSubmit={submit} aria-label="新建角色卡" aria-busy={pending}>
    <section className="panel" aria-labelledby="create-display">
      <h2 id="create-display">展示资料</h2>
      <div className="field-grid">
        <label>姓名<input name="name" value={form.name} onChange={set('name')} disabled={pending} aria-describedby={describedBy('name')} required /></label>
        <label>身份<input name="identity" value={form.identity} onChange={set('identity')} disabled={pending} aria-describedby={describedBy('identity')} required /></label>
        <MediaField
          name="avatarUrl"
          label="头像地址"
          value={form.avatarUrl}
          onValueChange={value => setForm(current => ({ ...current, avatarUrl: value }))}
          disabled={pending}
          describedBy={describedBy('avatarUrl')}
          previewAlt="头像预览"
        />
        <label>关系起点<input name="initialRelationship" value={form.initialRelationship} onChange={set('initialRelationship')} disabled={pending} aria-describedby={describedBy('initialRelationship')} required /></label>
        <label>排序<input name="sortOrder" type="number" min={0} max={100000} step={1} value={form.sortOrder} onChange={set('sortOrder')} disabled={pending} aria-describedby={describedBy('sortOrder')} /></label>
        <label>Agent 标识（来自已发布清单）
          <select name="agentId" value={form.agentId} onChange={set('agentId')} disabled={pending} aria-describedby={describedBy('agentId')} required>
            <option value="">请选择</option>
            {agents.map(agent => <option key={agent.agentId} value={agent.agentId}>{agent.name}（{agent.agentId}）</option>)}
          </select>
        </label>
        <label>归属剧本（可无）
          <select name="scriptId" value={form.scriptId} onChange={set('scriptId')} disabled={pending} aria-describedby="create-script-note">
            <option value="">无剧本（仅自由聊天）</option>
            {scripts.map(script => <option key={script.id} value={script.id} data-script-status={script.status}>{script.title}{script.status === 'active' ? '' : '（未上架）'}</option>)}
          </select>
        </label>
      </div>
      <p className="muted" id="create-script-note">归属剧本未上架时仍可保存草稿，但发布会失败——需先在剧本页上架剧本。</p>
      {selectedScriptInactive && <p className="notice warning" role="status" data-preflight="script">
        所选剧本《{selectedScript?.title}》尚未上架：可以先保存草稿，但发布会失败，需先在剧本页上架剧本。
      </p>}
      <FieldError control="name" message={fieldErrors.name} />
      <FieldError control="identity" message={fieldErrors.identity} />
      <FieldError control="avatarUrl" message={fieldErrors.avatarUrl} />
      <FieldError control="initialRelationship" message={fieldErrors.initialRelationship} />
      <FieldError control="sortOrder" message={fieldErrors.sortOrder} />
      <FieldError control="agentId" message={fieldErrors.agentId} />
      <label>简介<textarea name="description" rows={3} value={form.description} onChange={set('description')} disabled={pending} aria-describedby={describedBy('description')} required /></label>
      <FieldError control="description" message={fieldErrors.description} />
    </section>

    <section className="panel" aria-labelledby="create-persona">
      <h2 id="create-persona">角色人设</h2>
      <p className="muted">五段人设是正式聊天实际使用的文本；系统安全底线与协议不可由内容覆盖，这里只做补充。</p>
      {PERSONA_FIELDS.map(field => <label key={field}>{PERSONA_LABELS[field]}
        <textarea
          name={field}
          rows={field === 'systemPrompt' ? 6 : 3}
          value={form.persona[field]}
          onChange={setPersona(field)}
          disabled={pending}
          aria-describedby={describedBy(field)}
        />
      </label>)}
      {PERSONA_FIELDS.map(field => <FieldError key={field} control={field} message={fieldErrors[field]} />)}
    </section>

    <section className="panel" aria-labelledby="create-questions">
      <h2 id="create-questions">开场引导</h2>
      <p className="muted">每行一条提问，最多 12 条。有剧本的角色可分别设置剧本与自由模式的提问；无剧本角色只使用自由模式。</p>
      <label>剧本模式开场提问<textarea name="questionsScript" rows={4} value={form.questionsScript} onChange={set('questionsScript')} disabled={pending} /></label>
      <label>自由模式开场提问<textarea name="questionsFree" rows={4} value={form.questionsFree} onChange={set('questionsFree')} disabled={pending} /></label>
    </section>

    <div className="editor-footer">
      <p className="muted">创建后是未上架的草稿版本 v1：不会出现在小程序列表，也不能开始聊天；确认预览并发布后才生效。</p>
      <div className="editor-actions">
        <button className="primary" type="submit" disabled={pending}>{pending ? '正在创建…' : '创建草稿'}</button>
      </div>
      {issues.length > 0 && <ul className="issue-list">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
      <div role="alert" aria-live="assertive">{error && <p className="notice error">{error}</p>}</div>
    </div>
  </form>;
}

/**
 * Publish / unpublish with explicit confirmation. Publishing reports the persisted task result; a
 * pending audit or a task that has not answered after 30 seconds is shown as 处理中, never success.
 *
 * `preflightWarning` is the runtime prerequisite the publish cannot fix by itself (a published
 * model-profile version). It is rendered as a blocking-looking warning next to the confirmation and
 * never disables the button: publishing content stays possible while the prerequisite is missing.
 */
export function CharacterPublishActions({
  characterId, versionId, versionNo, published, canPublish, canUnpublish, preflightWarning = null,
}: {
  characterId: string;
  versionId: string | null;
  versionNo: number | null;
  published: boolean;
  canPublish: boolean;
  canUnpublish: boolean;
  preflightWarning?: string | null;
}) {
  const router = useRouter();
  const busy = useRef(false);
  const idempotencyKey = useRef(`ui-character-publish-${characterId}-${Date.now().toString(36)}`);
  const [pending, setPending] = useState<'publish' | 'unpublish' | null>(null);
  const [slow, setSlow] = useState(false);
  const [confirmedPublish, setConfirmedPublish] = useState(false);
  const [confirmedUnpublish, setConfirmedUnpublish] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!pending) return;
    // A cross-system outcome cannot be claimed after 30 seconds; it becomes an explicit 处理中.
    const timer = window.setTimeout(() => setSlow(true), 30_000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  async function publish() {
    if (busy.current || !versionId) return;
    busy.current = true;
    setPending('publish');
    setSlow(false);
    setMessage('');
    setFailed(false);
    try {
      const result = await adminRequest<{
        versionId: string;
        status: string;
        auditStatus: 'committed' | 'pending';
        baseContext?: { status: BaseContextStatusLike; reason: string | null; written: boolean };
      }>(
        `/api/admin/characters/${encodeURIComponent(characterId)}/publish`, 'POST',
        { versionId, idempotencyKey: idempotencyKey.current },
      );
      // Batch 3 step 1: the derived base context is reported separately from the publish result. A
      // cross-system problem never turns the publish into a failure — it is stated as `baseContextStatus`,
      // and each outcome gets its own honest label (a failed record is NOT "FastClaw 未更新").
      const baseNote = result.baseContext
        ? (() => {
          const sync = describeBaseContextSync({
            status: result.baseContext.status,
            reason: result.baseContext.reason,
            written: result.baseContext.written,
          });
          return `基础上下文${sync.label}：${sync.note}`;
        })()
        : '';
      if (result.auditStatus === 'pending') {
        setFailed(false);
        setMessage(`已提交发布，但审计仍待恢复（处理中）。请稍后刷新确认；同一任务不会重复发布，也不构成完整成功。${baseNote ? ` ${baseNote}` : ''}`);
      } else {
        setMessage(`已发布 ${versionNo == null ? '' : `版本 v${versionNo} `}（任务 ${result.status}）。新回合使用该版本，进行中的回合继续使用原版本。${baseNote ? ` ${baseNote}` : ''}`);
        idempotencyKey.current = `ui-character-publish-${characterId}-${Date.now().toString(36)}`;
      }
      setConfirmedPublish(false);
      router.refresh();
    } catch (cause) {
      const failure = cause instanceof AdminRequestError ? cause : new AdminRequestError('发布未完成，请稍后重试。');
      setFailed(true);
      setMessage(failure.code === 'character_version_already_published'
        ? '该版本已经是线上版本，无需重复发布。'
        : failure.code === 'character_script_unavailable'
          ? '归属剧本未上架：发布前需先在剧本页上架剧本，再发布此角色。'
          : failure.code === 'character_script_not_found'
            ? '归属剧本已不存在：请为角色改绑一个有效剧本（已发布角色需新建角色）。'
            : failure.code === 'character_agent_unavailable'
              ? 'Agent 标识不在已发布的角色 Agent 清单中，无法发布。'
              : failure.code === 'character_publish_conflict'
                ? '发布任务与已有任务冲突：请刷新后核对线上版本，再决定是否重试。'
                : failure.code === 'character_version_hash_mismatch'
                  ? '版本内容与记录的哈希不一致，已拒绝发布；请重新保存草稿后再发布。'
                  : failure.message);
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  async function unpublish() {
    if (busy.current) return;
    busy.current = true;
    setPending('unpublish');
    setMessage('');
    setFailed(false);
    try {
      const result = await adminRequest<{ changed: boolean }>(
        `/api/admin/characters/${encodeURIComponent(characterId)}/unpublish`, 'POST', {},
      );
      setMessage(result.changed
        ? '已下架：公开入口与新会话停止，历史聊天、版本与发布记录保留。'
        : '该角色当前不在线上，无需重复下架。');
      setConfirmedUnpublish(false);
      router.refresh();
    } catch (cause) {
      const failure = cause instanceof AdminRequestError ? cause : new AdminRequestError('下架未完成，请稍后重试。');
      setFailed(true);
      setMessage(failure.message);
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  return <div className="publish-actions">
    {preflightWarning && <div className="notice warning" role="alert" data-preflight="model-profile">
      <strong>{preflightWarning}</strong>
      <p>发布仍会成功并切换线上版本；但在这项前置条件修复前，新回合会被运行前置检查拒绝。修复方式：先在“模型”页发布一次模型档位版本，再发布或重新发布角色。</p>
    </div>}
    <div className="publish-action">
      <p className="muted">发布前请确认预览与校验结果。发布使用当前选定的版本（{versionNo == null ? '未知版本' : `v${versionNo}`}），不会读取之后的新草稿。</p>
      <label className="checkbox"><input type="checkbox" checked={confirmedPublish} disabled={!canPublish || pending !== null} onChange={event => setConfirmedPublish(event.target.checked)} />我确认发布此版本</label>
      <button className="primary" type="button" onClick={publish} disabled={!canPublish || !confirmedPublish || pending !== null}>
        {pending === 'publish' ? '正在发布…' : published ? '重新发布此版本' : '发布此版本'}
      </button>
      {pending === 'publish' && slow && <p className="notice warning" role="status">处理中：已超过 30 秒仍未拿到最终结果。请稍后刷新查看任务结果，不要重复发布。</p>}
    </div>
    <div className="publish-action" data-unpublish-action>
      <p className="muted">{CHARACTER_UNPUBLISH_EFFECT}</p>
      <label className="checkbox"><input type="checkbox" checked={confirmedUnpublish} disabled={!canUnpublish || pending !== null} onChange={event => setConfirmedUnpublish(event.target.checked)} />我确认下架</label>
      <button className="danger" type="button" data-action="unpublish" onClick={unpublish} disabled={!canUnpublish || !confirmedUnpublish || pending !== null}>
        {pending === 'unpublish' ? '正在下架…' : '下架'}
      </button>
    </div>
    {!canPublish && <p className="muted">尚无可发布的版本：请先保存一次完整草稿。</p>}
    <div role="alert" aria-live="assertive">{failed && message && <p className="notice error">{message}</p>}</div>
    <div role="status" aria-live="polite">{!failed && message && <p className={`notice ${message.startsWith('已提交发布') ? 'warning' : 'success'}`}>{message}</p>}</div>
  </div>;
}

/**
 * Batch 3 step 1 (plan W): the manual rebuild of the DERIVED FastClaw base context.
 *
 * The published PG version owns the persona; SOUL.md / IDENTITY.md / USER.md are regenerated from it
 * and recorded as an `agent_context_version`. This control is the operator's way out of a FastClaw
 * console hand edit (or of a `待同步`/`同步失败` publish) — it overwrites the console copy and never
 * touches the published version, the runtime context assembly or user memory.
 */
export function BaseContextRebuildAction({ characterId, disabled = false }: { characterId: string; disabled?: boolean }) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  async function rebuild() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage('');
    try {
      const result = await adminRequest<{ sync: { status: BaseContextStatusLike; reason: string | null; written: boolean } }>(
        `/api/admin/characters/${encodeURIComponent(characterId)}/base-context`, 'POST', {},
      );
      const sync = describeBaseContextSync(result.sync);
      setFailed(sync.tone === 'error');
      setMessage(`基础上下文${sync.label}：${sync.note}`);
      router.refresh();
    } catch (cause) {
      const failure = cause instanceof AdminRequestError ? cause : new AdminRequestError('重建未完成，请稍后重试。');
      setFailed(true);
      setMessage(failure.message);
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <div className="base-context-actions">
    <button type="button" onClick={rebuild} disabled={pending || disabled}>
      {pending ? '正在重建…' : '按已发布版本重建基础上下文'}
    </button>
    <div role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
      {message && <p className={`notice ${failed ? 'error' : 'success'}`}>{message}</p>}
    </div>
  </div>;
}
