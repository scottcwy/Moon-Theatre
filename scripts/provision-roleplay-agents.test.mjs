import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ROLE_AGENT_BY_NAME,
  ROLE_AGENT_SLUGS,
  ROLE_SYSTEM_FILES,
  ROLEPLAY_AGENT_CONFIG,
  USER_MD_TEMPLATE,
  buildDesiredAgents,
  buildPlan,
  buildPlanSummary,
  configRowId,
  deepEqual,
  loadSeedCharacters,
  mergeRoleplayConfig,
  renderRoleFiles,
} from './provision-roleplay-agents.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/provision-roleplay-agents.mjs');

const FROZEN_SLUGS = [
  'role-baizang', 'role-hemaoqingxuan', 'role-yuedaoling', 'role-jiuyuan',
  'role-chengyuhuai', 'role-jiangbojia', 'role-chengzouliu', 'role-miaohongmo',
  'role-dailila', 'role-yisa', 'role-qiangqingci', 'role-aoding', 'role-aqi',
  'role-nanchuang', 'role-fuxiao', 'role-cenyilan', 'role-jicanghai',
  'role-zhihe', 'role-yeshangqiu',
];

const FROZEN_NAMES = [
  '白藏', '贺茂清玄', '月岛澪', '久远', '程聿怀', '蒋伯驾', '程走柳', '缪宏谟',
  '黛利拉', '以撒', '羌青瓷', '奥丁', '阿奇', '南窗', '赋霄', '岑奕岚',
  '季沧海', '知何', '叶上秋',
];

function runScript(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], { cwd: repoRoot, encoding: 'utf8' });
}

function sqliteJson(dbPath, sql) {
  const result = spawnSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8' });
  assert.equal(result.status, 0, `sqlite3 failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim() || '[]');
}

function sqliteExec(dbPath, sql) {
  const result = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' });
  assert.equal(result.status, 0, `sqlite3 write failed: ${result.stderr}`);
}

const FIXTURE_SCHEMA = `
CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE agents (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE agent_files (
  agent_id TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '', updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id, user_id, filename)
);
CREATE TABLE configs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, scope TEXT NOT NULL,
  scope_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT 1, credential_key TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, scope, scope_id, name)
);
INSERT INTO users (id, username, email, password_hash, role, status)
  VALUES ('u_test_owner', 'owner', 'owner@test.local', 'x', 'super_admin', 'active');
