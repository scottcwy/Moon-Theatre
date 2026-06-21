import { describe, expect, it } from 'vitest';
import { getLoginErrorMessage } from './model';

describe('login model', () => {
  it('maps invalid login codes to a friendly retry message', () => {
    expect(getLoginErrorMessage({ statusCode: 400, message: 'WeChat code2session failed: 40029 invalid code' })).toBe(
      '微信登录凭证无效，请重试',
    );
  });

  it('does not expose server internals for unexpected login failures', () => {
    expect(getLoginErrorMessage(new Error('database connection failed'))).toBe('登录失败，请重试');
  });
});
