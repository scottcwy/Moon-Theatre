import { describe, expect, it } from 'vitest';
import { FALLBACK_SHARE_EXCERPT, getShareExcerpt, truncateExcerpt } from './preview.model';

describe('share preview excerpt helpers', () => {
  it('prefers the script description over the character description', () => {
    expect(getShareExcerpt('月满楼是一座营业到天亮的酒楼。', '角色简介')).toBe(
      '月满楼是一座营业到天亮的酒楼。',
    );
  });

  it('falls back to the character description when the script has none', () => {
    expect(getShareExcerpt(null, '冷静克制的记者，眼里总有没查完的案子。')).toBe(
      '冷静克制的记者，眼里总有没查完的案子。',
    );
  });

  it('uses the brand fallback when no description exists', () => {
    expect(getShareExcerpt(null, null)).toBe(FALLBACK_SHARE_EXCERPT);
    expect(getShareExcerpt('', '  ')).toBe(FALLBACK_SHARE_EXCERPT);
  });

  it('truncates long excerpts with an ellipsis', () => {
    expect(truncateExcerpt('一'.repeat(40), 36)).toBe('一'.repeat(36) + '…');
    expect(truncateExcerpt('一二三', 36)).toBe('一二三');
  });
});
