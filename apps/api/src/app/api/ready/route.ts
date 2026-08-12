import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { config } from '@/server/config/index.js';
import { db } from '@/server/db/index.js';

const CHAT_AGENT_MAX_TOKENS = 768;
const CHAT_AGENT_MAX_TOOL_ITERATIONS = 0;
const DB_CHECK_TIMEOUT_MS = 5000;

export async function GET() {
  const checks = {
    api: { ok: true },
    db: await checkDatabase(),
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

async function checkDatabase(): Promise<{ ok: boolean; error?: string }> {
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
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DB readiness check failed';
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

async function checkFastClaw(): Promise<{
  ok: boolean;
  configured: boolean;
  agentId?: string;
  maxTokens?: number;
  maxToolIterations?: number;
  error?: string;
}> {
  if (!config.fastclawBaseUrl || !config.fastclawApiKey) {
    return { ok: false, configured: false, error: 'FASTCLAW_BASE_URL and FASTCLAW_API_KEY are required' };
  }
  if (!config.fastclawAgentId) {
    return { ok: false, configured: true, error: 'FASTCLAW_AGENT_ID is required for business chat readiness' };
  }

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

    const agentSpec = await fetchFastClawAgentRuntimeSpec(config.fastclawAgentId, controller.signal);
    if (!agentSpec.ok) {
      return {
        ok: false,
        configured: true,
        agentId: config.fastclawAgentId,
        error: agentSpec.error,
      };
    }

    const { maxTokens, maxToolIterations } = agentSpec;
    if (maxTokens > CHAT_AGENT_MAX_TOKENS || maxToolIterations !== CHAT_AGENT_MAX_TOOL_ITERATIONS) {
      return {
        ok: false,
        configured: true,
        agentId: config.fastclawAgentId,
        maxTokens,
        maxToolIterations,
        error: `FastClaw agent exceeds chat runtime limits: maxTokens=${maxTokens}, maxToolIterations=${maxToolIterations}; required maxTokens<=${CHAT_AGENT_MAX_TOKENS} and maxToolIterations=${CHAT_AGENT_MAX_TOOL_ITERATIONS}`,
      };
    }

    return {
      ok: true,
      configured: true,
      agentId: config.fastclawAgentId,
      maxTokens,
      maxToolIterations,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FastClaw readiness check failed';
    return { ok: false, configured: true, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFastClawAgentRuntimeSpec(
  agentId: string,
  signal: AbortSignal,
): Promise<
  | { ok: true; maxTokens: number; maxToolIterations: number }
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
  };
  if (typeof spec.maxTokens !== 'number' || typeof spec.maxToolIterations !== 'number') {
    return { ok: false, error: 'FastClaw runtime spec is missing maxTokens or maxToolIterations' };
  }

  return {
    ok: true,
    maxTokens: spec.maxTokens,
    maxToolIterations: spec.maxToolIterations,
  };
}
