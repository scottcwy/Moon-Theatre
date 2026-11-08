import { describe, expect, it } from 'vitest';
import { buildCharacterEditPatch, characterEditValues, type CharacterEditValues } from '../character-patch.js';

const PERSONA = {
  systemPrompt: 'S', personalityPrompt: 'P', scenarioPrompt: 'C', safetyPrompt: 'F', outputFormatPrompt: 'O',
};

function values(overrides: Partial<CharacterEditValues> = {}): CharacterEditValues {
  return {
    name: '顾青梧',
    avatarUrl: 'https://cdn.example.test/a.png',
    identity: '冷面刀客',
    description: '简介',
    initialRelationship: '初识',
    sortOrder: '7',
    questionsScript: '',
    questionsFree: '今日天气如何？',
    agentId: '',
    persona: PERSONA,
    ...overrides,
  };
}

const AGENTS = ['role-baizang', 'role-qingwu', 'role-yisa'] as const;

describe('S1 repair: one-time agent assignment for a legacy character', () => {
  it('sends the chosen agent id when the stored character has none', () => {
    const initial = values();
    const form = { ...initial, agentId: 'role-yisa' };
    const result = buildCharacterEditPatch({ form, initial, storedAgentId: null, agentOptions: AGENTS });
    expect(result.issues).toEqual({});
    expect(result.patch).toEqual({ agentId: 'role-yisa' });
  });

  it('keeps sending the stored agent id on a later save, so a second save cannot drop it', () => {
    const initial = values({ agentId: 'role-yisa' });
    const form = { ...initial, name: '顾青梧·改' };
    const result = buildCharacterEditPatch({ form, initial, storedAgentId: null, agentOptions: AGENTS });
    expect(result.issues).toEqual({});
    expect(result.patch).toEqual({ name: '顾青梧·改', agentId: 'role-yisa' });
  });

  it('asks for a selection instead of sending an empty agent id the server would reject', () => {
    const initial = values();
    const result = buildCharacterEditPatch({ form: initial, initial, storedAgentId: null, agentOptions: AGENTS });
    expect(result.patch).toEqual({});
    expect(result.issues.agentId).toContain('Agent');
  });

  it('refuses an agent id outside the published roleplay contract', () => {
    const initial = values();
    const form = { ...initial, agentId: 'role-invented' };
    const result = buildCharacterEditPatch({ form, initial, storedAgentId: null, agentOptions: AGENTS });
    expect(result.patch).toEqual({});
    expect(result.issues.agentId).toContain('Agent');
  });

  it('never sends an agent id for a character that already has one', () => {
    const initial = values({ agentId: 'role-qingwu' });
    const form = { ...initial, agentId: 'role-yisa', name: '顾青梧·改' };
    const result = buildCharacterEditPatch({ form, initial, storedAgentId: 'role-qingwu', agentOptions: AGENTS });
    expect(result.patch).toEqual({ name: '顾青梧·改' });
    expect(result.patch).not.toHaveProperty('agentId');
    expect(result.issues).toEqual({});
  });
});

describe('edit patch construction', () => {
  it('sends nothing when nothing changed', () => {
    const initial = values({ agentId: 'role-qingwu' });
    expect(buildCharacterEditPatch({ form: initial, initial, storedAgentId: 'role-qingwu', agentOptions: AGENTS }))
      .toEqual({ patch: {}, issues: {} });
  });

  it('sends only the changed display fields, the parsed starter questions and the persona block', () => {
    const initial = values({ agentId: 'role-qingwu' });
    const form = {
      ...initial,
      identity: '新身份',
      questionsScript: ' 第一问 \n\n第二问 ',
      persona: { ...PERSONA, safetyPrompt: '新约束' },
    };
    const result = buildCharacterEditPatch({ form, initial, storedAgentId: 'role-qingwu', agentOptions: AGENTS });
    expect(result.patch).toEqual({
      identity: '新身份',
      starterQuestions: { script: ['第一问', '第二问'], free: ['今日天气如何？'] },
      prompt: { ...PERSONA, safetyPrompt: '新约束' },
    });
    expect(result.issues).toEqual({});
  });

  it('reports an unusable sortOrder as a field issue instead of sending it', () => {
    const initial = values({ agentId: 'role-qingwu' });
    const form = { ...initial, sortOrder: '1.5' };
    const result = buildCharacterEditPatch({ form, initial, storedAgentId: 'role-qingwu', agentOptions: AGENTS });
    expect(result.patch).toEqual({});
    expect(result.issues.sortOrder).toContain('排序');
  });
});

describe('characterEditValues', () => {
  it('prefills the agent selector from the stored id, else from the stored payload', () => {
    const base = {
      name: '顾青梧', avatarUrl: 'a', identity: 'b', description: 'c', initialRelationship: 'd',
      sortOrder: 7, starterQuestions: { script: ['s1'], free: ['f1'] }, prompt: PERSONA,
    };
    expect(characterEditValues({ ...base, agentId: 'role-qingwu' }, 'role-qingwu').agentId).toBe('role-qingwu');
    // agent_id IS NULL: the draft's own value is what the operator saw last, so it is preselected.
    expect(characterEditValues({ ...base, agentId: 'role-yisa' }, null).agentId).toBe('role-yisa');
    expect(characterEditValues({ ...base, agentId: '' }, null).agentId).toBe('');
    expect(characterEditValues({ ...base, agentId: 'role-qingwu' }, 'role-qingwu').questionsScript).toBe('s1');
  });
});
