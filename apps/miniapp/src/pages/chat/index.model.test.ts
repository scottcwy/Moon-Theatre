import { describe, expect, it } from 'vitest';
import {
  applyStarterQuestion,
  createClientMessageId,
  getBondFeedback,
  getDefaultChatMode,
  getFriendlyStreamErrorMessage,
  getInitialModelTier,
  getEmptyModeScope,
  getModeLabel,
  getVisibleStarterQuestions,
  isSuccessfulDoneEvent,
  resolveCharacterScriptMetadata,
  shouldReconcileStreamError,
  shouldRenderStandaloneTypingIndicator,
} from './index.model';

describe('chat message rendering helpers', () => {
  it('starts new chats on the casual model tier for reliable first responses', () => {
    expect(getInitialModelTier()).toBe('casual');
  });

  it('creates printable bounded client message ids', () => {
    const id = createClientMessageId(1783526400000, 0.42);

    expect(id).toMatch(/^[\x20-\x7E]+$/);
    expect(id.length).toBeLessThanOrEqual(128);
    expect(id).toMatch(/^chat_/);
  });

  it('maps stream abort errors to the approved timeout message', () => {
    expect(getFriendlyStreamErrorMessage('This operation was aborted')).toBe('这次回应准备得太久了，或换个更具体的问题再试一次吧');
  });

  it('maps timeout errors to the approved timeout message', () => {
    expect(getFriendlyStreamErrorMessage('request:fail timeout')).toBe('这次回应准备得太久了，或换个更具体的问题再试一次吧');
  });

  it('maps out-of-scope errors to the approved scope message', () => {
    expect(getFriendlyStreamErrorMessage('out_of_scope')).toBe('这个问题超出了当前角色和剧情能可靠回应的范围。可以换成和角色、线索或当前剧情更相关的问题。');
  });

  it('maps stable stream error codes to Chinese product copy', () => {
    expect(getFriendlyStreamErrorMessage('upstream_incomplete')).toBe('这次回应准备得太久了，或换个更具体的问题再试一次吧');
    expect(getFriendlyStreamErrorMessage('insufficient_points')).toBe('点数不足，请先充值后继续。');
    expect(getFriendlyStreamErrorMessage('in_progress')).toBe('上一条回应还在生成，请稍后再试。');
    expect(getFriendlyStreamErrorMessage('upstream_error')).toBe('这次回应没能送达，请稍后再试。');
    expect(getFriendlyStreamErrorMessage('generation_failed')).toBe('这次回应没能送达，请稍后再试。');
    expect(getFriendlyStreamErrorMessage('unknown')).toBe('这次回应没能送达，请稍后再试。');
    expect(getFriendlyStreamErrorMessage('session_scope_mismatch')).toBe('会话模式已变化，请重新进入对应聊天。');
    expect(getFriendlyStreamErrorMessage('script_unavailable')).toBe('该剧本已下架，历史对话仍可查看。');
    expect(getFriendlyStreamErrorMessage('client_message_id_collision')).toBe('这次发送状态发生冲突，请重新发送一条新消息。');
    expect(getFriendlyStreamErrorMessage('input_blocked')).toBe('这条内容无法发送，请换一种表达后再试。');
    expect(getFriendlyStreamErrorMessage('output_filtered')).toBe('这次回复未通过安全检查，请换个问题再试。');
  });

  it('never returns raw unknown English stream messages', () => {
    expect(getFriendlyStreamErrorMessage('FastClaw responded with status 500')).toBe('这次回应没能送达，请稍后再试。');
    expect(getFriendlyStreamErrorMessage('Stream request failed')).toBe('这次回应没能送达，请稍后再试。');
  });

  it('does not render a second typing bubble when an empty assistant message already exists', () => {
    expect(
      shouldRenderStandaloneTypingIndicator(true, [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '' },
      ]),
    ).toBe(false);
  });

  it('allows a standalone typing bubble only when there is no assistant placeholder', () => {
    expect(
      shouldRenderStandaloneTypingIndicator(true, [
        { role: 'user', content: '你好' },
      ]),
    ).toBe(true);
    expect(shouldRenderStandaloneTypingIndicator(false, [{ role: 'user', content: '你好' }])).toBe(false);
  });

  it('uses the persisted last mode when available and otherwise prefers script mode', () => {
    expect(getDefaultChatMode(['script', 'free'], 'free')).toBe('free');
    expect(getDefaultChatMode(['script', 'free'], null)).toBe('script');
    expect(getDefaultChatMode(['free'], 'script')).toBe('free');
  });

  it('preserves active character script metadata when restoring a free session', () => {
    expect(resolveCharacterScriptMetadata(
      {
        scriptId: 'script-moon',
        script: { id: 'script-moon', title: '月见庭院：狐神的新娘' },
      },
      { scriptId: null, scriptTitle: null },
    )).toEqual({
      scriptId: 'script-moon',
      script: { id: 'script-moon', title: '月见庭院：狐神的新娘' },
    });
  });

  it('creates an empty script scope when the character has no script session yet', () => {
    expect(getEmptyModeScope('script', {
      scriptId: 'script-moon',
      script: { id: 'script-moon', title: '月见庭院：狐神的新娘' },
    })).toEqual({
      mode: 'script',
      scriptId: 'script-moon',
      scriptTitle: '月见庭院：狐神的新娘',
    });
  });

  it('maps internal chat modes to the frozen Chinese labels', () => {
    expect(getModeLabel('script')).toBe('剧本模式');
    expect(getModeLabel('free')).toBe('自由聊天');
  });

  it('shows at most three starter questions only before a successful turn', () => {
    const questions = { script: ['一', '二', '三', '四'], free: ['甲'] };
    expect(getVisibleStarterQuestions(questions, 'script', false)).toEqual(['一', '二', '三']);
    expect(getVisibleStarterQuestions(questions, 'free', true)).toEqual([]);
  });

  it('fills an empty input from a starter question without overwriting typed text', () => {
    expect(applyStarterQuestion('', '你是谁？')).toEqual({ applied: true, value: '你是谁？' });
    expect(applyStarterQuestion('我已经在写', '你是谁？')).toEqual({ applied: false, value: '我已经在写' });
  });

  it('only treats clean assistant completions as the first successful turn', () => {
    expect(isSuccessfulDoneEvent({})).toBe(true);
    expect(isSuccessfulDoneEvent({ blocked: true })).toBe(false);
    expect(isSuccessfulDoneEvent({ outOfScope: true })).toBe(false);
    expect(isSuccessfulDoneEvent({ fallback: true })).toBe(false);
  });

  it('only reconciles failures that may have persisted a server-side turn', () => {
    expect(shouldReconcileStreamError('timeout')).toBe(true);
    expect(shouldReconcileStreamError('upstream_error')).toBe(true);
    expect(shouldReconcileStreamError('in_progress')).toBe(true);
    expect(shouldReconcileStreamError('script_unavailable')).toBe(false);
    expect(shouldReconcileStreamError('session_scope_mismatch')).toBe(false);
    expect(shouldReconcileStreamError('client_message_id_collision')).toBe(false);
  });
});

describe('getBondFeedback', () => {
  it('reports a level-up with the server-provided level', () => {
    expect(getBondFeedback({ bondLevel: 4, bondDelta: 10, leveledUp: true })).toEqual({
      kind: 'leveledUp',
      level: 4,
    });
  });

  it('reports a normal gain from the server delta', () => {
    expect(getBondFeedback({ bondLevel: 1, bondDelta: 10, leveledUp: false })).toEqual({
      kind: 'gained',
      delta: 10,
    });
  });

  it('returns null for idempotent replays with delta 0', () => {
    expect(getBondFeedback({ bondLevel: 3, bondDelta: 0, leveledUp: false })).toBeNull();
  });

  it('returns null when bond fields are absent (async effects / filtered turns)', () => {
    expect(getBondFeedback({})).toBeNull();
  });

  it('falls back to a gain when leveledUp lacks a level', () => {
    expect(getBondFeedback({ bondDelta: 10, leveledUp: true })).toEqual({ kind: 'gained', delta: 10 });
  });
});
