import { describe, expect, it } from 'vitest';
import { createClientMessageId, getFriendlyStreamErrorMessage, getInitialModelTier, shouldRenderStandaloneTypingIndicator } from './index.model';

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
    expect(getFriendlyStreamErrorMessage('unknown')).toBe('这次回应没能送达，请稍后再试。');
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
});
