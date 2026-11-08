import { createHash } from 'node:crypto';

/**
 * Batch 3 step 1 (plan W) — the single server-side renderer of the FastClaw base context.
 *
 * The runtime context assembly inside FastClaw is deliberately NOT changed: a roleplay agent still
 * reads its SOUL.md / IDENTITY.md / USER.md plus memory plus the output guards. What changes is who
 * owns the content: the newest published PG content version renders these three files, so they are a
 * derived cache of the published version rather than a second hand-maintained source.
 *
 * The byte layout below is the provisioning contract (`scripts/provision-roleplay-agents.mjs`,
 * Spec §7). `render-parity.test.ts` renders the same character through both implementations and
 * fails on any byte difference, so the deploy-time provisioning path and the publish-time sync
 * cannot drift apart.
 */
export const ROLE_SYSTEM_FILES = ['SOUL.md', 'IDENTITY.md', 'USER.md'] as const;

export type RoleSystemFile = (typeof ROLE_SYSTEM_FILES)[number];

/** The empty user profile template: publish never writes user data (that stays FastClaw's memory). */
export const USER_MD_TEMPLATE = [
  '# User Profile',
  '',
  'This file contains information about the user. Update as you learn more.',
  '',
  '## Preferences',
  '- (To be filled as the agent learns about the user)',
  '',
].join('\n');

export interface RoleFileSource {
  name: string;
  identity?: string | null;
  initialRelationship?: string | null;
  prompt: {
    systemPrompt: string;
    personalityPrompt?: string | null;
    scenarioPrompt?: string | null;
    safetyPrompt?: string | null;
    outputFormatPrompt?: string | null;
  };
}

export type RenderedRoleFiles = Record<RoleSystemFile, string>;

/**
 * Renders the three files exactly as provisioning does (same headings, same blank lines, same
 * `String(value ?? '')` coercion). Values are used verbatim — no trim, no normalization — because a
 * published payload's stored text is what the operator approved.
 */
export function renderRoleFiles(source: RoleFileSource): RenderedRoleFiles {
  if (!source.prompt || !source.prompt.systemPrompt) {
    throw new Error('agent context render requires a non-empty prompt.systemPrompt');
  }
  const soul = [
    '# Soul',
    '',
    '## 核心人设',
    String(source.prompt.systemPrompt),
    '',
    '## 人格',
    String(source.prompt.personalityPrompt ?? ''),
    '',
    '## 剧情',
    String(source.prompt.scenarioPrompt ?? ''),
    '',
    '## 安全',
    String(source.prompt.safetyPrompt ?? ''),
    '',
    '## 输出风格',
    String(source.prompt.outputFormatPrompt ?? ''),
    '',
  ].join('\n');

  const identityFile = [
    '# Identity',
    '',
    '## 名字',
    String(source.name),
    '',
    '## 身份',
    String(source.identity ?? ''),
    '',
    '## 关系起点',
    String(source.initialRelationship ?? ''),
    '',
  ].join('\n');

  return {
    'SOUL.md': soul,
    'IDENTITY.md': identityFile,
    'USER.md': USER_MD_TEMPLATE,
  };
}

export function hashRoleFile(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Deterministic hash of the whole base context: the three file names in fixed order plus their
 * bytes. Two renders are the same context iff this hash matches, which is what makes recording,
 * dedupe and drift comparison exact instead of timestamp-based.
 */
export function hashRoleFiles(files: RenderedRoleFiles): string {
  const hash = createHash('sha256');
  for (const name of ROLE_SYSTEM_FILES) hash.update(`${name}\u0000`, 'utf8').update(files[name], 'utf8').update('\u0000', 'utf8');
  return hash.digest('hex');
}

export interface RenderedAgentContext {
  files: RenderedRoleFiles;
  fileHashes: RenderedRoleFiles;
  /** Character counts per file: what the snapshot reports so a drift notice can be explained. */
  counts: Record<RoleSystemFile, number>;
  contentHash: string;
}

/** Renders an untrusted (jsonb) published payload; throws when it cannot carry a persona at all. */
export function renderPublishedAgentContext(payload: unknown): RenderedAgentContext {
  if (!payload || typeof payload !== 'object') throw new Error('published payload is not an object');
  const source = payload as Partial<RoleFileSource>;
  const files = renderRoleFiles({
    name: String(source.name ?? ''),
    identity: source.identity ?? '',
    initialRelationship: source.initialRelationship ?? '',
    prompt: source.prompt as RoleFileSource['prompt'],
  });
  return {
    files,
    fileHashes: {
      'SOUL.md': hashRoleFile(files['SOUL.md']),
      'IDENTITY.md': hashRoleFile(files['IDENTITY.md']),
      'USER.md': hashRoleFile(files['USER.md']),
    },
    counts: {
      'SOUL.md': files['SOUL.md'].length,
      'IDENTITY.md': files['IDENTITY.md'].length,
      'USER.md': files['USER.md'].length,
    },
    contentHash: hashRoleFiles(files),
  };
}
