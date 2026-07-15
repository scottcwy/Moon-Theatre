import { describe, expect, it } from 'vitest';
import { getPreferredNameError, getPreferredNameSaveValue, getProfileDisplayName } from './index.model';

describe('profile preferred name helpers', () => {
  it('trims a valid preferred name before saving', () => {
    expect(getPreferredNameSaveValue('  小岚  ')).toBe('小岚');
    expect(getPreferredNameError('  小岚  ')).toBe('');
  });

  it('rejects blank names without sending a request', () => {
    expect(getPreferredNameSaveValue('   ')).toBeNull();
    expect(getPreferredNameError('   ')).toBe('请输入 1—20 个字符的对话称呼');
  });

  it('counts Unicode code points instead of UTF-16 code units', () => {
    expect(getPreferredNameSaveValue('😀'.repeat(20))).toBe('😀'.repeat(20));
    expect(getPreferredNameSaveValue('😀'.repeat(21))).toBeNull();
    expect(getPreferredNameError('😀'.repeat(21))).toBe('对话称呼最多 20 个字符');
  });

  it('prefers the saved dialogue name, then WeChat nickname, then the page fallback', () => {
    expect(getProfileDisplayName(' 小岚 ', '微信昵称')).toBe('小岚');
    expect(getProfileDisplayName(null, ' 微信昵称 ')).toBe('微信昵称');
    expect(getProfileDisplayName(' ', ' ')).toBe('我的');
    expect(getProfileDisplayName(undefined, null)).toBe('我的');
  });
});
