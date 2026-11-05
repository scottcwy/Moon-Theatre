import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const profile = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const login = fs.readFileSync(path.join(__dirname, '../login/index.tsx'), 'utf8');
const style = fs.readFileSync(path.join(__dirname, 'index.scss'), 'utf8');
const loadingCard = fs.readFileSync(path.resolve(__dirname, '../../../../../packages/miniapp-ui/src/components/profile/ProfileLoadingCard.tsx'), 'utf8');

describe('auth/profile visual frame contract', () => {
  it('keeps logged-in, logged-out, and loading states explicit', () => {
    expect(profile).toContain('ProfileLoadingCard');
    expect(profile).toContain('const signedOut = needsLogin || !isLoggedIn();');
    expect(profile).toContain('profile__hero--signed-out');
    expect(profile).toContain('useTabPageLifecycle(loadProfile');
    expect(profile).toContain('onSessionReset: clearProfileData');
    expect(profile).not.toContain('verifyAuth');
    expect(profile).not.toContain('<StageTabBar');
  });

  it('所有个人页状态共用社区/聊天列表的庭院背景，保留三点月相及真实文字', () => {
    expect(profile).toContain('Taro.getWindowInfo().statusBarHeight');
    expect(profile).toContain("className={loading ? 'profile__loading-stage' : 'profile__stage'} style={loadingStageStyle}");
    expect(profile).toContain('backgroundImage="/assets/backgrounds/courtyard.jpg"');
    expect(profile).not.toContain('backgroundImageTop=');
    expect(style).toContain('.profile.profile--loading');
    expect(style).toContain('> .page-shell__backdrop-overlay');
    expect(style).toContain('background: $stage-scene-overlay');
    expect(style).not.toContain("url('../../assets/backgrounds/courtyard.jpg')");
    expect(style).toContain('margin-top: 444rpx');
    expect(loadingCard.match(/className="profile__loading-dot/g)).toHaveLength(3);
    expect(loadingCard).toContain('<Text className="profile__loading-text">');
  });

  it('uses the frozen production login copy', () => {
    expect(login).toContain("{loading ? '登录中…' : '登录'}");
    expect(login).not.toContain('使用微信登录');
  });
});
