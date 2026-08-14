import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '../../fastclaw/adapter.js';
import { fallbackReturnMessageTemplates, returnMessageTemplates } from '../../../seed/return-message-templates.js';
import {
  generateReturnMessageContent,
  RETURN_MESSAGE_MAX_LENGTH,
  RETURN_MESSAGE_TIMEOUT_MS,
} from '../generator.js';

const { mockStreamChat } = vi.hoisted(() => ({ mockStreamChat: vi.fn() }));

vi.mock('../../fastclaw/adapter.js', () => ({
  streamChat: mockStreamChat,
}));

const character = {
  characterName: '白藏',
  systemPrompt: '你是白藏，月见庭院的狐神。',
  personalityPrompt: '白藏会认真回应用户的情绪。',
  agentId: 'role-baizang',
  userId: 'user-1',
};

function mockStream(events: StreamEvent[]): void {
  mockStreamChat.mockImplementation(async function* () {
    for (const event of events) {
      yield event;
    }
  });
}

beforeEach(() => {
  mockStreamChat.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('generateReturnMessageContent', () => {
  it('非流式收集 delta 并在 done 后返回拼接文本', async () => {
    mockStream([
      { type: 'delta', content: '小新娘，' },
      { type: 'delta', content: '月色已满。' },
      { type: 'done', fallback: false },
    ]);

    const content = await generateReturnMessageContent(character);

    expect(content).toBe('小新娘，月色已满。');
  });

  it('prompt 包含角色 systemPrompt/personalityPrompt 与固定指令关键词，并传短超时', async () => {
    mockStream([{ type: 'done', fallback: false }]);

    await generateReturnMessageContent(character);

    expect(mockStreamChat).toHaveBeenCalledTimes(1);
    const [systemPrompt, userMessage, options] = mockStreamChat.mock.calls[0]!;
    expect(systemPrompt).toContain(character.systemPrompt);
    expect(systemPrompt).toContain(character.personalityPrompt);
    expect(userMessage).toContain('回访');
    expect(userMessage).toMatch(/惦记|邀请/);
    expect(options).toEqual({ timeoutMs: RETURN_MESSAGE_TIMEOUT_MS });
  });

  it('角色 Agent 架构（USE_ROLEPLAY_AGENTS=true）不再直拼角色 prompt，并传 agentId/userId/scope=free/noPersist', async () => {
    vi.resetModules();
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');
    mockStream([{ type: 'done', fallback: false }]);

    const { generateReturnMessageContent: roleplayGenerate } = await import('../generator.js');
    await roleplayGenerate(character);

    expect(mockStreamChat).toHaveBeenCalledTimes(1);
    const [systemPrompt, userMessage, options] = mockStreamChat.mock.calls[0]!;
    expect(systemPrompt).not.toContain(character.systemPrompt);
    expect(systemPrompt).not.toContain(character.personalityPrompt);
    expect(userMessage).toContain('回访');
    expect(options).toEqual({
      timeoutMs: RETURN_MESSAGE_TIMEOUT_MS,
      agentId: 'role-baizang',
      userId: 'user-1',
      scope: 'free',
      noPersist: true,
    });
    vi.unstubAllEnvs();
  });

  it('角色 Agent 架构下 agentId 缺失时抛错（fail-closed），不调用 streamChat', async () => {
    vi.resetModules();
    vi.stubEnv('USE_ROLEPLAY_AGENTS', 'true');

    const { generateReturnMessageContent: roleplayGenerate } = await import('../generator.js');

    await expect(roleplayGenerate({ ...character, agentId: null })).rejects.toThrow(/agentId/i);
    expect(mockStreamChat).not.toHaveBeenCalled();
  });

  it('非开关模式下 agentId 缺失不影响旧路径（仍直拼角色 prompt 生成）', async () => {
    mockStream([
      { type: 'delta', content: '回来吧。' },
      { type: 'done', fallback: false },
    ]);

    const content = await generateReturnMessageContent({ ...character, agentId: null });

    expect(content).toBe('回来吧。');
    expect(mockStreamChat).toHaveBeenCalledTimes(1);
  });

  it('超过 200 字符时按码点截断到 200，不切坏代理对', async () => {
    const longText = '😀'.repeat(250);
    mockStream([
      { type: 'delta', content: longText },
      { type: 'done', fallback: false },
    ]);

    const content = await generateReturnMessageContent(character);

    expect(Array.from(content)).toHaveLength(RETURN_MESSAGE_MAX_LENGTH);
    expect(content).toBe(Array.from(longText).slice(0, RETURN_MESSAGE_MAX_LENGTH).join(''));
  });

  it('收到 error 事件时返回该角色模板（非空）', async () => {
    mockStream([{ type: 'error', code: 'timeout', message: 'timed out' }]);

    const content = await generateReturnMessageContent(character);

    expect(content).toBe(returnMessageTemplates[character.characterName]?.[0]);
    expect(content.length).toBeGreaterThan(0);
  });

  it('adapter 兜底流（done fallback: true）视为失败并返回该角色模板，而非收集文本', async () => {
    mockStream([
      { type: 'delta', content: '[情绪: 平静] 最近过得怎么样？' },
      { type: 'done', fallback: true },
    ]);

    const content = await generateReturnMessageContent(character);

    expect(content).toBe(returnMessageTemplates[character.characterName]?.[0]);
    expect(content).not.toContain('[情绪');
  });

  it('只产出 done 无 delta 时返回该角色模板', async () => {
    mockStream([{ type: 'done', fallback: false }]);

    const content = await generateReturnMessageContent(character);

    expect(content).toBe(returnMessageTemplates[character.characterName]?.[0]);
    expect(content.length).toBeGreaterThan(0);
  });

  it('流被 abort（AbortError）时不抛错并返回该角色模板', async () => {
    mockStreamChat.mockImplementation(async function* () {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });

    const content = await generateReturnMessageContent(character);

    expect(content).toBe(returnMessageTemplates[character.characterName]?.[0]);
  });

  it('无角色模板时使用通用兜底模板', async () => {
    mockStream([{ type: 'error', code: 'unknown', message: 'boom' }]);

    const content = await generateReturnMessageContent({ ...character, characterName: '不存在的角色' });

    expect(content).toBe(fallbackReturnMessageTemplates[0]);
    expect(content.length).toBeGreaterThan(0);
  });

  it('对生成文本做 trim 且结果非空', async () => {
    mockStream([
      { type: 'delta', content: '  ' },
      { type: 'delta', content: '回来吧。  ' },
      { type: 'done', fallback: false },
    ]);

    const content = await generateReturnMessageContent(character);

    expect(content).toBe('回来吧。');
  });
});
