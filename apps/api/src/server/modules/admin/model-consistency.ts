import { and, eq, isNotNull } from 'drizzle-orm';
import { config } from '../../config/index.js';
import { db } from '../../db/index.js';
import { characters, modelProfiles } from '../../db/schema.js';
import { NotFoundError } from '../../http/errors.js';
import type { ModelRuntimeParams } from './model-runtime-params.js';
import { listAdminModelVersions } from './models.js';
import { isFastClawConfiguredForRuntimeSpec, readAgentRuntimeSpec } from '../fastclaw/runtime-spec.js';

/**
 * Configuration consistency check (AC-15 / AC-17 / AC-27).
 *
 * READ-ONLY and credential-free by construction:
 *  - it never calls `POST /api/test-provider` (that endpoint takes provider credentials in the body,
 *    which this console must never hold) and performs no provider round-trip at all;
 *  - it reads only what FastClaw reports for the agents a turn can run on — `GET
 *    /v1/agents/{id}/runtime-spec` — and compares it with the tier's declared provider/model and
 *    declared runtime parameters;
 *  - the result is one of three honest states. `unavailable` is NOT success: it means the comparison
 *    could not be made, and the console must say exactly that.
 *
 * The response carries model ids, an agent id and the declared keys only — never a raw upstream body,
 * a provider row, a key or `credentialRef`.
 *
 * NOT a publish gate: AC-15's 「错误测试阻止发布」 is not implemented here — publish/restore never
 * consult this check (see the batch-3 step-4 report), so a `mismatch` cannot block a publish yet.
 */
export type ModelConsistencyStatus = 'match' | 'mismatch' | 'unavailable';

export type ModelConsistencyReason =
  | 'no_published_version'
  | 'no_agent_mapped'
  | 'fastclaw_not_configured'
  | 'agents_unavailable';

export interface ModelConsistencyDifference {
  key: string;
  expected: string;
  actual: string | null;
}

export interface ModelConsistencyAgent {
  agentId: string;
  status: ModelConsistencyStatus;
  model: string | null;
  differences: ModelConsistencyDifference[];
}

export interface ModelConsistencyCheck {
  status: ModelConsistencyStatus;
  reason: ModelConsistencyReason | null;
  checkedAt: string;
  expected: {
    provider: string;
    modelName: string;
    modelId: string;
    runtimeParams: ModelRuntimeParams;
  };
  agents: ModelConsistencyAgent[];
}

/** Bound on agents checked per click: a manual consistency read must not fan out unbounded. */
export const MODEL_CHECK_AGENT_LIMIT = 20;

/**
 * The ids the runtime would report for this tier. A tier may store the bare model name (seed) or the
 * provider-prefixed id (captured/legacy rows); both describe the same runtime model, so both match.
 */
function expectedModelIds(provider: string, modelName: string): string[] {
  const providerId = provider.trim();
  const name = modelName.trim();
  const ids = new Set<string>([`${providerId}/${name}`]);
  if (name.startsWith(`${providerId}/`)) ids.add(name);
  return [...ids];
}

function compareAgent(
  agentId: string,
  spec: { model: string; maxTokens: number; temperature: number | null; maxToolIterations: number; thinking: string | null },
  expected: ModelConsistencyCheck['expected'],
): ModelConsistencyAgent {
  const differences: ModelConsistencyDifference[] = [];
  const accepted = expectedModelIds(expected.provider, expected.modelName);
  if (!accepted.includes(spec.model)) {
    differences.push({ key: 'model', expected: expected.modelId, actual: spec.model });
  }
  const reported: Record<string, string | null> = {
    maxTokens: String(spec.maxTokens),
    temperature: spec.temperature === null ? null : String(spec.temperature),
    maxToolIterations: String(spec.maxToolIterations),
    thinking: spec.thinking,
  };
  for (const [key, value] of Object.entries(expected.runtimeParams)) {
    const actual = reported[key] ?? null;
    if (actual !== String(value)) differences.push({ key, expected: String(value), actual });
  }
  return { agentId, status: differences.length > 0 ? 'mismatch' : 'match', model: spec.model, differences };
}

/** The agents a business turn can actually run on: active characters' agent ids + the configured default. */
async function mappedAgentIds(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ agentId: characters.agentId })
    .from(characters)
    .where(and(isNotNull(characters.agentId), eq(characters.status, 'active')))
    .orderBy(characters.agentId)
    .limit(MODEL_CHECK_AGENT_LIMIT);
  const ids = new Set(rows.map(row => row.agentId).filter((id): id is string => Boolean(id && id.trim())));
  const fallback = config.fastclawAgentId?.trim();
  if (fallback) ids.add(fallback);
  return [...ids].slice(0, MODEL_CHECK_AGENT_LIMIT);
}

export async function checkAdminModelConsistency(profileId: string): Promise<ModelConsistencyCheck> {
  const [profile] = await db
    .select({ id: modelProfiles.id, provider: modelProfiles.provider, modelName: modelProfiles.modelName })
    .from(modelProfiles)
    .where(eq(modelProfiles.id, profileId))
    .limit(1);
  if (!profile) throw new NotFoundError('Model profile');

  const expected: ModelConsistencyCheck['expected'] = {
    provider: profile.provider,
    modelName: profile.modelName,
    modelId: `${profile.provider}/${profile.modelName}`,
    runtimeParams: {},
  };
  const checkedAt = new Date().toISOString();

  const versions = await listAdminModelVersions(profileId);
  const current = versions.find(version => version.isCurrent);
  if (!current) {
    return { status: 'unavailable', reason: 'no_published_version', checkedAt, expected, agents: [] };
  }
  expected.runtimeParams = current.runtimeParams;

  const agentIds = await mappedAgentIds();
  if (agentIds.length === 0) {
    return { status: 'unavailable', reason: 'no_agent_mapped', checkedAt, expected, agents: [] };
  }

  if (!isFastClawConfiguredForRuntimeSpec()) {
    return {
      status: 'unavailable',
      reason: 'fastclaw_not_configured',
      checkedAt,
      expected,
      agents: agentIds.map(agentId => ({ agentId, status: 'unavailable', model: null, differences: [] })),
    };
  }

  // One bounded read per mapped agent, in parallel: the whole check stays inside one timeout budget
  // even when the gateway is dead, and no agent is retried.
  const agents = await Promise.all(agentIds.map(async (agentId): Promise<ModelConsistencyAgent> => {
    const result = await readAgentRuntimeSpec({ agentId });
    if (!result.ok) return { agentId, status: 'unavailable', model: null, differences: [] };
    return compareAgent(agentId, result.spec, expected);
  }));

  // A real difference outranks an unreadable agent; anything short of "every mapped agent matched"
  // is never reported as success.
  const status: ModelConsistencyStatus = agents.some(agent => agent.status === 'mismatch')
    ? 'mismatch'
    : agents.some(agent => agent.status === 'unavailable')
      ? 'unavailable'
      : 'match';
  return {
    status,
    reason: status === 'unavailable' ? 'agents_unavailable' : null,
    checkedAt,
    expected,
    agents,
  };
}
