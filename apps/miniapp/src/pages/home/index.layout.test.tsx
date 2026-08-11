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

  it('keeps gallery cards at a glanceable width with a halved fixed height', () => {
    expect(styleSource).toContain('flex: 0 0 64%');
    expect(styleSource).toContain('height: 260rpx');
  });

  it('shows only the script title on gallery cards, clamped to 2 lines', () => {
    expect(styleSource).toContain('-webkit-line-clamp: 2');
    expect(styleSource).not.toContain('-webkit-line-clamp: 3');
    expect(styleSource).toContain('overflow: hidden');
    expect(source).not.toContain('theater-home__hero-desc');
    expect(source).toContain('onTap={() => chooseRole(script.id)}');
  });

  it('renders page dots only when more than one script exists', () => {
    expect(source).toContain('scripts.length > 1 &&');
    expect(source).toContain('theater-home__script-dot');
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

  it('renders the script-mode switch as a standard toggle: off by default, thumb slides right via transform when on', () => {
    // 初始为关：无 --on 类，保留无障碍语义与文案。
    expect(source).toContain('const [scriptModeOn, setScriptModeOn] = useState(false);');
    expect(source).toContain("scriptModeOn ? 'theater-home__mode-switch--on' : ''");
    expect(source).toContain('aria-label="剧本模式开关"');
    // 固定轨道宽度：开启态只改颜色，不再拉伸宽度造成布局漂移。
    const onBlock = styleSource.match(/\.theater-home__mode-switch--on\s*\{([\s\S]*?)\}/);
    expect(onBlock?.[1]).not.toContain('width');
    // 拇指位移走 transform 过渡；文字始终渲染、用 opacity 淡入。
    expect(styleSource).toContain('.theater-home__mode-switch--on .theater-home__mode-switch-thumb');
    expect(styleSource).toContain('transition: transform');
    expect(source).not.toMatch(/\{scriptModeOn \?\s*\(\s*<Text className="theater-home__mode-switch-label"/);
  });
});
