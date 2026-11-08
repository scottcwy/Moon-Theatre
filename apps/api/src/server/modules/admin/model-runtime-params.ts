/**
 * The declared runtime parameters of a model tier (AC-15 / §8).
 *
 * These are NOT knobs the console can turn. The chat runtime forwards no request-level `model` or
 * sampling parameters (`chat/stream-runner.ts` → `fastclaw/adapter.ts` sends only messages + headers),
 * and FastClaw resolves the runtime model and limits from its own agent config. What the console can
 * do honestly is record a small declaration and CHECK it against what FastClaw reports:
 *
 *   GET /v1/agents/{id}/runtime-spec → { model, maxTokens, temperature, maxToolIterations, thinking }
 *
 * That response is therefore the whole allowlist. A `model`, `topP` or `apiKey` key would either claim
 * a request-level model (forbidden by §8/AC-15) or smuggle a credential into a stored version, so both
 * are refused instead of silently stored.
 *
 * Dependency-free on purpose: the API schema, the service and the browser form all import this module.
 */
export const MODEL_RUNTIME_PARAM_KEYS = ['maxTokens', 'temperature', 'maxToolIterations', 'thinking'] as const;
export type ModelRuntimeParamKey = (typeof MODEL_RUNTIME_PARAM_KEYS)[number];

/** Mirrors the runtime contract the readiness probe enforces (`/api/ready`, `docs/deployment.md`). */
export const MODEL_RUNTIME_MAX_TOKENS_CAP = 768;
export const MODEL_RUNTIME_MAX_TOOL_ITERATIONS_CAP = 20;
export const MODEL_RUNTIME_TEMPERATURE_MAX = 2;

export type ModelRuntimeParams = {
  maxTokens?: number;
  temperature?: number;
  maxToolIterations?: number;
  thinking?: 'off';
};

const SECRET_FIELD_NAMES = new Set([
  'apikey', 'secret', 'clientsecret', 'password', 'token', 'accesstoken', 'refreshtoken',
  'credential', 'credentials', 'credentialref', 'authorization', 'bearer', 'privatekey', 'publickey',
  'signingkey', 'apisecret', 'providerkey',
]);

/**
 * A credential-looking field name. Used to reject such a field outright (400) instead of letting it
 * reach a version snapshot, an audit summary or a log line.
 */
export function isSecretLikeFieldName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z]/g, '');
  if (!normalized) return false;
  return SECRET_FIELD_NAMES.has(normalized)
    || normalized.endsWith('apikey')
    || normalized.endsWith('secret')
    || normalized.endsWith('password')
    || normalized.endsWith('credentialref');
}

/** Depth-first search for a credential-looking key. Returns the dotted path or null. */
export function findSecretFieldPath(value: unknown, prefix = ''): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSecretFieldPath(value[index], `${prefix}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isSecretLikeFieldName(key)) return path;
    const found = findSecretFieldPath(entry, path);
    if (found) return found;
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** `null` when the value is an acceptable declaration, otherwise the Chinese reason it is not. */
export function modelRuntimeParamIssue(key: string, value: unknown): string | null {
  if (isSecretLikeFieldName(key)) return `不接受凭据类字段：${key}（密钥只能放在服务器环境变量中）`;
  switch (key) {
    case 'maxTokens':
      return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MODEL_RUNTIME_MAX_TOKENS_CAP
        ? null
        : `最大输出 token 需为 1–${MODEL_RUNTIME_MAX_TOKENS_CAP} 的整数`;
    case 'temperature':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MODEL_RUNTIME_TEMPERATURE_MAX
        ? null
        : `temperature 需为 0–${MODEL_RUNTIME_TEMPERATURE_MAX} 的数字`;
    case 'maxToolIterations':
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MODEL_RUNTIME_MAX_TOOL_ITERATIONS_CAP
        ? null
        : `工具迭代上限需为 0–${MODEL_RUNTIME_MAX_TOOL_ITERATIONS_CAP} 的整数`;
    case 'thinking':
      return value === 'off' ? null : 'thinking 只允许 off：模型级思考必须关闭';
    default:
      return `未知的运行参数：${key}（仅支持 ${MODEL_RUNTIME_PARAM_KEYS.join(' / ')}）`;
  }
}

export function modelRuntimeParamsIssues(value: unknown): string[] {
  if (!isPlainObject(value)) return ['运行参数必须是 JSON 对象'];
  return Object.entries(value)
    .map(([key, entry]) => modelRuntimeParamIssue(key, entry))
    .filter((issue): issue is string => Boolean(issue));
}

/**
 * Read-surface projection: only allowlisted keys with acceptable values survive, so a hand-written or
 * legacy row can never echo a credential or a bogus declaration back to the console.
 */
export function pickModelRuntimeParams(value: unknown): ModelRuntimeParams {
  if (!isPlainObject(value)) return {};
  const picked: Record<string, unknown> = {};
  for (const key of MODEL_RUNTIME_PARAM_KEYS) {
    if (!(key in value)) continue;
    if (modelRuntimeParamIssue(key, value[key]) !== null) continue;
    picked[key] = value[key];
  }
  return picked as ModelRuntimeParams;
}

export function sameModelRuntimeParams(left: unknown, right: unknown): boolean {
  const a = pickModelRuntimeParams(left);
  const b = pickModelRuntimeParams(right);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }
  return true;
}
