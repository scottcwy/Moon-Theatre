import { describe, expect, it } from 'vitest';
import { shouldRenderStandaloneTypingIndicator } from './index.model';

describe('chat message rendering helpers', () => {
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
