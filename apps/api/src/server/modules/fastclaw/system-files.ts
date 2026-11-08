import { config } from '../../config/index.js';
import { ROLE_SYSTEM_FILES, type RoleSystemFile } from '../agent-context/render.js';

/**
 * Batch 3 step 1 — read/write the three base-context files of a roleplay agent through the FastClaw
 * setup API. This is deliberately the ONLY new FastClaw surface: the runtime that assembles a
 * turn's context (SOUL/IDENTITY/USER + memory + guards) is not touched at all.
 *
 * Protocol (FastClaw `internal/setup/server.go` + `handlers_agents.go`):
 *   GET /api/agents/{id}/system-files/{name}  → 200 {"content": "..."}
 *   PUT /api/agents/{id}/system-files/{name}  → 200 {"ok": true}, body {"content": "..."}
 * Auth is `Authorization: Bearer <FASTCLAW_API_KEY>`; the agent id is the path segment. The setup
 * server scopes the row by the authenticated user, so the configured key must belong to the agent's
 * owner (`agents.user_id`) — the same owner row provisioning writes.
 *
 * Bounded, classified, never retried: a retry could duplicate a write whose response was lost, and
 * the operation is idempotent by content anyway (callers re-run it instead).
 */
export type FastClawSystemFileFailure =
  | 'not_configured'
  | 'invalid_filename'
  | 'timeout'
  | 'unreachable'
  | 'unauthorized'
  | 'rejected'
  | 'not_found'
  | 'upstream_error';

export type SystemFileReadResult =
  | { ok: true; content: string }
  | { ok: false; code: FastClawSystemFileFailure; status: number | null; message: string };

export type SystemFileWriteResult =
  | { ok: true }
  | { ok: false; code: FastClawSystemFileFailure; status: number | null; message: string };

/** Bounded per-request budget: an admin publish or rebuild must not hang on a dead gateway. */
export const SYSTEM_FILE_TIMEOUT_MS = 5_000;
export const SYSTEM_FILE_TIMEOUT_MAX_MS = 15_000;

export function isFastClawConfiguredForSystemFiles(): boolean {
  return Boolean(config.fastclawBaseUrl && config.fastclawApiKey);
}

function boundedTimeout(timeoutMs?: number): number {
  const requested = timeoutMs ?? SYSTEM_FILE_TIMEOUT_MS;
  if (!Number.isFinite(requested) || requested <= 0) return SYSTEM_FILE_TIMEOUT_MS;
  return Math.min(Math.floor(requested), SYSTEM_FILE_TIMEOUT_MAX_MS);
}

function isRoleSystemFile(name: string): name is RoleSystemFile {
  return (ROLE_SYSTEM_FILES as readonly string[]).includes(name);
}

function systemFileUrl(agentId: string, name: string): string {
  const base = config.fastclawBaseUrl.replace(/\/+$/, '');
  return `${base}/api/agents/${encodeURIComponent(agentId)}/system-files/${encodeURIComponent(name)}`;
}

function classify(status: number): FastClawSystemFileFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 400) return 'rejected';
  if (status === 404) return 'not_found';
  return 'upstream_error';
}

function classifyError(error: unknown): { code: FastClawSystemFileFailure; message: string } {
  if (error instanceof Error && error.name === 'AbortError') return { code: 'timeout', message: 'FastClaw request timed out' };
  const message = error instanceof Error ? error.message : 'FastClaw request failed';
  return { code: 'unreachable', message };
}

export interface SystemFileRequest {
  agentId: string;
  name: string;
  timeoutMs?: number;
}

/** Reads one base-context file. A missing row reads as `{"content": ""}` upstream, never as a 404. */
export async function readAgentSystemFile(input: SystemFileRequest): Promise<SystemFileReadResult> {
  if (!isRoleSystemFile(input.name)) {
    return { ok: false, code: 'invalid_filename', status: null, message: `not a base context file: ${input.name}` };
  }
  if (!isFastClawConfiguredForSystemFiles()) {
    return { ok: false, code: 'not_configured', status: null, message: 'FastClaw is not configured' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedTimeout(input.timeoutMs));
  try {
    const response = await fetch(systemFileUrl(input.agentId, input.name), {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.fastclawApiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        code: classify(response.status),
        status: response.status,
        message: `FastClaw system-files read responded with status ${response.status}`,
      };
    }
    const body = (await response.json().catch(() => null)) as { content?: unknown } | null;
    if (!body || typeof body.content !== 'string') {
      return { ok: false, code: 'upstream_error', status: response.status, message: 'FastClaw system-files read had no content' };
    }
    return { ok: true, content: body.content };
  } catch (error) {
    return { ok: false, status: null, ...classifyError(error) };
  } finally {
    clearTimeout(timeout);
  }
}

/** Writes one base-context file. Idempotent by content: re-writing the same bytes is a no-op. */
export async function writeAgentSystemFile(
  input: SystemFileRequest & { content: string },
): Promise<SystemFileWriteResult> {
  if (!isRoleSystemFile(input.name)) {
    return { ok: false, code: 'invalid_filename', status: null, message: `not a base context file: ${input.name}` };
  }
  if (!isFastClawConfiguredForSystemFiles()) {
    return { ok: false, code: 'not_configured', status: null, message: 'FastClaw is not configured' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedTimeout(input.timeoutMs));
  try {
    const response = await fetch(systemFileUrl(input.agentId, input.name), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.fastclawApiKey}`,
      },
      body: JSON.stringify({ content: input.content }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        code: classify(response.status),
        status: response.status,
        message: `FastClaw system-files write responded with status ${response.status}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, status: null, ...classifyError(error) };
  } finally {
    clearTimeout(timeout);
  }
}

export type SystemFilesReadResult =
  | { ok: true; files: Record<RoleSystemFile, string> }
  | { ok: false; code: FastClawSystemFileFailure; status: number | null; message: string; name: RoleSystemFile };

/**
 * Reads the three base-context files. Any failure is reported as a whole: a partially read context
 * is never compared against a record, because half a context would look like drift that is not real.
 * The three reads run in parallel so the total wait stays inside one bounded timeout, even when the
 * gateway is dead (an admin page must not hang for three timeouts in a row).
 */
export async function readRoleSystemFiles(
  agentId: string,
  options: { timeoutMs?: number } = {},
): Promise<SystemFilesReadResult> {
  const results = await Promise.all(
    ROLE_SYSTEM_FILES.map(async (name) => ({ name, result: await readAgentSystemFile({ agentId, name, timeoutMs: options.timeoutMs }) })),
  );
  const files = {} as Record<RoleSystemFile, string>;
  for (const { name, result } of results) {
    if (!result.ok) return { ok: false, code: result.code, status: result.status, message: result.message, name };
    files[name] = result.content;
  }
  return { ok: true, files };
}
