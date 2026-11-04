import { describe, expect, it } from 'vitest';
import { HttpError, jsonError } from '../../../http/errors.js';
import {
  ContentValidationError,
  validateCharacterDraft,
  validateScriptDraft,
} from '../validation.js';

const prompt = {
  systemPrompt: '核心人设',
  personalityPrompt: '人格',
  scenarioPrompt: '场景',
  safetyPrompt: '安全',
  outputFormatPrompt: '输出格式',
};

describe('content draft validation', () => {
  it('accepts a script draft and normalizes slug', () => {
    expect(validateScriptDraft({
      title: '月见庭院', description: '简介', worldSetting: '世界观', slug: 'Moon-Garden', genre: '悬疑',
    })).toMatchObject({ slug: 'moon-garden', searchKeywords: '', sortOrder: 0 });
  });

  it('rejects invalid script slug with a field path', () => {
    expect(() => validateScriptDraft({ title: 'x', description: 'x', worldSetting: 'x', slug: '中文', genre: 'x' }))
      .toThrow(ContentValidationError);
    try { validateScriptDraft({ title: 'x', description: 'x', worldSetting: 'x', slug: '中文', genre: 'x' }); } catch (error) {
      expect((error as ContentValidationError).issues).toEqual(expect.arrayContaining([
        { path: 'slug', message: 'must contain lowercase letters, digits and hyphens only' },
      ]));
    }
  });

  it('maps service-level validation to a stable 400 response with field paths', async () => {
    let thrown: unknown;
    try {
      validateScriptDraft({
        title: '   ',
        description: 'x',
        worldSetting: 'x',
        slug: 'bad slug',
        genre: 'x',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ContentValidationError);
    expect(thrown).toBeInstanceOf(HttpError);
    const response = jsonError(thrown);
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('title');
    expect(body.error).toContain('slug');
  });

  it('requires every runtime prompt field and stable agent id', () => {
    expect(() => validateCharacterDraft({
      name: '角色', avatarUrl: 'https://cdn/avatar.png', identity: '身份', description: '简介',
      initialRelationship: '陌生', agentId: 'default', starterQuestions: { script: [], free: [] }, prompt,
    })).toThrow(ContentValidationError);
  });

  it('disallows script starter questions for a free-only character', () => {
    expect(() => validateCharacterDraft({
      name: '角色', avatarUrl: 'https://cdn/avatar.png', identity: '身份', description: '简介',
      initialRelationship: '陌生', agentId: 'role-new-character', starterQuestions: { script: ['开场'], free: [] }, prompt,
    })).toThrow(/Content validation failed/);
  });

  it('accepts a scripted character and preserves mode question lists', () => {
    const result = validateCharacterDraft({
      name: '角色', avatarUrl: 'https://cdn/avatar.png', identity: '身份', description: '简介', scriptId: '00000000-0000-0000-0000-000000000001',
      initialRelationship: '陌生', agentId: 'role-new-character', starterQuestions: { script: ['开场'], free: ['你好'] }, prompt,
    });
    expect(result.starterQuestions).toEqual({ script: ['开场'], free: ['你好'] });
  });
});
