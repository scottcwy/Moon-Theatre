/**
 * Pure form construction for the model tier console (AC-15 / AC-17).
 *
 * Kept out of the client component so the exact payload a save sends can be asserted directly:
 *  - only the fields the operator actually changed are sent (an unchanged field never writes a
 *    needless immutable version or audit row);
 *  - the declared runtime parameters are sent as ONE object (the server replaces the whole
 *    declaration), built from the allowlist the FastClaw runtime-spec reports;
 *  - nothing credential-shaped is collected, so nothing credential-shaped can be sent.
 */
import {
  MODEL_DESCRIPTION_MAX,
  MODEL_DISPLAY_NAME_MAX,
  MODEL_NAME_MAX,
  MODEL_PROVIDER_MAX,
} from '@/server/modules/admin/model-limits.js';
import {
  MODEL_RUNTIME_TEMPERATURE_MAX,
  modelRuntimeParamIssue,
  sameModelRuntimeParams,
  type ModelRuntimeParams,
} from '@/server/modules/admin/model-runtime-params.js';

export interface ModelTierFormValues {
  enabled: boolean;
  provider: string;
  modelName: string;
  pointsPerCall: string;
  displayName: string;
  description: string;
  maxTokens: string;
  temperature: string;
  maxToolIterations: string;
  /** `''` = not declared, `'off'` = declare the runtime's mandatory value. */
  thinking: string;
}

export interface ModelTierInitial {
  enabled: boolean;
  provider: string;
  modelName: string;
  pointsPerCall: number;
  displayName: string;
  description: string | null;
  runtimeParams: ModelRuntimeParams;
}

export type ModelTierIssues = Record<string, string>;

export interface ModelTierPatch {
  enabled?: boolean;
  provider?: string;
  modelName?: string;
  pointsPerCall?: number;
  displayName?: string;
  description?: string | null;
  runtimeParams?: ModelRuntimeParams;
}

const COUNT = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?$/;

const TIER_LABELS: Record<string, string> = { casual: '轻松', standard: '标准', immersive: '沉浸' };

export function modelTierLabel(tier: string): string {
  return TIER_LABELS[tier] ?? tier;
}

export const MODEL_FIELD_LABELS: Record<string, string> = {
  enabled: '启用状态',
  pointsPerCall: '每次点数',
  displayName: '展示名',
  description: '说明',
  provider: '服务商',
  modelName: '模型名',
  runtimeParams: '声明运行参数',
};

export function describeModelFields(fields: string[]): string {
  return fields.map(field => MODEL_FIELD_LABELS[field] ?? field).join('、');
}

const numberText = (value: number | undefined): string => (value === undefined ? '' : String(value));

export function modelTierInitialForm(initial: ModelTierInitial): ModelTierFormValues {
  return {
    enabled: initial.enabled,
    provider: initial.provider,
    modelName: initial.modelName,
    pointsPerCall: String(initial.pointsPerCall),
    displayName: initial.displayName,
    description: initial.description ?? '',
    maxTokens: numberText(initial.runtimeParams.maxTokens),
    temperature: numberText(initial.runtimeParams.temperature),
    maxToolIterations: numberText(initial.runtimeParams.maxToolIterations),
    thinking: initial.runtimeParams.thinking ?? '',
  };
}

/** Parses the declared-parameter inputs into the allowlisted object, reporting one issue per field. */
function parseDeclaredParams(
  form: ModelTierFormValues,
  issues: ModelTierIssues,
): ModelRuntimeParams {
  const params: ModelRuntimeParams = {};

  const integer = (field: 'maxTokens' | 'maxToolIterations', value: string): number | null => {
    const text = value.trim();
    if (!text) return null;
    if (!COUNT.test(text)) {
      issues[field] = modelRuntimeParamIssue(field, Number.NaN) ?? `需为整数`;
      return null;
    }
    const parsed = Number(text);
    const issue = modelRuntimeParamIssue(field, parsed);
    if (issue) {
      issues[field] = issue;
      return null;
    }
    return parsed;
  };

  const maxTokens = integer('maxTokens', form.maxTokens);
  if (maxTokens !== null) params.maxTokens = maxTokens;
  const maxToolIterations = integer('maxToolIterations', form.maxToolIterations);
  if (maxToolIterations !== null) params.maxToolIterations = maxToolIterations;

  const temperatureText = form.temperature.trim();
  if (temperatureText) {
    if (!DECIMAL.test(temperatureText)) {
      issues.temperature = `temperature 需为 0–${MODEL_RUNTIME_TEMPERATURE_MAX} 的数字`;
    } else {
      const parsed = Number(temperatureText);
      const issue = modelRuntimeParamIssue('temperature', parsed);
      if (issue) issues.temperature = issue;
      else params.temperature = parsed;
    }
  }

  const thinkingText = form.thinking.trim();
  if (thinkingText) {
    const issue = modelRuntimeParamIssue('thinking', thinkingText);
    if (issue) issues.thinking = 'thinking 只允许 off（模型级思考必须关闭）';
    else params.thinking = 'off';
  }
  return params;
}

