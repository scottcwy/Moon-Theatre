import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pagesDir = path.resolve(__dirname);
const migratedLocalImportPatterns = [
  '../../components/ui/',
  '../../components/layout/',
  '../../components/character/',
  '../../components/chat/',
  '../../components/status/',
  '../../components/achievement/',
  '../../components/share/',
];

function collectTsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(fullPath);
    if (entry.isFile() && fullPath.endsWith('.tsx')) return [fullPath];
    return [];
  });
}

describe('production pages use shared miniapp ui', () => {
  it('does not import migrated reusable components from app-local components', () => {
    const offenders = collectTsxFiles(pagesDir).filter((filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      return migratedLocalImportPatterns.some((pattern) => content.includes(pattern));
    });

    expect(offenders.map((filePath) => path.relative(path.resolve(__dirname, '..'), filePath))).toEqual([]);
  });

  it('keeps migrated page primitives on shared miniapp ui components', () => {
    const loginPage = fs.readFileSync(path.join(pagesDir, 'login/index.tsx'), 'utf8');
    expect(loginPage).toContain('PrimaryButton');
    expect(loginPage).not.toContain('NoticeBlock');
    expect(loginPage).not.toContain('button-primary');
    expect(loginPage).not.toContain('login-page__notice');

    const profilePage = fs.readFileSync(path.join(pagesDir, 'profile/index.tsx'), 'utf8');
    expect(profilePage).toContain('profile__hero');
    expect(profilePage).toContain('profile__growth-card');
    expect(profilePage).toContain('profile__stat-grid');
    expect(profilePage).toContain('profile__empty-panel');
    expect(profilePage).toContain('CharacterAvatar');
    expect(profilePage).toContain('PointsBadge');
    expect(profilePage).toContain('AchievementIcon');
    expect(profilePage).toContain('preferredName');
    expect(profilePage).toContain('getProfileDisplayName');
    expect(profilePage).toContain('IconButton');
    expect(profilePage).toContain('profile__name-line');
    expect(profilePage).toContain("'/api/achievements'");
    expect(profilePage).toContain('EmptyState');
    expect(profilePage).toContain('NoticeBlock');
    expect(profilePage).toContain('开始第一段角色经历');
    expect(profilePage).toContain('去选角色');
    expect(profilePage).toContain("Taro.switchTab({ url: '/pages/home/index' })");
    expect(profilePage).toContain('查看聊天');
    expect(profilePage).toContain("Taro.switchTab({ url: '/pages/chat/list' })");
    expect(profilePage).not.toContain("'旅人'");
    expect(profilePage).not.toContain('profile__notice');
    expect(profilePage).not.toContain('暂无称号');
    expect(profilePage).not.toContain('暂无成就');
    expect(profilePage).not.toContain('PageSection title="称号"');
    expect(profilePage).not.toContain('PageSection title="成就"');
    expect(profilePage).not.toContain('className="page-section');
    expect(profilePage).not.toContain('surface-card');
    expect(profilePage).not.toContain('profile__preferred-name-card');
    expect(profilePage).not.toContain('LORDICON_ATTRIBUTION');
    expect(profilePage).not.toContain('profile__icon-credit');

    const profileStyles = fs.readFileSync(path.join(pagesDir, 'profile/index.scss'), 'utf8');
    expect(profileStyles).not.toContain('profile__hero::before');
    expect(profileStyles).not.toContain('profile__icon-credit');

    const detailPage = fs.readFileSync(path.join(pagesDir, 'character/detail.tsx'), 'utf8');
    expect(detailPage).toContain('CharacterDetailHero');
    expect(detailPage).toContain('BottomAction');
    expect(detailPage).toContain('PrimaryButton');
    expect(detailPage).toContain('PageSection');
    expect(detailPage).toContain('createBondViewModel');
    expect(detailPage).toContain('buildCharacterChatUrl');
    expect(detailPage).toContain('进入剧本');
    expect(detailPage).toContain('自由聊天');
    expect(detailPage).toContain('useDidShow');
    expect(detailPage).not.toContain('BOND_EXP_PER_LEVEL');
    expect(detailPage).not.toContain('bondMaxExp');
    expect(detailPage).not.toContain('detail__section surface-card');
    expect(detailPage).not.toContain('title="人设简介"');
    expect(detailPage).not.toContain('character.description}</Text>');

    const chatPage = fs.readFileSync(path.join(pagesDir, 'chat/index.tsx'), 'utf8');
    expect(chatPage).toContain('createBondViewModel');
    expect(chatPage).toContain('hasSuccessfulTurn');
    expect(chatPage).toContain('starterQuestions');
    expect(chatPage).toContain('canSend');
    expect(chatPage).toContain('await loadCharacterDetail(history.session.characterId, false);');
    expect(chatPage).not.toContain('BOND_EXP_PER_LEVEL');
    expect(chatPage).not.toContain('bondMaxExp');

    const chatListPage = fs.readFileSync(path.join(pagesDir, 'chat/list.tsx'), 'utf8');
    const chatListModel = fs.readFileSync(path.join(pagesDir, 'chat/list.model.ts'), 'utf8');
    expect(chatListPage).toContain('EmptyState');
    expect(chatListPage).toContain('buildCharacterChatsUrl');
    expect(chatListPage).toContain('getCharacterChatUrl');
    expect(chatListModel).toContain('/api/chat/characters');
    expect(chatListPage).not.toContain('MODE_FILTERS');
    expect(chatListPage).not.toContain('chat-list__mode-filters');
    expect(chatListPage).not.toContain('getSessionContextLabel');
    expect(chatListPage).not.toContain('DEMO_SESSIONS');
    expect(chatListPage).not.toContain('function EmptyPanel');
    expect(chatListPage).not.toContain('button-primary');

    const homePage = fs.readFileSync(path.join(pagesDir, 'home/index.tsx'), 'utf8');
    expect(homePage).toContain('PageSection');
    expect(homePage).toContain('Badge');
    expect(homePage).toContain('PrimaryButton');
    expect(homePage).toContain('CharacterPosterCard');
    expect(homePage).toContain('SearchBar');
    expect(homePage).toContain('buildScriptsUrl');
    expect(homePage).not.toContain('theater-home__script-card');
    expect(homePage).not.toContain('theater-home__poster-wrap');
    expect(homePage).not.toContain('theater-home__start-button');
    expect(homePage).not.toContain('featuredScripts');
    expect(homePage).not.toContain('流氓叙事');

    const scriptSelectPage = fs.readFileSync(path.join(pagesDir, 'script/select.tsx'), 'utf8');
    const scriptSelectStyles = fs.readFileSync(path.join(pagesDir, 'script/select.scss'), 'utf8');
    expect(scriptSelectPage).toContain("`/api/scripts/${scriptId}`");
    expect(scriptSelectPage).toContain('CharacterPosterCard');
    expect(scriptSelectPage).toContain('getScriptCharacterDetailUrl');
    expect(scriptSelectPage).toContain('<PageSection title="世界观" surface>');
    expect(scriptSelectStyles).toContain('transform: scale(1.08) translateY(16rpx);');
    expect(scriptSelectStyles).toContain('padding: $space-5 $page-padding-h');

    const moonRoleStyles = fs.readFileSync(path.join(pagesDir, 'role-select/moon-garden.scss'), 'utf8');
    expect(moonRoleStyles).not.toContain('.moon-role-select__hero-badge');
    expect(moonRoleStyles).toContain('$color-surface-container-low');
  });
});
