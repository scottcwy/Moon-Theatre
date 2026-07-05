import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const loginPagePath = path.join(__dirname, 'index.tsx');

describe('login page copy', () => {
  it('uses user-facing theater entry copy instead of product-feature language', () => {
    const page = fs.readFileSync(loginPagePath, 'utf8');

    expect(page).toContain('灵犀剧场');
    expect(page).toContain('有些角色，只等你开口');
    expect(page).toContain('进入剧场');
    expect(page).toContain('使用微信登录');

    expect(page).not.toContain('剧本杀角色聊天小程序');
    expect(page).not.toContain('热门剧本角色');
    expect(page).not.toContain('沉浸式交流');
    expect(page).not.toContain('保存你的故事');
  });
});
