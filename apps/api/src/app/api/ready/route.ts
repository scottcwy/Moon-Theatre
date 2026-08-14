import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { config } from '@/server/config/index.js';
import { db } from '@/server/db/index.js';
import { characters } from '@/server/db/schema.js';

const CHAT_AGENT_MAX_TOKENS = 768;
const CHAT_AGENT_MAX_TOOL_ITERATIONS = 0;
const DB_CHECK_TIMEOUT_MS = 5000;

// Frozen 19 role agent slugs (Spec §6/§8/§9.2 sentinel; shared with track C
// and scripts/provision-roleplay-agents.mjs — cross-checked by
// scripts/provision-roleplay-agents.test.mjs).
const ROLE_AGENT_SLUGS = [
  'role-baizang',
  'role-hemaoqingxuan',
  'role-yuedaoling',
  'role-jiuyuan',
  'role-chengyuhuai',
  'role-jiangbojia',
  'role-chengzouliu',
  'role-miaohongmo',
  'role-dailila',
  'role-yisa',
  'role-qiangqingci',
  'role-aoding',
  'role-aqi',
  'role-nanchuang',
  'role-fuxiao',
  'role-cenyilan',
  'role-jicanghai',
  'role-zhihe',
  'role-yeshangqiu',
];

interface RoleplayAgentsCheck {
  ok: boolean;
  expectedCount: number;
  foundCount?: number;
  missingAgentIds?: string[];
  duplicateAgentIds?: string[];
  unknownAgentIds?: string[];
}

interface DatabaseCheckResult {
  ok: boolean;
  error?: string;
  roleplayAgents?: RoleplayAgentsCheck;
}

interface FastClawAgentSpec {
  maxTokens: number;
  maxToolIterations: number;
  thinking?: string;
  roleplay?: boolean;
}

interface RoleplayAgentCheck {
  ok: boolean;
  agentId: string;
  maxTokens?: number;
  maxToolIterations?: number;
  thinking?: string;
  roleplay?: boolean;
  error?: string;
}

interface FastClawCheckResult {
  ok: boolean;
  configured: boolean;
  agentId?: string;
  maxTokens?: number;
  maxToolIterations?: number;
  thinking?: string;
  roleplay?: boolean;
  roleplayMode?: boolean;
  roleplayAgentsChecked?: number;
  agents?: Record<string, RoleplayAgentCheck>;
  defaultAgent?: RoleplayAgentCheck;
  error?: string;
}

export async function GET() {
  const roleplayMode = process.env.USE_ROLEPLAY_AGENTS === 'true';
  const checks = {
    api: { ok: true },
    db: await checkDatabase(roleplayMode),
    fastclaw: await checkFastClaw(),
  };
  const ok = Object.values(checks).every((check) => check.ok);

  return NextResponse.json(
    {
      status: ok ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}

async function checkDatabase(requireRoleplayAgents: boolean): Promise<DatabaseCheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`DB readiness check timed out after ${DB_CHECK_TIMEOUT_MS}ms`)),
      DB_CHECK_TIMEOUT_MS,
    );
  });

  try {
    // postgres.js 默认 connect_timeout 30s；ready 不能卡 30s，统一 5s 超时口径。
    await Promise.race([db.execute(sql`select 1`), timeout]);
    if (!requireRoleplayAgents) {
      return { ok: true };
    }

    // Roleplay sentinel (Spec §9.2): the characters table must map all 19
    // active roles to the frozen agent slugs; a missing/duplicate/unknown
    // agent_id would silently fall back to the default agent in chat.
    const rows = await Promise.race([
      db.select({ agentId: characters.agentId }).from(characters).where(eq(characters.status, 'active')),
      timeout,
    ]);
    const roleplayAgents = validateRoleplayAgentIds(rows);
    if (!roleplayAgents.ok) {
      return { ok: false, roleplayAgents, error: describeRoleplayAgentsFailure(roleplayAgents) };
    }
    return { ok: true, roleplayAgents };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DB readiness check failed';
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function validateRoleplayAgentIds(rows: Array<{ agentId: string | null }>): RoleplayAgentsCheck {
  const expectedCount = ROLE_AGENT_SLUGS.length;
  const expected = new Set(ROLE_AGENT_SLUGS);
  const found = new Set<string>();
  const counts = new Map<string, number>();
  let nullCount = 0;

  for (const row of rows) {
    if (!row.agentId) {
      nullCount += 1;
      continue;
    }
    counts.set(row.agentId, (counts.get(row.agentId) ?? 0) + 1);
    found.add(row.agentId);
  }

  const missingAgentIds = ROLE_AGENT_SLUGS.filter((slug) => !found.has(slug));
  const duplicateAgentIds = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([agentId]) => agentId);
  const unknownAgentIds = [...found].filter((agentId) => !expected.has(agentId)).sort();

  const ok =
    rows.length === expectedCount &&
    nullCount === 0 &&
    missingAgentIds.length === 0 &&
    duplicateAgentIds.length === 0 &&
    unknownAgentIds.length === 0;

  return {
    ok,
    expectedCount,
    foundCount: rows.length,
    ...(missingAgentIds.length > 0 ? { missingAgentIds } : {}),
    ...(duplicateAgentIds.length > 0 ? { duplicateAgentIds } : {}),
    ...(unknownAgentIds.length > 0 ? { unknownAgentIds } : {}),
  };
}

