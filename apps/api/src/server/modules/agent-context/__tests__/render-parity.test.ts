import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { seedCharacters } from '../../../seed/story-data.js';
import {
  ROLE_SYSTEM_FILES,
  USER_MD_TEMPLATE,
  hashRoleFiles,
  renderRoleFiles,
  renderPublishedAgentContext,
} from '../render.js';

/**
 * Byte parity with the provisioning renderer.
 *
 * `scripts/provision-roleplay-agents.mjs` still owns the deploy-time path that writes the owner rows
 * of a freshly provisioned FastClaw agent, while publishing now regenerates the same three files from
 * the published PG version. If the two renderers ever disagreed, a publish would silently change the
 * persona the agent runs with, so this test renders the same characters through BOTH implementations
 * and compares the bytes (not a normalized form).
 */
const provisionScript = path.resolve(process.cwd(), '../../scripts/provision-roleplay-agents.mjs');

async function loadProvisioning() {
  return import(/* @vite-ignore */ provisionScript) as Promise<{
    renderRoleFiles: (character: unknown) => Record<string, string>;
    USER_MD_TEMPLATE: string;
    ROLE_SYSTEM_FILES: readonly string[];
  }>;
}

describe('base context renderer', () => {
  it('renders the same bytes as the provisioning script for every seeded character', async () => {
    const provisioning = await loadProvisioning();
    expect(seedCharacters.length).toBeGreaterThan(0);
    for (const character of seedCharacters) {
      const published = renderRoleFiles(character);
      const provisioned = provisioning.renderRoleFiles(character);
      expect(Object.keys(provisioned)).toEqual([...ROLE_SYSTEM_FILES]);
      for (const name of ROLE_SYSTEM_FILES) {
        expect(published[name], `${character.name} ${name}`).toBe(provisioned[name]);
      }
    }
  });

  it('renders the same bytes as the provisioning script for a published read model', async () => {
    const provisioning = await loadProvisioning();
    // The shape `buildDesiredAgentsFromPublished` consumes: the payload stored in `content_versions`.
    const payload = {
      name: '顾青梧',
      avatarUrl: 'https://cdn.example.test/a.png',
      identity: '冷面刀客',
      description: '简介',
      scriptId: null,
      initialRelationship: '初识',
      agentId: 'role-qingwu',
      sortOrder: 3,
      starterQuestions: { script: [], free: [] },
      prompt: {
        systemPrompt: '你是顾青梧，一柄不肯入鞘的刀。',
        personalityPrompt: '寡言，护短。',
        scenarioPrompt: '边城雪夜。',
        safetyPrompt: '不写露骨内容。',
        outputFormatPrompt: '一到两段。',
      },
    };
    const published = renderRoleFiles(payload);
    const provisioned = provisioning.renderRoleFiles(payload);
    for (const name of ROLE_SYSTEM_FILES) expect(published[name], name).toBe(provisioned[name]);
  });

  it('shares the empty user profile template with provisioning', async () => {
    const provisioning = await loadProvisioning();
    expect(USER_MD_TEMPLATE).toBe(provisioning.USER_MD_TEMPLATE);
    expect(provisioning.ROLE_SYSTEM_FILES).toEqual([...ROLE_SYSTEM_FILES]);
  });

  it('keeps the persona values verbatim, including untrimmed whitespace', () => {
    const files = renderRoleFiles({
      name: '  spaced name  ',
      identity: ' identity ',
      initialRelationship: '',
      prompt: { systemPrompt: 'line one\nline two\n', personalityPrompt: '  p  ' },
    });
    expect(files['SOUL.md']).toContain('line one\nline two\n');
    expect(files['SOUL.md']).toContain('## 人格\n  p  \n');
    expect(files['IDENTITY.md']).toContain('## 名字\n  spaced name  \n');
    // Omitted optional fields render as empty sections, exactly like provisioning.
    expect(files['SOUL.md']).toContain('## 剧情\n\n');
  });

  it('hashes deterministically and changes on any byte difference', () => {
    const base = renderRoleFiles({ name: 'A', identity: 'B', initialRelationship: 'C', prompt: { systemPrompt: 'S' } });
    const same = renderRoleFiles({ name: 'A', identity: 'B', initialRelationship: 'C', prompt: { systemPrompt: 'S' } });
    const changed = renderRoleFiles({ name: 'A', identity: 'B', initialRelationship: 'C', prompt: { systemPrompt: 'S ' } });
    expect(hashRoleFiles(base)).toBe(hashRoleFiles(same));
    expect(hashRoleFiles(base)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRoleFiles(base)).not.toBe(hashRoleFiles(changed));
  });

  it('refuses a payload that cannot carry a persona instead of fabricating one', () => {
    expect(() => renderPublishedAgentContext({ name: '空', prompt: { systemPrompt: '' } })).toThrow();
    expect(() => renderPublishedAgentContext({})).toThrow();
    expect(() => renderPublishedAgentContext(null)).toThrow();
  });

  it('reports the three files, their hashes and their character counts', () => {
    const rendered = renderPublishedAgentContext({
      name: '白藏',
      identity: '狐神',
      initialRelationship: '新娘候选',
      prompt: { systemPrompt: '人设', personalityPrompt: '人格', scenarioPrompt: '剧情', safetyPrompt: '安全', outputFormatPrompt: '风格' },
    });
    expect(Object.keys(rendered.files)).toEqual([...ROLE_SYSTEM_FILES]);
    expect(Object.keys(rendered.fileHashes)).toEqual([...ROLE_SYSTEM_FILES]);
    expect(rendered.counts['SOUL.md']).toBe(rendered.files['SOUL.md'].length);
    expect(rendered.contentHash).toBe(hashRoleFiles(rendered.files));
  });
});
