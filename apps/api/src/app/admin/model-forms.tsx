'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminRequest, AdminRequestError } from './request.js';
import {
  buildModelPublishBody,
  buildModelSaveBody,
  buildModelTierPatch,
  formatModelRuntimeParams,
  modelIdempotencySession,
  modelTierInitialForm,
  modelTierLabel,
  type ModelTierFormValues,
  type ModelTierInitial,
  type ModelTierIssues,
} from './model-patch.js';
import {
  MODEL_CHECK_HONESTY_NOTE,
  MODEL_CHECK_NOTE,
  MODEL_CHECK_REASON_COPY,
  MODEL_CHECK_STATUS_LABELS,
  MODEL_DESCRIPTION_LABEL_NOTE,
  MODEL_DISABLED_TIER_WARNING,
  MODEL_FORM_LABEL_HINTS,
  MODEL_PUBLISH_CONFIRMATION,
  MODEL_RESTORE_NOTE,
  MODEL_VERSION_EMPTY,
  describeModelCheck,
  describeModelPublish,
  describeModelSave,
  modelFailureCopy,
  modelRestoreConfirmation,
} from './model-copy.js';import { formatAdminDate } from './ui.js';
import type {
  AdminModelProfile,
  AdminModelProfileVersion,
  ModelConsistencyCheck,
} from '@/server/modules/admin/index.js';

function failureOf(cause: unknown, fallback: string): AdminRequestError {
  return cause instanceof AdminRequestError ? cause : new AdminRequestError(fallback);
}

function Issue({ message }: { message?: string }) {
  return message ? <p className="field-error">{message}</p> : null;
}

