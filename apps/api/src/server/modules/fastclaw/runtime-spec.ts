import { config } from '../../config/index.js';

/**
 * Batch 3 step 4 — read one agent's reported runtime spec (read-only).
 *
 *   GET /v1/agents/{id}/runtime-spec  →  { id, model, maxTokens, temperature, maxToolIterations, thinking, roleplay }
 *
 * This is the only FastClaw endpoint the model configuration check uses. It is NOT
 * `POST /api/test-provider`: that endpoint takes provider credentials in the request body, and the
 * console must never hold a provider key. This read needs only the existing `FASTCLAW_API_KEY`, makes
 * no provider round-trip and changes nothing upstream.
 *
 * The response is projected onto the non-secret runtime fields on the way in. Nothing else from the
 * body (provider rows, keys, roleplay flags) is retained, returned or logged, so an upstream that
 * echoes credentials cannot leak through this client.
 */
export type FastClawRuntimeSpec = {
  model: string;
  maxTokens: number;
  temperature: number | null;
  maxToolIterations: number;
  thinking: string | null;
};

export type FastClawRuntimeSpecFailure =
  | 'not_configured'
  | 'timeout'
  | 'unreachable'
  | 'unauthorized'
  | 'not_found'
  | 'rejected'
  | 'upstream_error';

export type RuntimeSpecReadResult =
  | { ok: true; spec: FastClawRuntimeSpec }
  | { ok: false; code: FastClawRuntimeSpecFailure; status: number | null; message: string };

export const RUNTIME_SPEC_TIMEOUT_MS = 5_000;
export const RUNTIME_SPEC_TIMEOUT_MAX_MS = 15_000;

export function isFastClawConfiguredForRuntimeSpec(): boolean {
  return Boolean(config.fastclawBaseUrl && config.fastclawApiKey);
}

function boundedTimeout(timeoutMs?: number): number {
  const requested = timeoutMs ?? RUNTIME_SPEC_TIMEOUT_MS;
  if (!Number.isFinite(requested) || requested <= 0) return RUNTIME_SPEC_TIMEOUT_MS;
  return Math.min(Math.floor(requested), RUNTIME_SPEC_TIMEOUT_MAX_MS);
}

function classify(status: number): FastClawRuntimeSpecFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 400) return 'rejected';
  if (status === 404) return 'not_found';
  return 'upstream_error';
}

function classifyError(error: unknown): { code: FastClawRuntimeSpecFailure; message: string } {
  if (error instanceof Error && error.name === 'AbortError') return { code: 'timeout', message: 'FastClaw runtime-spec request timed out' };
  return { code: 'unreachable', message: error instanceof Error ? error.message : 'FastClaw runtime-spec request failed' };
}

export interface AgentRuntimeSpecRequest {
  agentId: string;
  timeoutMs?: number;
}

/** Reads one agent's runtime spec. Never retried: the caller reports `unavailable` and moves on. */
export async function readAgentRuntimeSpec(input: AgentRuntimeSpecRequest): Promise<RuntimeSpecReadResult> {
  if (!input.agentId.trim()) {
    return { ok: false, code: 'not_found', status: null, message: 'no agent id to check' };
  }
  if (!isFastClawConfiguredForRuntimeSpec()) {
    return { ok: false, code: 'not_configured', status: null, message: 'FastClaw is not configured' };
  }
  const base = config.fastclawBaseUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedTimeout(input.timeoutMs));
  try {
    const response = await fetch(`${base}/v1/agents/${encodeURIComponent(input.agentId)}/runtime-spec`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.fastclawApiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        code: classify(response.status),
        status: response.status,
        message: `FastClaw runtime-spec responded with status ${response.status}`,
      };
    }
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return projectRuntimeSpec(body);
  } catch (error) {
    return { ok: false, status: null, ...classifyError(error) };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Narrow projection: an absent model or tool-iteration count is a failure, not a guess. `temperature`
 * and `thinking` stay nullable because an agent may legitimately omit them.
 */
export function projectRuntimeSpec(body: unknown): RuntimeSpecReadResult {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (!source || typeof source.model !== 'string' || !source.model.trim()
      || typeof source.maxToolIterations !== 'number' || !Number.isFinite(source.maxToolIterations)) {
    return { ok: false, code: 'upstream_error', status: 200, message: 'FastClaw runtime-spec was missing model or maxToolIterations' };
  }
  return {
    ok: true,
    spec: {
      model: source.model.trim(),
      maxTokens: typeof source.maxTokens === 'number' && Number.isFinite(source.maxTokens) ? source.maxTokens : 0,
      temperature: typeof source.temperature === 'number' && Number.isFinite(source.temperature) ? source.temperature : null,
      maxToolIterations: source.maxToolIterations,
      thinking: typeof source.thinking === 'string' ? source.thinking : null,
    },
  };
}
