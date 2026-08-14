// Provisioning: 19 roleplay agents + role-card owner rows for FastClaw.
//
// Contract: docs/specs/2026-08-14-fastclaw-roleplay-agent-architecture-spec.md
// §6/§7/§8/§9.1. Reads character_prompts (5 fields) from
// apps/api/src/server/seed/story-data.ts, renders SOUL.md / IDENTITY.md /
// USER.md, and syncs them as FastClaw agent_files owner rows (agents.user_id)
// — never user_id='' template rows. Also upserts the agent-scope
// `agents.defaults` config row (roleplay/thinking/maxToolIterations only;
// model/maxTokens/temperature are never touched).
//
// Modes:
//   default      dry-run: print the diff, write nothing, exit 0
//   --apply      apply the diff; a second run prints "no changes" (idempotent)
//
// DB access shells out to sqlite3 (sqlite file) or psql (postgres DSN) —
// same style as scripts/backup-postgres.mjs. No new npm dependencies.
//
// Usage:
//   node scripts/provision-roleplay-agents.mjs [--apply] [--db <path|dsn>]
//       [--owner-user-id <id>] [--default-agent-id <id>]
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { parseDotEnv } from './dev.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Frozen contract (orchestrator / track C shared, must stay byte-for-byte):
// 19 stable role agent slugs, keyed by seed character name.
// ---------------------------------------------------------------------------
export const ROLE_AGENT_BY_NAME = Object.freeze({
  白藏: 'role-baizang',
  贺茂清玄: 'role-hemaoqingxuan',
  月岛澪: 'role-yuedaoling',
  久远: 'role-jiuyuan',
  程聿怀: 'role-chengyuhuai',
  蒋伯驾: 'role-jiangbojia',
  程走柳: 'role-chengzouliu',
  缪宏谟: 'role-miaohongmo',
  黛利拉: 'role-dailila',
  以撒: 'role-yisa',
  羌青瓷: 'role-qiangqingci',
  奥丁: 'role-aoding',
  阿奇: 'role-aqi',
  南窗: 'role-nanchuang',
  赋霄: 'role-fuxiao',
  岑奕岚: 'role-cenyilan',
  季沧海: 'role-jicanghai',
  知何: 'role-zhihe',
  叶上秋: 'role-yeshangqiu',
});

export const ROLE_AGENT_SLUGS = Object.freeze(Object.values(ROLE_AGENT_BY_NAME));

export const ROLE_SYSTEM_FILES = Object.freeze(['SOUL.md', 'IDENTITY.md', 'USER.md']);

// Only these keys are written by provisioning (Spec §8: model/maxTokens/
// temperature must NOT move). Roleplay/tools/heartbeat/skills defaults are
// enforced by the FastClaw roleplay kernel (F4); provisioning pins the
// keys the runtime reads from the agent-scope agents.defaults row and that
// /api/ready verifies via runtime-spec.
export const ROLEPLAY_AGENT_CONFIG = Object.freeze({
  roleplay: true,
  thinking: 'off',
  maxToolIterations: 0,
});

export const USER_MD_TEMPLATE = [
  '# User Profile',
  '',
  'This file contains information about the user. Update as you learn more.',
  '',
  '## Preferences',
  '- (To be filled as the agent learns about the user)',
  '',
].join('\n');

// ---------------------------------------------------------------------------
// Seed loading: story-data.ts is a plain data module (no imports); transpile
// with the already-installed root `typescript` dev dependency and evaluate.
// ---------------------------------------------------------------------------
const seedPath = path.join(repoRoot, 'apps/api/src/server/seed/story-data.ts');

export function loadSeedCharacters() {
  const source = fs.readFileSync(seedPath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'module', output)(module.exports, module);
  const characters = module.exports.seedCharacters;
  if (!Array.isArray(characters)) {
    throw new Error(`seed file ${seedPath} did not export seedCharacters`);
  }
  return characters;
}