/** One inline editor per tier: an explicit 保存修改 (nothing saves on blur) plus an audited publish. */
export function ModelTierEditor({ profile, initial }: { profile: AdminModelProfile; initial: ModelTierInitial }) {
  const router = useRouter();
  const busy = useRef(false);
  // One key per editing session, not per click: a retry of a lost response replays the original write
  // instead of comparing a new key against the now-stale baseline. The session object is created once
  // (lazy state initializer) and a re-render never mints another key; `idempotencyKey` only mirrors it.
  // Save, publish and restore keep SEPARATE sessions because all three share the server's
  // `model_profile_publish:` dedupe namespace — one shared key would collide across operations.
  const [saveSession] = useState(() => modelIdempotencySession());
  const [publishSession] = useState(() => modelIdempotencySession());
  const initialForm = modelTierInitialForm(initial);
  const [values, setValues] = useState<ModelTierFormValues>(initialForm);
  const [issues, setIssues] = useState<ModelTierIssues>({});
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => saveSession.current());

  // A refresh after another operator's save must re-prefill the fields, while the confirmation the
  // current operator earned stays on screen (render-phase adjustment, the documented React pattern).
  const stamp = `${profile.updatedAt.toISOString()}:${initial.runtimeParams.maxTokens ?? ''}:${initial.runtimeParams.temperature ?? ''}:${initial.runtimeParams.maxToolIterations ?? ''}:${initial.runtimeParams.thinking ?? ''}`;
  const [syncedStamp, setSyncedStamp] = useState(stamp);
  if (syncedStamp !== stamp) {
    setSyncedStamp(stamp);
    setValues(initialForm);
    setIssues({});
    setConfirming(false);
  }

  const tierLabel = modelTierLabel(profile.tier);

  function change(field: keyof ModelTierFormValues, value: string | boolean) {
    setValues(current => ({ ...current, [field]: value }));
  }

  /** The only mutator of the save key: after a definitive result, or on an explicit 重新生成. */
  function rotateSaveKey() {
    setIdempotencyKey(saveSession.rotate());
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const built = buildModelTierPatch({ form: values, initial });
    setIssues(built.issues);
    if (!built.patch) return;
    if (Object.keys(built.patch).length === 0) {
      setFailed(false);
      setMessage('没有字段变化，本次未写入，也未新增版本或审计记录。');
      return;
    }
    busy.current = true;
    setPending(true);
    setMessage('');
    try {
      const result = await adminRequest<{ changed: boolean; changedFields: string[]; auditStatus: string; dedupeKey: string | null }>(
        '/api/admin/models', 'PATCH', buildModelSaveBody({
          profileId: profile.id,
          expectedUpdatedAt: profile.updatedAt.toISOString(),
          patch: built.patch,
          session: saveSession,
        }),
      );
      setFailed(false);
      setMessage(describeModelSave(result));
      // A definitive result ends this editing session's request identity; the next save needs a new one.
      rotateSaveKey();
      router.refresh();
    } catch (cause) {
      const failure = failureOf(cause, '保存档位未完成，请稍后重试。');
      setFailed(true);
      setMessage(modelFailureCopy(failure.code, failure.message));
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function publish() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage('');
    try {
      const result = await adminRequest<{
        created: boolean; version: { versionNo: number }; auditStatus: string; dedupeKey: string | null;
      }>(
        `/api/admin/models/${encodeURIComponent(profile.id)}/publish`, 'POST',
        buildModelPublishBody({ expectedUpdatedAt: profile.updatedAt.toISOString(), session: publishSession }),
      );
      setFailed(false);
      setMessage(describeModelPublish(result));
      setConfirming(false);
      publishSession.rotate();
      router.refresh();
    } catch (cause) {
      const failure = failureOf(cause, '发布未完成，请稍后重试。');
      setFailed(true);
      setMessage(modelFailureCopy(failure.code, failure.message));
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <form className="package-form" aria-label={`编辑档位 ${tierLabel}`} aria-busy={pending} onSubmit={save}>
    <fieldset disabled={pending}>
      <div className="field-grid">
        <label>展示名
          <input name="displayName" value={values.displayName} maxLength={64} required disabled={pending}
            onChange={event => change('displayName', event.target.value)} />
          <Issue message={issues.displayName} />
        </label>
        <label>{MODEL_FORM_LABEL_HINTS.provider}
          <input name="provider" value={values.provider} maxLength={64} required disabled={pending}
            onChange={event => change('provider', event.target.value)} />
          <Issue message={issues.provider} />
        </label>
        <label>{MODEL_FORM_LABEL_HINTS.modelName}
          <input name="modelName" value={values.modelName} maxLength={128} required disabled={pending}
            onChange={event => change('modelName', event.target.value)} />
          <Issue message={issues.modelName} />
        </label>
        <label>{MODEL_FORM_LABEL_HINTS.pointsPerCall}
          <input name="pointsPerCall" value={values.pointsPerCall} inputMode="numeric" required disabled={pending}
            onChange={event => change('pointsPerCall', event.target.value)} />
          <Issue message={issues.pointsPerCall} />
        </label>
      </div>
      <label>{MODEL_FORM_LABEL_HINTS.description}
        <textarea name="description" value={values.description} rows={2} maxLength={256} disabled={pending}
          onChange={event => change('description', event.target.value)} />
        <Issue message={issues.description} />
        <span className="muted">{MODEL_DESCRIPTION_LABEL_NOTE}</span>
      </label>
      <label className="checkbox">
        <input name="enabled" type="checkbox" checked={values.enabled} disabled={pending}
          onChange={event => change('enabled', event.target.checked)} />
        启用该档位（新回合可使用；取消后新回合会被拒绝）
      </label>

      <fieldset className="model-runtime-params">
        <legend>声明运行参数（仅用于一致性核对，不会下发给 FastClaw）</legend>
        <div className="field-grid">
          <label>最大输出 token
            <input name="maxTokens" value={values.maxTokens} inputMode="numeric" placeholder="例如 768" disabled={pending}
              onChange={event => change('maxTokens', event.target.value)} />
            <Issue message={issues.maxTokens} />
          </label>
          <label>temperature
            <input name="temperature" value={values.temperature} inputMode="decimal" placeholder="例如 0.7" disabled={pending}
              onChange={event => change('temperature', event.target.value)} />
            <Issue message={issues.temperature} />
          </label>
          <label>工具迭代上限
            <input name="maxToolIterations" value={values.maxToolIterations} inputMode="numeric" placeholder="例如 0" disabled={pending}
              onChange={event => change('maxToolIterations', event.target.value)} />
            <Issue message={issues.maxToolIterations} />
          </label>
          <label>thinking
            <select name="thinking" value={values.thinking} disabled={pending}
              onChange={event => change('thinking', event.target.value)}>
              <option value="">不声明</option>
              <option value="off">off（模型级思考必须关闭）</option>
            </select>
            <Issue message={issues.thinking} />
          </label>
        </div>
      </fieldset>

      {!profile.enabled && <div className="notice warning" role="note">
        <p>{MODEL_DISABLED_TIER_WARNING}</p>
      </div>}

      <label>幂等标识（本次编辑会话保存时携带，重试会重放同一次保存）
        <input name="idempotencyKey" value={idempotencyKey} readOnly maxLength={128} className="identifier" />
        <span className="muted">保存成功后自动更换；手工重试前不要更换，否则会变成一次新的保存。</span>
      </label>
      <div className="editor-actions">
        <button className="primary" disabled={pending}>{pending ? '正在保存…' : '保存修改'}</button>
        <button type="button" disabled={pending} onClick={() => setConfirming(true)}>发布当前配置</button>
        <button type="button" disabled={pending} onClick={rotateSaveKey}>重新生成幂等标识</button>
      </div>
      {confirming && <div className="notice warning" role="alert">
        <p>{MODEL_PUBLISH_CONFIRMATION}</p>
        <div className="editor-actions">
          <button type="button" className="primary" disabled={pending} onClick={publish}>确认发布</button>
          <button type="button" disabled={pending} onClick={() => setConfirming(false)}>取消</button>
        </div>
      </div>}
    </fieldset>
    <div role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
      {message && <p className={`notice ${failed ? 'error' : 'success'}`}>{message}</p>}
    </div>
  </form>;
}

/**
 * The configuration consistency check. Three distinct rendered states — 一致 / 不一致 / 无法核对 — plus
 * a transport failure that is NOT one of them. `无法核对` is deliberately never styled as success.
 */
export function ModelCheckPanel({ profileId, tier }: { profileId: string; tier: string }) {
  const tierLabel = modelTierLabel(tier);
  const [check, setCheck] = useState<ModelConsistencyCheck | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');

  async function run() {
    if (pending) return;
    setPending(true);
    setMessage('');
    try {
      const result = await adminRequest<{ check: ModelConsistencyCheck }>(
        `/api/admin/models/${encodeURIComponent(profileId)}/check`, 'POST',
      );
      setCheck(result.check);
      setFailed(false);
      setMessage(describeModelCheck(result.check));
    } catch (cause) {
      const failure = failureOf(cause, '核对请求未完成，请稍后重试。本次没有得到任何一致性结论。');
      setCheck(null);
      setFailed(true);
      setMessage(modelFailureCopy(failure.code, failure.message));
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    } finally {
      setPending(false);
    }
  }

  return <section className="model-check" aria-label={`配置一致性检查 ${tierLabel}`}>
    <h4>配置一致性检查</h4>
    <p className="muted">{MODEL_CHECK_NOTE}</p>
    <p className="muted">{MODEL_CHECK_HONESTY_NOTE}</p>
    <div className="editor-actions">
      <button type="button" className="primary" disabled={pending} onClick={run}>
        {pending ? '正在核对…' : '配置一致性检查'}
      </button>
    </div>
    <div role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
      {message && <p className={`notice ${failed ? 'error' : check?.status === 'match' ? 'success' : 'warning'}`}>{message}</p>}
    </div>
    {check && <section aria-label="配置一致性检查结果" data-check-status={check.status}>
      <p>
        结论 <span className="tag" data-status={check.status === 'match' ? 'active' : check.status === 'mismatch' ? 'failed' : 'pending'}>
          {MODEL_CHECK_STATUS_LABELS[check.status]}
        </span>
      </p>
      <dl>
        <dt>档位声明</dt>
        <dd>{check.expected.provider} / {check.expected.modelName}（期望运行模型标识 {check.expected.modelId}）</dd>
        <dt>声明运行参数</dt>
        <dd>{formatDeclared(check.expected.runtimeParams)}</dd>
        <dt>核对时间</dt>
        <dd>{formatAdminDate(check.checkedAt)}</dd>
      </dl>
      {check.status === 'unavailable' && <p className="muted">{MODEL_CHECK_REASON_COPY[check.reason ?? ''] ?? '无法完成核对。'}</p>}
      <ul className="check-agents">
        {check.agents.map(agent => <li key={agent.agentId} data-agent-id={agent.agentId} data-agent-status={agent.status}>
          <span className="identifier">{agent.agentId}</span>
          <span className="tag" data-status={agent.status === 'match' ? 'active' : agent.status === 'mismatch' ? 'failed' : 'pending'}>
            {MODEL_CHECK_STATUS_LABELS[agent.status]}
          </span>
          <span className="muted">FastClaw 报告模型：{agent.model ?? '未读到'}</span>
          {agent.differences.length > 0 && <ul>
            {agent.differences.map(difference => <li key={difference.key}>
              {difference.key}：声明 {difference.expected}，FastClaw 报告 {difference.actual ?? '未报告'}
            </li>)}
          </ul>}
        </li>)}
      </ul>
    </section>}
  </section>;
}

function formatDeclared(params: ModelConsistencyCheck['expected']['runtimeParams']): string {
  const text = formatModelRuntimeParams(params);
  return text === '未声明' ? '未声明（只核对模型）' : text;
}

/**
 * Append-only version history. Restore copies an older payload into a NEW version — the confirmation
 * says so explicitly, and no action here can rewrite or delete a history row.
 */
export function ModelVersionHistory({ profileId, tier, versions, expectedUpdatedAt }: {
  profileId: string;
  tier: string;
  versions: AdminModelProfileVersion[];
  /** The `updatedAt` the page loaded; restore refuses to overwrite a newer save (409). */
  expectedUpdatedAt: string;
}) {
  const tierLabel = modelTierLabel(tier);
  const router = useRouter();
  const busy = useRef(false);
  // Same rule as the editor: one restore key per session, rotated only after a definitive result.
  const [restoreSession] = useState(() => modelIdempotencySession());
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState<AdminModelProfileVersion | null>(null);

  async function restore() {
    if (!confirming || busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage('');
    try {
      const result = await adminRequest<{
        created: boolean; version: { versionNo: number }; auditStatus: string; dedupeKey: string | null;
      }>(
        `/api/admin/models/${encodeURIComponent(profileId)}/publish`, 'POST',
        buildModelPublishBody({
          expectedUpdatedAt,
          session: restoreSession,
          versionId: confirming.id,
        }),
      );
      setFailed(false);
      setMessage(describeModelPublish({ ...result, sourceVersion: { versionNo: confirming.versionNo } }));
      setConfirming(null);
      restoreSession.rotate();
      router.refresh();
    } catch (cause) {
      const failure = failureOf(cause, '恢复未完成，请稍后重试。');
      setFailed(true);
      setMessage(modelFailureCopy(failure.code, failure.message));
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <section className="model-history" aria-label={`版本历史 ${tierLabel}`}>
    <h4>版本历史</h4>
    <p className="muted">{MODEL_RESTORE_NOTE}</p>
    {versions.length === 0
      ? <p className="empty">{MODEL_VERSION_EMPTY}</p>
      : <div className="table-wrap" role="region" aria-label={`版本历史 ${tierLabel}，可横向滚动`} tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">版本</th>
              <th scope="col">状态</th>
              <th scope="col">服务商 / 模型</th>
              <th scope="col" className="numeric">每次点数</th>
              <th scope="col">声明运行参数</th>
              <th scope="col">配置哈希</th>
              <th scope="col">创建人</th>
              <th scope="col">创建时间</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {versions.map(version => <tr key={version.id} data-version-no={version.versionNo}>
              <td>
                v{version.versionNo}
                {version.isCurrent && <span className="tag" data-status="active">当前</span>}
              </td>
              <td><span className="tag" data-status={version.status === 'published' ? 'active' : 'inactive'}>
                {version.status === 'published' ? '已发布' : version.status}
              </span></td>
              <td>{version.provider} / {version.modelName}</td>
              <td className="numeric" data-points={version.pointsPerCall}>{version.pointsPerCall}</td>
              {/* Restore re-applies this declaration, so the row an operator picks must show it. */}
              <td className="identifier" data-runtime-params={formatModelRuntimeParams(version.runtimeParams)}>
                {formatModelRuntimeParams(version.runtimeParams)}
              </td>
              <td className="identifier" title={version.configHash}>{version.configHash.slice(0, 12)}</td>
              <td>{version.createdByEmail ?? '未记录创建人'}</td>
              <td>{formatAdminDate(version.createdAt)}</td>
              <td>
                <button type="button" disabled={pending} onClick={() => setConfirming(version)}>
                  恢复 v{version.versionNo}
                </button>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    {confirming && <div className="notice warning" role="alert">
      <p>{modelRestoreConfirmation(confirming.versionNo, confirming.runtimeParams)}</p>
      <div className="editor-actions">
        <button type="button" className="primary" disabled={pending} onClick={restore}>确认恢复</button>
        <button type="button" disabled={pending} onClick={() => setConfirming(null)}>取消</button>
      </div>
    </div>}
    <div role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
      {message && <p className={`notice ${failed ? 'error' : 'success'}`}>{message}</p>}
    </div>
  </section>;
}
