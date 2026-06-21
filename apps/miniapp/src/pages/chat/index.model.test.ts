import { describe, expect, it } from 'vitest';
import { getFriendlyStreamErrorMessage, getInitialModelTier, shouldRenderStandaloneTypingIndicator } from './index.model';

describe('chat message rendering helpers', () => {
  it('starts new chats on the casual model tier for reliable first responses', () => {
    expect(getInitialModelTier()).toBe('casual');
  });

  it('maps stream abort errors to a helpful retry message', () => {
    expect(getFriendlyStreamErrorMessage('This operation was aborted')).toBe('模型响应超时，请切换轻松档或稍后重试');
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