// ---------------------------------------------------------------------------
// Rendering (Spec §7).
// ---------------------------------------------------------------------------
export function renderRoleFiles(character) {
  const { name, identity, initialRelationship, prompt } = character;
  if (!prompt || !prompt.systemPrompt) {
    throw new Error(`seed character ${name} is missing prompt.systemPrompt`);
  }
  const soul = [
    '# Soul',
    '',
    '## 核心人设',
    String(prompt.systemPrompt),
    '',
    '## 人格',
    String(prompt.personalityPrompt ?? ''),
    '',
    '## 剧情',
    String(prompt.scenarioPrompt ?? ''),
    '',
    '## 安全',
    String(prompt.safetyPrompt ?? ''),
    '',
    '## 输出风格',
    String(prompt.outputFormatPrompt ?? ''),
    '',
  ].join('\n');

  const identityFile = [
    '# Identity',
    '',
    '## 名字',
    String(name),
    '',
    '## 身份',
    String(identity ?? ''),
    '',
    '## 关系起点',
    String(initialRelationship ?? ''),
    '',
  ].join('\n');

  return {
    'SOUL.md': soul,
    'IDENTITY.md': identityFile,
    'USER.md': USER_MD_TEMPLATE,
  };
}

export function buildDesiredAgents(seedCharacters, ownerUserId) {
  if (typeof ownerUserId !== 'string' || ownerUserId === '') {
    throw new Error('ownerUserId is required');
  }
  assertFrozenSlugs(seedCharacters);
  return seedCharacters.map((character) => ({
    id: ROLE_AGENT_BY_NAME[character.name],
    name: character.name,
    userId: ownerUserId,
    files: renderRoleFiles(character),
  }));
}

