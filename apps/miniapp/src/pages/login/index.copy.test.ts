import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const loginPagePath = path.join(__dirname, 'index.tsx');
const loginStylePath = path.join(__dirname, 'index.scss');
const loginBackgroundPath = path.resolve(__dirname, '../../assets/login/login-theater-bg.jpg');

describe('login page copy', () => {
  it('uses user-facing theater entry copy instead of product-feature language', () => {
    const page = fs.readFileSync(loginPagePath, 'utf8');

    expect(page).toContain('阅满楼');
    expect(page).toContain('有些角色');
    expect(page).toContain('在等你开口');
    expect(page).toContain('回来继续上次那场戏，见你没聊完的人。');
    expect(page).toContain('使用微信登录');
    expect(page).toContain('<View className="login-page__title-line">有些角色</View>');
    expect(page).toContain('<View className="login-page__title-line">在等你开口</View>');

    expect(page).not.toContain('对话由AI生成，角色和剧情都为虚构。');
    expect(page).not.toContain('login-page__notice');
    expect(page).not.toContain('有些角色，在等你开口；');
    expect(page).not.toContain('回聊见上次没聊完的人；');
    expect(page).not.toContain('进入剧场');
    expect(page).not.toContain('剧本杀角色聊天小程序');
    expect(page).not.toContain('热门剧本角色');
    expect(page).not.toContain('沉浸式交流');
    expect(page).not.toContain('保存你的故事');
  });

  it('keeps the entry surface free of template divider lines', () => {
    const styles = fs.readFileSync(loginStylePath, 'utf8');

    expect(styles).not.toContain('border-top');
  });

  it('uses a dedicated theater background asset with readability overlays', () => {
    const page = fs.readFileSync(loginPagePath, 'utf8');
    const styles = fs.readFileSync(loginStylePath, 'utf8');

    expect(fs.existsSync(loginBackgroundPath)).toBe(true);
    expect(page).toContain('login-page__backdrop');
    expect(page).toContain('login-page__shade');
    expect(styles).toContain('../../assets/login/login-theater-bg.jpg');
    expect(styles).toContain('linear-gradient');
  });
});
