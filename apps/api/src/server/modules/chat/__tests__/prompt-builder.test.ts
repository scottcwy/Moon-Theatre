import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../prompt-builder.js';
import type { Script, CharacterWithPrompts } from '../service.js';

function makeCharacter(overrides: Partial<CharacterWithPrompts> = {}): CharacterWithPrompts {
  return {
    id: 'char-1',
    name: 'Test Character',
    avatarUrl: '/test.png',
    identity: 'tester',
    description: 'A test character',
    scriptId: 'script-1',
    initialRelationship: 'neutral',
    status: 'active',
    prompts: [
      {
        id: 'prompt-1',
        systemPrompt: 'You are a helpful assistant.',
        personalityPrompt: 'You are warm and friendly.',
        scenarioPrompt: 'You are in a coffee shop.',
        safetyPrompt: 'Keep conversations appropriate.',
        outputFormatPrompt: 'Use markdown formatting.',
      },
    ],
    ...overrides,
  };
}

function makeScript(overrides: Partial<Script> = {}): Script {
  return {
    id: 'script-1',
    title: 'Test Script',
    description: 'A test script',
    worldSetting: 'A mysterious world.',
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  it('builds prompt with all fields present', () => {
    const character = makeCharacter();
    const script = makeScript();

    const prompt = buildSystemPrompt(character, script);

    expect(prompt).toContain('剧本：Test Script');
    expect(prompt).toContain('A mysterious world.');
    expect(prompt).toContain('You are a helpful assistant.');
    expect(prompt).toContain('You are warm and friendly.');
    expect(prompt).toContain('You are in a coffee shop.');
    expect(prompt).toContain('Keep conversations appropriate.');
    expect(prompt).toContain('Use markdown formatting.');
  });

  it('handles null script gracefully', () => {
    const character = makeCharacter();
    const prompt = buildSystemPrompt(character, null);

    expect(prompt).not.toContain('剧本：');
    expect(prompt).toContain('You are a helpful assistant.');
  });

  it('handles missing prompt fields gracefully', () => {
    const character = makeCharacter({
      prompts: [
        {
          id: 'prompt-1',
          systemPrompt: 'Only system prompt.',
          personalityPrompt: null,
          scenarioPrompt: null,
          safetyPrompt: null,
          outputFormatPrompt: null,
        },
      ],
    });
    const script = makeScript();
    const prompt = buildSystemPrompt(character, script);

    expect(prompt).toContain('Only system prompt.');
    expect(prompt).toContain('剧本：Test Script');
  });

  it('handles null prompts array gracefully', () => {
    const character = makeCharacter({ prompts: null });
    const script = makeScript();
    const prompt = buildSystemPrompt(character, script);

    expect(prompt).toContain('剧本：Test Script');
    expect(prompt.split('\n\n').length).toBe(1);
  });

  it('sections are separated by double newlines', () => {
    const character = makeCharacter();
    const script = makeScript();
    const prompt = buildSystemPrompt(character, script);

    const sections = prompt.split('\n\n');
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });
});