/** Only the fields that differ from the stored row, compared after normalisation. */
export function buildModelTierPatch(input: {
  form: ModelTierFormValues;
  initial: ModelTierInitial;
}): { patch?: ModelTierPatch; issues: ModelTierIssues } {
  const { form, initial } = input;
  const issues: ModelTierIssues = {};

  const provider = form.provider.trim();
  if (!provider) issues.provider = '服务商不能为空';
  else if (Array.from(provider).length > MODEL_PROVIDER_MAX) issues.provider = `服务商最多 ${MODEL_PROVIDER_MAX} 个字符`;

  const modelName = form.modelName.trim();
  if (!modelName) issues.modelName = '模型名不能为空';
  else if (Array.from(modelName).length > MODEL_NAME_MAX) issues.modelName = `模型名最多 ${MODEL_NAME_MAX} 个字符`;

  const displayName = form.displayName.trim();
  if (!displayName) issues.displayName = '展示名不能为空';
  else if (Array.from(displayName).length > MODEL_DISPLAY_NAME_MAX) issues.displayName = `展示名最多 ${MODEL_DISPLAY_NAME_MAX} 个字符`;

  const description = form.description.trim();
  if (Array.from(description).length > MODEL_DESCRIPTION_MAX) issues.description = `说明最多 ${MODEL_DESCRIPTION_MAX} 个字符`;

  const pointsText = form.pointsPerCall.trim();
  const pointsPerCall = COUNT.test(pointsText) ? Number(pointsText) : null;
  if (pointsPerCall === null || !Number.isSafeInteger(pointsPerCall)) {
    issues.pointsPerCall = '每次点数需为不小于 0 的整数';
  }

  const runtimeParams = parseDeclaredParams(form, issues);

  if (Object.keys(issues).length > 0) return { issues };

  const patch: ModelTierPatch = {};
  if (form.enabled !== initial.enabled) patch.enabled = form.enabled;
  if (provider !== initial.provider) patch.provider = provider;
  if (modelName !== initial.modelName) patch.modelName = modelName;
  if (displayName !== initial.displayName) patch.displayName = displayName;
  if (pointsPerCall !== initial.pointsPerCall) patch.pointsPerCall = pointsPerCall!;
  const nextDescription = description || null;
  if (nextDescription !== (initial.description ?? null)) patch.description = nextDescription;
  if (!sameModelRuntimeParams(runtimeParams, initial.runtimeParams)) patch.runtimeParams = runtimeParams;
  return { patch, issues: {} };
}

/** A client-generated idempotency key; kept under the server's 128-character bound. */
function generateModelIdempotencyKey(): string {
  return `model-${crypto.randomUUID()}`;
}

/**
 * The idempotency key of ONE editing session, not of one click.
 *
 * The service replays an accepted write only when the SAME key arrives with the same request; a key
 * minted per click makes a lost-response retry a *new* request, which then fails the baseline check and
 * blames "another administrator" for the operator's own write. So the key is generated once when the
 * editor opens and is rotated only after a definitive result or an explicit 重新生成 — exactly what
 * `CharacterPublishActions` does. The generator is deliberately not exported: a caller cannot mint a
 * throwaway key behind the session's back.
 */
export interface ModelIdempotencySession {
  /** The key every submit of this session reuses, so a retry is a replay. */
  current(): string;
  /** Rotates the key; call only after a successful write or an explicit 重新生成. */
  rotate(): string;
}

export function modelIdempotencySession(key: string = generateModelIdempotencyKey()): ModelIdempotencySession {
  let currentKey = key;
  return {
    current: () => currentKey,
    rotate: () => (currentKey = generateModelIdempotencyKey()),
  };
}

export interface ModelSaveBody extends ModelTierPatch {
  id: string;
  idempotencyKey: string;
  expectedUpdatedAt: string;
}

/** The exact `PATCH /api/admin/models` body: only the changed fields plus this session's key. */
export function buildModelSaveBody(input: {
  profileId: string;
  expectedUpdatedAt: string;
  patch: ModelTierPatch;
  session: ModelIdempotencySession;
}): ModelSaveBody {
  return {
    id: input.profileId,
    idempotencyKey: input.session.current(),
    expectedUpdatedAt: input.expectedUpdatedAt,
    ...input.patch,
  };
}

export interface ModelPublishBody {
  idempotencyKey: string;
  expectedUpdatedAt: string;
  /** Present only for a restore; an absent one publishes the stored configuration. */
  versionId?: string;
}

/** The exact `POST /api/admin/models/:id/publish` body (publish or restore). */
export function buildModelPublishBody(input: {
  expectedUpdatedAt: string;
  session: ModelIdempotencySession;
  versionId?: string;
}): ModelPublishBody {
  const body: ModelPublishBody = {
    idempotencyKey: input.session.current(),
    expectedUpdatedAt: input.expectedUpdatedAt,
  };
  if (input.versionId) body.versionId = input.versionId;
  return body;
}

/** The declared parameters as one readable line; `未声明` when the version declares none. */
export function formatModelRuntimeParams(params: ModelRuntimeParams): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return '未声明';
  return entries.map(([key, value]) => `${key}=${String(value)}`).join('、');
}