export function assertFrozenSlugs(seedCharacters) {
  const names = seedCharacters.map((character) => character.name);
  if (names.length !== ROLE_AGENT_SLUGS.length) {
    throw new Error(
      `seed has ${names.length} characters but frozen role list has ${ROLE_AGENT_SLUGS.length}`,
    );
  }
  const missing = names.filter((name) => !ROLE_AGENT_BY_NAME[name]);
  if (missing.length > 0) {
    throw new Error(`seed characters missing from frozen slug map: ${missing.join(', ')}`);
  }
  const unseen = ROLE_AGENT_SLUGS.filter((slug) => !names.some((name) => ROLE_AGENT_BY_NAME[name] === slug));
  if (unseen.length > 0) {
    throw new Error(`frozen slugs missing from seed: ${unseen.join(', ')}`);
  }
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new Error(`duplicate seed character names: ${[...new Set(duplicates)].join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Diff helpers.
// ---------------------------------------------------------------------------
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => deepEqual(value, b[index]))
    );
  }
  if (typeof a === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]))
    );
  }
  return false;
}

export function mergeRoleplayConfig(existing) {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {};
  // Never clobber model/maxTokens/temperature (Spec §8: 不动).
  for (const [key, value] of Object.entries(ROLEPLAY_AGENT_CONFIG)) {
    base[key] = value;
  }
  return base;
}

export function buildPlan(desiredAgents, actual) {
  const changes = {
    createAgents: [],
    updateAgents: [],
    writeFiles: [],
    writeConfigs: [],
    errors: [],
  };

  for (const agent of desiredAgents) {
    const existingAgent = actual.agents.get(agent.id);
    if (!existingAgent) {
      changes.createAgents.push(agent.id);
    } else if (existingAgent.user_id !== agent.userId) {
      changes.errors.push(
        `agent ${agent.id} is owned by ${existingAgent.user_id}, refusing to steal ownership (expected ${agent.userId})`,
      );
    } else if (existingAgent.name !== agent.name) {
      changes.updateAgents.push({ id: agent.id, name: agent.name });
    }

    for (const [filename, content] of Object.entries(agent.files)) {
      const key = `${agent.id}\u0000${agent.userId}\u0000${filename}`;
      if (actual.files.get(key) !== content) {
        changes.writeFiles.push({ agentId: agent.id, userId: agent.userId, filename, content });
      }
    }

    const existingConfig = actual.configs.get(agent.id);
    const desiredConfig = mergeRoleplayConfig(existingConfig);
    if (!deepEqual(existingConfig ?? {}, desiredConfig)) {
      changes.writeConfigs.push({ agentId: agent.id, data: desiredConfig });
    }
  }

  return changes;
}

export function buildPlanSummary(changes) {
  return {
    createAgents: changes.createAgents.length,
    updateAgents: changes.updateAgents.length,
    writeFiles: changes.writeFiles.length,
    writeConfigs: changes.writeConfigs.length,
    errors: changes.errors.length,
  };
}

// ---------------------------------------------------------------------------
// DB drivers: sqlite3 CLI (sqlite file) or psql CLI (postgres DSN).
// Both execute the same ANSI-ish upsert SQL; sqlite and postgres both
// support `ON CONFLICT ... DO UPDATE SET ... excluded.col`.
// ---------------------------------------------------------------------------
function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function makeSqliteDriver(dbPath) {
  function run(sql) {
    const result = spawnSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8' });
    if (result.error) {
      throw new Error(`sqlite3 failed to start: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`sqlite3 exited ${result.status}: ${(result.stderr || '').trim()}`);
    }
    return result.stdout;
  }

  function queryJson(sql) {
    const stdout = run(sql);
    return JSON.parse(stdout.trim() || '[]');
  }

  return {
    kind: 'sqlite',
    readActual() {
      const agents = queryJson('SELECT id, user_id, name, config FROM agents');
      const files = queryJson('SELECT agent_id, user_id, filename, content FROM agent_files');
      const configs = queryJson(
        `SELECT scope_id, name, data FROM configs
         WHERE kind = 'setting' AND scope = 'agent' AND name = 'agents.defaults'`,
      );
      return normalizeActual({ agents, files, configs });
    },
    findOwnerUserId() {
      const rows = queryJson(
        `SELECT id FROM users WHERE role = 'super_admin' AND status = 'active' ORDER BY created_at LIMIT 1`,
      );
      if (rows.length > 0) return rows[0].id;
      const fallback = queryJson(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
      if (fallback.length > 0) return fallback[0].id;
      return null;
    },
    applyChanges(changes) {
      const statements = [];
      for (const id of changes.createAgents) {
        const agent = changes.desiredById.get(id);
        statements.push(
          `INSERT INTO agents (id, user_id, name, config, created_at, updated_at)
           VALUES (${sqlQuote(id)}, ${sqlQuote(agent.userId)}, ${sqlQuote(agent.name)}, '{}',
                   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (id) DO UPDATE SET
             user_id = excluded.user_id, name = excluded.name, updated_at = excluded.updated_at`,
        );
      }
      for (const update of changes.updateAgents) {
        statements.push(
          `UPDATE agents SET name = ${sqlQuote(update.name)}, updated_at = CURRENT_TIMESTAMP
           WHERE id = ${sqlQuote(update.id)}`,
        );
      }
      for (const file of changes.writeFiles) {
        statements.push(
          `INSERT INTO agent_files (agent_id, user_id, filename, content, updated_at)
           VALUES (${sqlQuote(file.agentId)}, ${sqlQuote(file.userId)}, ${sqlQuote(file.filename)},
                   ${sqlQuote(file.content)}, CURRENT_TIMESTAMP)
           ON CONFLICT (agent_id, user_id, filename) DO UPDATE SET
             content = excluded.content, updated_at = excluded.updated_at`,
        );
      }
      for (const config of changes.writeConfigs) {
        const id = configRowId('setting', 'agent', config.agentId, 'agents.defaults');
        statements.push(
          `INSERT INTO configs (id, kind, scope, scope_id, name, enabled, credential_key, data,
                                created_at, updated_at)
           VALUES (${sqlQuote(id)}, 'setting', 'agent', ${sqlQuote(config.agentId)},
                   'agents.defaults', 1, '', ${sqlQuote(JSON.stringify(config.data))},
                   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (id) DO UPDATE SET
             enabled = excluded.enabled, credential_key = excluded.credential_key,
             data = excluded.data, updated_at = excluded.updated_at`,
        );
      }
      if (statements.length === 0) return;
      const sql = statements.join(';\n');
      const result = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' });
      if (result.error) throw new Error(`sqlite3 failed to start: ${result.error.message}`);
      if (result.status !== 0) {
        throw new Error(`sqlite3 apply exited ${result.status}: ${(result.stderr || '').trim()}`);
      }
    },
  };
}