function describeRoleplayAgentsFailure(check: RoleplayAgentsCheck): string {
  const parts: string[] = [];
  if (check.foundCount !== check.expectedCount) {
    parts.push(`expected exactly ${check.expectedCount} active characters, found ${check.foundCount}`);
  }
  if (check.missingAgentIds) parts.push(`missingAgentIds=${JSON.stringify(check.missingAgentIds)}`);
  if (check.duplicateAgentIds) parts.push(`duplicateAgentIds=${JSON.stringify(check.duplicateAgentIds)}`);
  if (check.unknownAgentIds) parts.push(`unknownAgentIds=${JSON.stringify(check.unknownAgentIds)}`);
  return `roleplay agents check failed: ${parts.join('; ')}`;
}

function validateAgentSpec(
  spec: FastClawAgentSpec,
  options: { requireRoleplay: boolean; requireNonRoleplay: boolean },
): { ok: true; maxTokens: number; maxToolIterations: number; thinking?: string; roleplay?: boolean }
  | { ok: false; maxTokens?: number; maxToolIterations?: number; thinking?: string; roleplay?: boolean; error: string } {
  const { maxTokens, maxToolIterations, thinking, roleplay } = spec;

  if (maxTokens > CHAT_AGENT_MAX_TOKENS || maxToolIterations !== CHAT_AGENT_MAX_TOOL_ITERATIONS) {
    return {
      ok: false,
      maxTokens,
      maxToolIterations,
      thinking,
      roleplay,
      error: `FastClaw agent exceeds chat runtime limits: maxTokens=${maxTokens}, maxToolIterations=${maxToolIterations}; required maxTokens<=${CHAT_AGENT_MAX_TOKENS} and maxToolIterations=${CHAT_AGENT_MAX_TOOL_ITERATIONS}`,
    };
  }

  // Model-level thinking must be explicitly off; missing or any other
  // value fails closed so an unconfigured FastClaw never ships silently.
  if (thinking !== 'off') {
    return {
      ok: false,
      maxTokens,
      maxToolIterations,
      thinking,
      roleplay,
      error: `FastClaw agent must disable model-level thinking: thinking=${thinking ?? 'missing'}; required thinking="off"`,
    };
  }

  if (options.requireRoleplay && roleplay !== true) {
    return {
      ok: false,
      maxTokens,
      maxToolIterations,
      thinking,
      roleplay,
      error: `FastClaw roleplay agent must run in roleplay mode: roleplay=${roleplay === undefined ? 'missing' : String(roleplay)}; required roleplay=true`,
    };
  }

  if (options.requireNonRoleplay && roleplay === true) {
    return {
      ok: false,
      maxTokens,
      maxToolIterations,
      thinking,
      roleplay,
      error: `FastClaw default agent must stay non-roleplay: roleplay=true; provisioning must not overwrite the legacy default agent`,
    };
  }

  return { ok: true, maxTokens, maxToolIterations, thinking, roleplay };
}

