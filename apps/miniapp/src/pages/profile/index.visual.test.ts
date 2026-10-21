import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const profile = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const login = fs.readFileSync(path.join(__dirname, '../login/index.tsx'), 'utf8');

describe('auth/profile visual frame contract', () => {
  it('keeps logged-in, logged-out, and loading states explicit', () => {
    expect(profile).toContain('ProfileLoadingCard');
    expect(profile).toContain('needsLogin || !isLoggedIn()');
    expect(profile).toContain('profile__hero--signed-out');
  });

  it('uses the frozen production login copy', () => {
    expect(login).toContain("{loading ? '登录中…' : '登录'}");
    expect(login).not.toContain('使用微信登录');
  });
});