function makePostgresDriver(dsn) {
  function run(sql) {
    const result = spawnSync(
      'psql',
      ['-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql, dsn],
      { encoding: 'utf8' },
    );
    if (result.error) {
      throw new Error(`psql failed to start: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`psql exited ${result.status}: ${(result.stderr || '').trim()}`);
    }
    return result.stdout.trim();
  }

  function queryJson(sql) {
    const stdout = run(`SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (${sql}) t`);
    return JSON.parse(stdout || '[]');
  }

  return {
    kind: 'postgres',
    readActual() {
      const agents = queryJson('SELECT id, user_id, name, config FROM agents');
      const files = queryJson('SELECT agent_id, user_id, filename, content FROM agent_files');
      const configs = queryJson(
        `SELECT scope_id, name, data FROM configs
         WHERE kind = 'setting' AND scope = 'agent' AND name = 'agents.defaults'`,
      );
      return normalizeActual({ agents, files, configs });
    },
    findOwnerUserId() {
      const rows = queryJson(
        `SELECT id FROM users WHERE role = 'super_admin' AND status = 'active' ORDER BY created_at LIMIT 1`,
      );
      if (rows.length > 0) return rows[0].id;
      const fallback = queryJson(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
      return fallback.length > 0 ? fallback[0].id : null;
    },
    applyChanges(changes) {
      const statements = [];
      for (const id of changes.createAgents) {
        const agent = changes.desiredById.get(id);
        statements.push(
          `INSERT INTO agents (id, user_id, name, config, created_at, updated_at)
           VALUES (${sqlQuote(id)}, ${sqlQuote(agent.userId)}, ${sqlQuote(agent.name)}, '{}',
                   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (id) DO UPDATE SET
             user_id = excluded.user_id, name = excluded.name, updated_at = excluded.updated_at`,
        );
      }
      for (const update of changes.updateAgents) {
        statements.push(
          `UPDATE agents SET name = ${sqlQuote(update.name)}, updated_at = CURRENT_TIMESTAMP
           WHERE id = ${sqlQuote(update.id)}`,
        );
      }
      for (const file of changes.writeFiles) {
        statements.push(
          `INSERT INTO agent_files (agent_id, user_id, filename, content, updated_at)
           VALUES (${sqlQuote(file.agentId)}, ${sqlQuote(file.userId)}, ${sqlQuote(file.filename)},
                   ${sqlQuote(file.content)}, CURRENT_TIMESTAMP)
           ON CONFLICT (agent_id, user_id, filename) DO UPDATE SET
             content = excluded.content, updated_at = excluded.updated_at`,
        );
      }
      for (const config of changes.writeConfigs) {
        const id = configRowId('setting', 'agent', config.agentId, 'agents.defaults');
        statements.push(
          `INSERT INTO configs (id, kind, scope, scope_id, name, enabled, credential_key, data,
                                created_at, updated_at)
           VALUES (${sqlQuote(id)}, 'setting', 'agent', ${sqlQuote(config.agentId)},
                   'agents.defaults', TRUE, '', ${sqlQuote(JSON.stringify(config.data))},
                   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (id) DO UPDATE SET
             enabled = excluded.enabled, credential_key = excluded.credential_key,
             data = excluded.data, updated_at = excluded.updated_at`,
        );
      }
      if (statements.length === 0) return;
      const result = spawnSync(
        'psql',
        ['-v', 'ON_ERROR_STOP=1', '-c', statements.join(';\n'), dsn],
        { encoding: 'utf8' },
      );
      if (result.error) throw new Error(`psql failed to start: ${result.error.message}`);
      if (result.status !== 0) {
        throw new Error(`psql apply exited ${result.status}: ${(result.stderr || '').trim()}`);
      }
    },
  };
}

export function makeDriver(dbTarget) {
  if (dbTarget.startsWith('postgres://') || dbTarget.startsWith('postgresql://')) {
    return makePostgresDriver(dbTarget);
  }
  return makeSqliteDriver(dbTarget);
}

export function configRowId(kind, scope, scopeId, name) {
  const hash = crypto.createHash('sha256');
  hash.update(kind);
  hash.update('\0');
  hash.update(scope);
  hash.update('\0');
  hash.update(scopeId);
  hash.update('\0');
  hash.update(name);
  return `sc_${hash.digest('hex').slice(0, 20)}`;
}

function parseConfigData(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function normalizeActual({ agents, files, configs }) {
  const agentMap = new Map();
  for (const row of agents) {
    agentMap.set(row.id, { user_id: row.user_id, name: row.name, config: row.config });
  }
  const fileMap = new Map();
  for (const row of files) {
    fileMap.set(`${row.agent_id}\u0000${row.user_id}\u0000${row.filename}`, row.content);
  }
  const configMap = new Map();
  for (const row of configs) {
    configMap.set(row.scope_id, parseConfigData(row.data));
  }
  return { agents: agentMap, files: fileMap, configs: configMap };
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------
function loadRootEnv() {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return {};
  return parseDotEnv(fs.readFileSync(envPath, 'utf8'));
}

function resolveArgs(argv) {
  const args = { apply: false, db: null, ownerUserId: null, defaultAgentId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--db') args.db = argv[++index];
    else if (arg === '--owner-user-id') args.ownerUserId = argv[++index];
    else if (arg === '--default-agent-id') args.defaultAgentId = argv[++index];
    else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

export function resolveDbTarget(args, rootEnv) {
  if (args.db) return args.db;
  if (rootEnv.FASTCLAW_STORAGE_DSN) return rootEnv.FASTCLAW_STORAGE_DSN;
  if (process.env.FASTCLAW_STORAGE_DSN) return process.env.FASTCLAW_STORAGE_DSN;
  const home = process.env.FASTCLAW_HOME || rootEnv.FASTCLAW_HOME || path.join(process.env.HOME ?? '.', '.fastclaw');
  return path.join(home, 'fastclaw.db');
}

export async function main(argv = process.argv.slice(2)) {
  const args = resolveArgs(argv);
  if (args.help) {
    process.stdout.write(
      [
        'usage: node scripts/provision-roleplay-agents.mjs [--apply] [--db <path|dsn>]',
        '       [--owner-user-id <id>] [--default-agent-id <id>]',
        '',
        '  default      dry-run: print the diff, write nothing, exit 0',
        '  --apply      apply the diff (idempotent; second run prints no changes)',
        '  --db         sqlite file path or postgres DSN (default: FASTCLAW_STORAGE_DSN',
        '               or ~/.fastclaw/fastclaw.db)',
        '  --owner-user-id  FastClaw user id owning the role agents (default:',
        '               super_admin / first user)',
        '  --default-agent-id  legacy default agent id to guard (default: FASTCLAW_AGENT_ID)',
        '',
      ].join('\n'),
    );
    return 0;
  }

  const rootEnv = loadRootEnv();
  const dbTarget = resolveDbTarget(args, rootEnv);
  const ownerUserId = args.ownerUserId || process.env.FASTCLAW_OWNER_USER_ID || rootEnv.FASTCLAW_OWNER_USER_ID;
  const defaultAgentId =
    args.defaultAgentId || process.env.FASTCLAW_AGENT_ID || rootEnv.FASTCLAW_AGENT_ID || '';

  const seedCharacters = loadSeedCharacters();
  assertFrozenSlugs(seedCharacters);

  const driver = makeDriver(dbTarget);
  const actual = driver.readActual();
  const resolvedOwner = ownerUserId || driver.findOwnerUserId();
  if (!resolvedOwner) {
    throw new Error(
      'could not resolve a FastClaw owner user: pass --owner-user-id or FASTCLAW_OWNER_USER_ID',
    );
  }
  const desiredAgents = buildDesiredAgents(seedCharacters, resolvedOwner);
  const changes = buildPlan(desiredAgents, actual);

  // Guard (Spec §9.1): the legacy default agent must stay non-roleplay.
  let defaultAgentGuard = null;
  if (defaultAgentId) {
    if (ROLE_AGENT_SLUGS.includes(defaultAgentId)) {
      defaultAgentGuard = {
        ok: false,
        message: `default agent ${defaultAgentId} is a roleplay slug; legacy default must stay non-roleplay`,
      };
    } else {
      const existingConfig = actual.configs.get(defaultAgentId) ?? {};
      if (existingConfig.roleplay === true) {
        defaultAgentGuard = {
          ok: false,
          message: `default agent ${defaultAgentId} has roleplay=true; provisioning must not overwrite the legacy default agent`,
        };
      }
    }
  }

  const summary = buildPlanSummary(changes);
  const mode = args.apply ? 'apply' : 'dry-run';

  process.stdout.write(
    `[provision] mode=${mode} db=${dbTarget} owner=${resolvedOwner} roleAgents=${desiredAgents.length}\n`,
  );
  if (summary.errors > 0) {
    for (const error of changes.errors) process.stdout.write(`[provision] ERROR ${error}\n`);
    process.exitCode = 1;
    return 1;
  }
  if (defaultAgentGuard && !defaultAgentGuard.ok) {
    process.stdout.write(`[provision] ERROR ${defaultAgentGuard.message}\n`);
    process.exitCode = 1;
    return 1;
  }

  for (const id of changes.createAgents) {
    process.stdout.write(`[provision] ${mode === 'apply' ? 'created' : 'would create'} agent ${id}\n`);
  }
  for (const update of changes.updateAgents) {
    process.stdout.write(
      `[provision] ${mode === 'apply' ? 'renamed' : 'would rename'} agent ${update.id} -> ${update.name}\n`,
    );
  }
  for (const file of changes.writeFiles) {
    process.stdout.write(
      `[provision] ${mode === 'apply' ? 'wrote' : 'would write'} ${file.filename} for ${file.agentId} (owner row)\n`,
    );
  }
  for (const config of changes.writeConfigs) {
    process.stdout.write(
      `[provision] ${mode === 'apply' ? 'wrote' : 'would write'} agents.defaults for ${config.agentId}\n`,
    );
  }

  if (summary.createAgents + summary.updateAgents + summary.writeFiles + summary.writeConfigs === 0) {
    process.stdout.write('[provision] no changes (diff is empty)\n');
  } else if (!args.apply) {
    process.stdout.write(
      `[provision] dry-run: ${summary.createAgents} create, ${summary.updateAgents} update, ` +
        `${summary.writeFiles} files, ${summary.writeConfigs} configs; re-run with --apply\n`,
    );
  } else {
    changes.desiredById = new Map(desiredAgents.map((agent) => [agent.id, agent]));
    driver.applyChanges(changes);
    process.stdout.write(
      `[provision] applied: ${summary.createAgents} create, ${summary.updateAgents} update, ` +
        `${summary.writeFiles} files, ${summary.writeConfigs} configs\n`,
    );
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[provision] ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