async function checkFastClaw(): Promise<FastClawCheckResult> {
  if (!config.fastclawBaseUrl || !config.fastclawApiKey) {
    return { ok: false, configured: false, error: 'FASTCLAW_BASE_URL and FASTCLAW_API_KEY are required' };
  }
  if (!config.fastclawAgentId) {
    return { ok: false, configured: true, error: 'FASTCLAW_AGENT_ID is required for business chat readiness' };
  }

  const roleplayMode = process.env.USE_ROLEPLAY_AGENTS === 'true';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.fastclawTimeoutMs, 5000));

  try {
    const response = await fetch(`${config.fastclawBaseUrl}/readyz`, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, configured: true, error: `FastClaw readyz returned ${response.status}` };
    }

    if (!roleplayMode) {
      return checkLegacyFastClaw(controller.signal);
    }

    // Roleplay sentinel (Spec §9.2): all 19 role agents must exist with
    // roleplay=true and thinking="off"; the legacy default agent must still
    // exist and stay non-roleplay (Spec §9.1).
    const [defaultAgent, roleAgentChecks] = await Promise.all([
      checkSingleAgent(config.fastclawAgentId, controller.signal, {
        requireRoleplay: false,
        requireNonRoleplay: true,
      }),
      Promise.all(
        ROLE_AGENT_SLUGS.map(async (slug) => {
          const check = await checkSingleAgent(slug, controller.signal, {
            requireRoleplay: true,
            requireNonRoleplay: false,
          });
          return { slug, check };
        }),
      ),
    ]);

    const agents: Record<string, RoleplayAgentCheck> = {};
    for (const { slug, check } of roleAgentChecks) {
      agents[slug] = check;
    }

    const failed = [...Object.values(agents), defaultAgent].filter((check) => !check.ok);
    return {
      ok: failed.length === 0,
      configured: true,
      agentId: config.fastclawAgentId,
      roleplayMode: true,
      roleplayAgentsChecked: ROLE_AGENT_SLUGS.length,
      agents,
      defaultAgent,
      error: failed.length > 0 ? summarizeRoleplayFailures(agents, defaultAgent, failed.length) : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FastClaw readiness check failed';
    return { ok: false, configured: true, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkLegacyFastClaw(signal: AbortSignal): Promise<FastClawCheckResult> {
  const agentSpec = await fetchFastClawAgentRuntimeSpec(config.fastclawAgentId, signal);
  if (!agentSpec.ok) {
    return {
      ok: false,
      configured: true,
      agentId: config.fastclawAgentId,
      error: agentSpec.error,
    };
  }

  const result = validateAgentSpec(agentSpec.spec, {
    requireRoleplay: false,
    requireNonRoleplay: false,
  });
  if (!result.ok) {
    return {
      ok: false,
      configured: true,
      agentId: config.fastclawAgentId,
      maxTokens: result.maxTokens,
      maxToolIterations: result.maxToolIterations,
      thinking: result.thinking,
      error: result.error,
    };
  }

  return {
    ok: true,
    configured: true,
    agentId: config.fastclawAgentId,
    maxTokens: result.maxTokens,
    maxToolIterations: result.maxToolIterations,
    thinking: result.thinking,
  };
}

async function checkSingleAgent(
  agentId: string,
  signal: AbortSignal,
  options: { requireRoleplay: boolean; requireNonRoleplay: boolean },
): Promise<RoleplayAgentCheck> {
  const agentSpec = await fetchFastClawAgentRuntimeSpec(agentId, signal);
  if (!agentSpec.ok) {
    return { ok: false, agentId, error: agentSpec.error };
  }
  const result = validateAgentSpec(agentSpec.spec, options);
  if (!result.ok) {
    return {
      ok: false,
      agentId,
      maxTokens: result.maxTokens,
      maxToolIterations: result.maxToolIterations,
      thinking: result.thinking,
      roleplay: result.roleplay,
      error: result.error,
    };
  }
  return {
    ok: true,
    agentId,
    maxTokens: result.maxTokens,
    maxToolIterations: result.maxToolIterations,
    thinking: result.thinking,
    roleplay: result.roleplay,
  };
}

function summarizeRoleplayFailures(
  agents: Record<string, RoleplayAgentCheck>,
  defaultAgent: RoleplayAgentCheck,
  failedCount: number,
): string {
  const names: string[] = [];
  for (const [slug, check] of Object.entries(agents)) {
    if (!check.ok) names.push(`${slug}: ${check.error}`);
  }
  if (!defaultAgent.ok) names.push(`${defaultAgent.agentId}: ${defaultAgent.error}`);
  return `roleplay readiness failed (${failedCount}): ${names.join('; ')}`;
}

async function fetchFastClawAgentRuntimeSpec(
  agentId: string,
  signal: AbortSignal,
): Promise<
  | { ok: true; spec: FastClawAgentSpec }
  | { ok: false; error: string }
> {
  const response = await fetch(`${config.fastclawBaseUrl}/v1/agents/${encodeURIComponent(agentId)}/runtime-spec`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.fastclawApiKey}`,
    },
    signal,
  });

  if (!response.ok) {
    return { ok: false, error: `FastClaw runtime spec returned ${response.status}` };
  }

  const spec = await response.json() as {
    maxTokens?: unknown;
    maxToolIterations?: unknown;
    thinking?: unknown;
    roleplay?: unknown;
  };
  if (typeof spec.maxTokens !== 'number' || typeof spec.maxToolIterations !== 'number') {
    return { ok: false, error: 'FastClaw runtime spec is missing maxTokens or maxToolIterations' };
  }

  return {
    ok: true,
    spec: {
      maxTokens: spec.maxTokens,
      maxToolIterations: spec.maxToolIterations,
      thinking: typeof spec.thinking === 'string' ? spec.thinking : undefined,
      roleplay: typeof spec.roleplay === 'boolean' ? spec.roleplay : undefined,
    },
  };
}
