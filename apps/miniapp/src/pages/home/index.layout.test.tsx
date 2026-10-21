import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'index.tsx'), 'utf8');
const styleSource = readFileSync(resolve(__dirname, 'index.scss'), 'utf8');

describe('home hot scripts layout', () => {
  it('replaces the CSS overflow strip with a Taro horizontal ScrollView without a scrollbar', () => {
    expect(source).toContain('ScrollView');
    expect(source).toContain('scrollX');
    expect(source).toContain('enhanced');
    expect(source).toContain('showScrollbar={false}');
    expect(styleSource).not.toContain('.theater-home__feature-strip');
    expect(styleSource).toContain('.theater-home__script-scroll');
  });

  it('keeps the gallery card full-bleed with the frozen 500rpx stage height', () => {
    expect(styleSource).toContain('flex: 0 0 100%');
    expect(styleSource).toContain('height: 500rpx');
  });

  it('shows the script title plus a three-line description on the stage card', () => {
    expect(styleSource).toContain('-webkit-line-clamp: 3');
    expect(styleSource).toContain('overflow: hidden');
    expect(source).toContain('theater-home__hero-desc');
    expect(source).toContain('onTap={() => chooseRole(script)}');
  });

  it('renders page dots only when more than one script exists', () => {
    expect(source).toContain('scripts.length > 1 &&');
    expect(source).toContain('theater-home__script-dot');
  });

  it('uses the frozen dark stage surface and script-list rows', () => {
    expect(styleSource).toContain('$home-ink: #170e12');
    expect(styleSource).toContain('.theater-home__script-list');
    expect(styleSource).toContain('.theater-home__script-row');
    expect(styleSource).toContain('border: 1rpx solid $home-gold-line');
  });

  it('resets to the first card after a search without adding autoplay', () => {
    expect(source).toMatch(/setActiveScriptIndex\(0\)/);
    expect(source).not.toContain('setInterval');
    expect(source).not.toContain('autoplay');
  });

  it('loads frequent characters only when logged in and falls back to recommended characters', () => {
    expect(source).toContain('isLoggedIn()');
    expect(source).toContain('buildFrequentCharactersUrl');
    expect(source).toContain("get<{ characters: CharacterCard[] }>('/api/characters')");
    // 常聊聚合请求只出现在 isLoggedIn() 通过之后，未登录不会发起必然 401 的请求。
    expect(source.indexOf('buildFrequentCharactersUrl()')).toBeGreaterThan(source.indexOf('if (!isLoggedIn())'));
  });

  it('labels the section 常聊角色 with history and 推荐角色 otherwise', () => {
    expect(source).toContain('getCharacterSectionTitle(hasFrequentCharacters)');
    expect(source).not.toContain('最近角色');
  });

  it('keeps frequent character cards clickable to the detail page without showing turn counts', () => {
    expect(source).toContain('openCharacter(character.id)');
    expect(source).not.toContain('successfulTurnCount');
    expect(source).not.toContain('聊天次数');
  });

  it('renders 剧本模式 as the frozen pill entry and keeps the existing navigation trigger', () => {
    expect(source).toContain('const [scriptModeOn, setScriptModeOn] = useState(false);');
    expect(source).toContain("scriptModeOn ? 'theater-home__mode-switch--on' : ''");
    expect(source).toContain('aria-label="剧本模式"');
    expect(source).toContain('handleScriptModeToggle');
    expect(source).toContain('homeSections.scriptModeEntry');
    expect(styleSource).toContain('.theater-home__mode-switch');
    expect(styleSource).toContain('border-radius: 8rpx');
  });
});