`;

function makeFixtureDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-provision-'));
  const dbPath = path.join(dir, 'fastclaw.db');
  sqliteExec(dbPath, FIXTURE_SCHEMA);
  return { dir, dbPath };
}

describe('provision-roleplay-agents frozen contract', () => {
  it('exports exactly the frozen 19 slugs in order', () => {
    assert.deepEqual(ROLE_AGENT_SLUGS, FROZEN_SLUGS);
    assert.equal(ROLE_AGENT_SLUGS.length, 19);
    assert.equal(new Set(ROLE_AGENT_SLUGS).size, 19, 'slugs must be unique');
    for (const slug of ROLE_AGENT_SLUGS) {
      assert.match(slug, /^role-[a-z]+$/, `slug must be role-<latin>: ${slug}`);
    }
  });

  it('maps every frozen character name to its frozen slug', () => {
    assert.deepEqual(Object.keys(ROLE_AGENT_BY_NAME), FROZEN_NAMES);
    for (const name of FROZEN_NAMES) {
      assert.ok(ROLE_AGENT_BY_NAME[name], `missing slug for ${name}`);
    }
    assert.deepEqual(Object.values(ROLE_AGENT_BY_NAME), FROZEN_SLUGS);
  });
});

describe('provision-roleplay-agents seed + rendering', () => {
  it('loads exactly 19 seed characters covering the frozen names', () => {
    const characters = loadSeedCharacters();
    assert.equal(characters.length, 19);
    assert.deepEqual(characters.map((character) => character.name), FROZEN_NAMES);
    for (const character of characters) {
      assert.equal(typeof character.prompt.systemPrompt, 'string');
      assert.equal(typeof character.prompt.personalityPrompt, 'string');
      assert.equal(typeof character.prompt.scenarioPrompt, 'string');
      assert.equal(typeof character.prompt.safetyPrompt, 'string');
      assert.equal(typeof character.prompt.outputFormatPrompt, 'string');
    }
  });

  it('renders SOUL/IDENTITY/USER per Spec §7', () => {
    const characters = loadSeedCharacters();
    const baizang = characters.find((character) => character.name === '白藏');
    const files = renderRoleFiles(baizang);
    assert.deepEqual(Object.keys(files).sort(), [...ROLE_SYSTEM_FILES].sort());

    const soul = files['SOUL.md'];
    assert.match(soul, /# Soul/);
    assert.match(soul, /## 核心人设/);
    assert.ok(soul.includes(baizang.prompt.systemPrompt), 'SOUL must embed systemPrompt');
    assert.ok(soul.includes(baizang.prompt.personalityPrompt), 'SOUL must embed personalityPrompt');
    assert.ok(soul.includes(baizang.prompt.scenarioPrompt), 'SOUL must embed scenarioPrompt');
    assert.ok(soul.includes(baizang.prompt.safetyPrompt), 'SOUL must embed safetyPrompt');
    assert.ok(soul.includes(baizang.prompt.outputFormatPrompt), 'SOUL must embed outputFormatPrompt');

    const identity = files['IDENTITY.md'];
    assert.match(identity, /# Identity/);
    assert.ok(identity.includes('白藏'));
    assert.ok(identity.includes(baizang.identity));
    assert.ok(identity.includes(baizang.initialRelationship));

    assert.equal(files['USER.md'], USER_MD_TEMPLATE);
  });

  it('builds desired state for 19 agents with owner rows', () => {
    const characters = loadSeedCharacters();
    const desired = buildDesiredAgents(characters, 'u_test_owner');
    assert.equal(desired.length, 19);
    for (const agent of desired) {
      assert.equal(agent.userId, 'u_test_owner');
      assert.deepEqual(Object.keys(agent.files).sort(), [...ROLE_SYSTEM_FILES].sort());
    }
  });

  it('keeps ready route slug list identical (single source of truth test)', () => {
    const routeSource = fs.readFileSync(
      path.join(repoRoot, 'apps/api/src/app/api/ready/route.ts'),
      'utf8',
    );
    const match = routeSource.match(/const ROLE_AGENT_SLUGS = \[([\s\S]*?)\];/);
    assert.ok(match, 'route.ts must export ROLE_AGENT_SLUGS array');
    const routeSlugs = [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
    assert.deepEqual(routeSlugs, ROLE_AGENT_SLUGS);
  });
});

describe('provision-roleplay-agents plan + merge', () => {
  it('plans creation for an empty FastClaw DB', () => {
    const characters = loadSeedCharacters();
    const desired = buildDesiredAgents(characters, 'u_test_owner');
    const plan = buildPlan(desired, { agents: new Map(), files: new Map(), configs: new Map() });
    assert.deepEqual(buildPlanSummary(plan), {
      createAgents: 19,
      updateAgents: 0,
      writeFiles: 57,
      writeConfigs: 19,
      errors: 0,
    });
  });

  it('produces an empty diff when desired state already matches', () => {
    const characters = loadSeedCharacters();
    const desired = buildDesiredAgents(characters, 'u_test_owner');
    const actual = {
      agents: new Map(desired.map((agent) => [agent.id, { user_id: agent.userId, name: agent.name }])),
      files: new Map(
        desired.flatMap((agent) =>
          Object.entries(agent.files).map(([filename, content]) => [
            `${agent.id}\u0000${agent.userId}\u0000${filename}`,
            content,
          ]),
        ),
      ),
      configs: new Map(desired.map((agent) => [agent.id, { ...ROLEPLAY_AGENT_CONFIG }])),
    };
    const plan = buildPlan(desired, actual);
    assert.deepEqual(buildPlanSummary(plan), {
      createAgents: 0,
      updateAgents: 0,
      writeFiles: 0,
      writeConfigs: 0,
      errors: 0,
    });
  });

  it('refuses to steal an agent owned by another user', () => {
    const characters = loadSeedCharacters();
    const desired = buildDesiredAgents(characters, 'u_test_owner');
    const actual = {
      agents: new Map([[desired[0].id, { user_id: 'u_someone_else', name: desired[0].name }]]),
      files: new Map(),
      configs: new Map(),
    };
    const plan = buildPlan(desired, actual);
    assert.equal(buildPlanSummary(plan).errors, 1);
  });

  it('merge preserves model/maxTokens/temperature (Spec §8 不动)', () => {
    const existing = { model: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', maxTokens: 768, temperature: 0.7 };
    const merged = mergeRoleplayConfig(existing);
    assert.equal(merged.model, existing.model);
    assert.equal(merged.maxTokens, existing.maxTokens);
    assert.equal(merged.temperature, existing.temperature);
    assert.equal(merged.roleplay, true);
    assert.equal(merged.thinking, 'off');
    assert.equal(merged.maxToolIterations, 0);
    assert.deepEqual(merged.memory, { autoPersist: { enabled: true, everyNTurns: 5 } });
  });

  it('configRowId matches FastClaw store deterministic id scheme', () => {
    const id = configRowId('setting', 'agent', 'role-baizang', 'agents.defaults');
    assert.match(id, /^sc_[0-9a-f]{20}$/);
    assert.equal(configRowId('setting', 'agent', 'role-baizang', 'agents.defaults'), id);
  });

  it('deepEqual handles nested objects and reordered keys', () => {
    assert.equal(deepEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 }), true);
    assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
    assert.equal(deepEqual([1, 2], [1, 2]), true);
    assert.equal(deepEqual([1, 2], [2, 1]), false);
  });
});

const hasSqlite3 = spawnSync('sqlite3', ['--version']).status === 0;

test('provision-roleplay-agents sqlite dry-run + apply idempotence', { skip: !hasSqlite3 && 'sqlite3 CLI unavailable' }, () => {
  const { dir, dbPath } = makeFixtureDb();
  try {
    // Dry-run on empty DB: exit 0, prints the diff, writes nothing.
    const dryRun = runScript(['--db', dbPath, '--owner-user-id', 'u_test_owner']);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /would create agent role-baizang/);
    assert.match(dryRun.stdout, /would write SOUL\.md for role-baizang/);
    assert.equal(sqliteJson(dbPath, 'SELECT COUNT(*) AS count FROM agents')[0].count, 0);

    // Apply: exit 0, creates agents/files/configs.
    const apply = runScript(['--db', dbPath, '--owner-user-id', 'u_test_owner', '--apply']);
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(apply.stdout, /created agent role-baizang/);
    assert.match(apply.stdout, /wrote SOUL\.md for role-baizang/);

    assert.equal(sqliteJson(dbPath, 'SELECT COUNT(*) AS count FROM agents')[0].count, 19);
    assert.equal(sqliteJson(dbPath, 'SELECT COUNT(*) AS count FROM agent_files')[0].count, 57);
    assert.equal(sqliteJson(dbPath, 'SELECT COUNT(*) AS count FROM configs')[0].count, 19);
    assert.equal(
      sqliteJson(dbPath, "SELECT COUNT(*) AS count FROM agent_files WHERE user_id = ''")[0].count,
      0,
      'no user_id="" template rows allowed',
    );
    assert.equal(
      sqliteJson(dbPath, "SELECT COUNT(*) AS count FROM agents WHERE user_id != 'u_test_owner'")[0].count,
      0,
      'every role agent must be owned by the provisioning owner',
    );

    const baizangConfig = sqliteJson(
      dbPath,
      "SELECT data FROM configs WHERE scope_id = 'role-baizang' AND name = 'agents.defaults'",
    )[0].data;
    assert.deepEqual(JSON.parse(baizangConfig), {
      roleplay: true,
      thinking: 'off',
      maxToolIterations: 0,
      memory: { autoPersist: { enabled: true, everyNTurns: 5 } },
    });

    const soul = sqliteJson(
      dbPath,
      "SELECT content FROM agent_files WHERE agent_id = 'role-baizang' AND user_id = 'u_test_owner' AND filename = 'SOUL.md'",
    )[0].content;
    assert.match(soul, /你是白藏/);

    // Second apply: exit 0 and the diff is empty (idempotent).
    const secondApply = runScript(['--db', dbPath, '--owner-user-id', 'u_test_owner', '--apply']);
    assert.equal(secondApply.status, 0, secondApply.stderr);
    assert.match(secondApply.stdout, /no changes \(diff is empty\)/);
    assert.equal(sqliteJson(dbPath, 'SELECT COUNT(*) AS count FROM agent_files')[0].count, 57);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('provision-roleplay-agents preserves existing model config on apply', { skip: !hasSqlite3 && 'sqlite3 CLI unavailable' }, () => {
  const { dir, dbPath } = makeFixtureDb();
  try {
    sqliteExec(
      dbPath,
      `INSERT INTO agents (id, user_id, name, config) VALUES ('role-baizang', 'u_test_owner', '白藏', '{"model":"siliconflow/deepseek-ai/DeepSeek-V4-Flash","maxTokens":768}')`,
    );
    const existingData = '{"model":"siliconflow/deepseek-ai/DeepSeek-V4-Flash","maxTokens":768,"temperature":0.7}';
    sqliteExec(
      dbPath,
      `INSERT INTO configs (id, kind, scope, scope_id, name, enabled, credential_key, data)
       VALUES ('${configRowId('setting', 'agent', 'role-baizang', 'agents.defaults')}', 'setting', 'agent',
               'role-baizang', 'agents.defaults', 1, '', '${existingData}')`,
    );

    const apply = runScript(['--db', dbPath, '--owner-user-id', 'u_test_owner', '--apply']);
    assert.equal(apply.status, 0, apply.stderr);

    const config = JSON.parse(
      sqliteJson(
        dbPath,
        "SELECT data FROM configs WHERE scope_id = 'role-baizang' AND name = 'agents.defaults'",
      )[0].data,
    );
    assert.equal(config.model, 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', 'model must not move');
    assert.equal(config.maxTokens, 768, 'maxTokens must not move');
    assert.equal(config.temperature, 0.7, 'temperature must not move');
    assert.equal(config.roleplay, true);
    assert.equal(config.thinking, 'off');
    assert.equal(config.maxToolIterations, 0);
    assert.deepEqual(config.memory, { autoPersist: { enabled: true, everyNTurns: 5 } });

    // Second run must be a no-op.
    const second = runScript(['--db', dbPath, '--owner-user-id', 'u_test_owner', '--apply']);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /no changes \(diff is empty\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('provision-roleplay-agents guards the legacy default agent', { skip: !hasSqlite3 && 'sqlite3 CLI unavailable' }, () => {
  const { dir, dbPath } = makeFixtureDb();
  try {
    // Default agent flagged roleplay=true -> hard error, nothing applied.
    const configId = configRowId('setting', 'agent', 'agt_7c8acb3dde163e04bb', 'agents.defaults');
    sqliteExec(
      dbPath,
      `INSERT INTO configs (id, kind, scope, scope_id, name, enabled, credential_key, data)
       VALUES ('${configId}', 'setting', 'agent', 'agt_7c8acb3dde163e04bb', 'agents.defaults', 1, '',
               '{"roleplay":true,"thinking":"off"}')`,
    );
    const blocked = runScript([
      '--db', dbPath, '--owner-user-id', 'u_test_owner',
      '--default-agent-id', 'agt_7c8acb3dde163e04bb', '--apply',
    ]);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr + blocked.stdout, /must not overwrite the legacy default agent/);
    assert.equal(sqliteJson(dbPath, 'SELECT COUNT(*) AS count FROM agents')[0].count, 0);

    // Default agent present without roleplay -> allowed.
    sqliteExec(
      dbPath,
      `UPDATE configs SET data = '{"maxToolIterations":20}' WHERE scope_id = 'agt_7c8acb3dde163e04bb'`,
    );
    const allowed = runScript([
      '--db', dbPath, '--owner-user-id', 'u_test_owner',
      '--default-agent-id', 'agt_7c8acb3dde163e04bb', '--apply',
    ]);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(sqliteJson(dbPath, 'SELECT COUNT(*) AS count FROM agents')[0].count, 19);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
