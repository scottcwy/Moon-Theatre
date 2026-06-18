import { NextResponse } from 'next/server';
import { config } from '@/server/config/index.js';

export async function GET() {
  const checks = {
    api: { ok: true },
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

async function checkFastClaw(): Promise<{ ok: boolean; configured: boolean; error?: string }> {
  if (!config.fastclawBaseUrl || !config.fastclawApiKey) {
    return { ok: false, configured: false, error: 'FASTCLAW_BASE_URL and FASTCLAW_API_KEY are required' };
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

    return { ok: true, configured: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FastClaw readiness check failed';
    return { ok: false, configured: true, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
