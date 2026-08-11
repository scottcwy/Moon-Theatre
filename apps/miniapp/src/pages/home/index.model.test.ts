import { describe, expect, it } from 'vitest';
import {
  buildFrequentCharactersUrl,
  buildScriptsUrl,
  getCharacterAvatarUrl,
  getCharacterGenderVariants,
  getActiveScriptIndex,
  getCharacterDetailUrl,
  getCharacterSectionTitle,
  getScriptCatalogUrl,
  getScriptCoverUrl,
  getScriptRoleSelectUrl,
  homeSections,
  shouldApplyScriptResponse,
} from './index.model';
import { calculateTopBarMetrics, getTopBarStyle } from '../../utils/topbar';

describe('home navigation helpers', () => {
  it('builds character detail URLs with an explicit character id', () => {
    expect(getCharacterDetailUrl('abc-123')).toBe('/pages/character/detail?characterId=abc-123');
  });

  it('rejects empty character ids instead of routing to a broken detail page', () => {
    expect(() => getCharacterDetailUrl('  ')).toThrow('characterId is required');
  });

  it('keeps the home flow centered on choosing a role from a script', () => {
    expect(homeSections.scriptTitle).toBe('热门剧本');
    expect(homeSections.scriptModeEntry).toBe('剧本');
    expect(homeSections.frequentCharacterTitle).toBe('常聊角色');
    expect(homeSections.recommendedCharacterTitle).toBe('推荐角色');
  });

  it('labels the character section by history instead of misleading as "最近角色"', () => {
    expect(getCharacterSectionTitle(true)).toBe('常聊角色');
    expect(getCharacterSectionTitle(false)).toBe('推荐角色');
  });

  it('builds the frequent characters url with turn_count sorting and a fixed limit', () => {
    expect(buildFrequentCharactersUrl()).toBe('/api/chat/characters?sort=turn_count&limit=4');
    expect(buildFrequentCharactersUrl(8)).toBe('/api/chat/characters?sort=turn_count&limit=8');
  });

  it('routes every API script id to the generic role selection page', () => {
    expect(getScriptRoleSelectUrl('script-uuid')).toBe('/pages/script/select?scriptId=script-uuid');
  });

  it('routes the script mode entry to the fixed catalog page', () => {
    expect(getScriptCatalogUrl()).toBe('/pages/script/catalog');
  });

  it('rejects empty script ids instead of falling through to a local mapping', () => {
    expect(() => getScriptRoleSelectUrl('  ')).toThrow('scriptId is required');
  });

  it('builds encoded script searches and restores the full list for blank queries', () => {
    expect(buildScriptsUrl(' 月见 狐神 ')).toBe('/api/scripts?q=%E6%9C%88%E8%A7%81%20%E7%8B%90%E7%A5%9E');
    expect(buildScriptsUrl('')).toBe('/api/scripts');
  });

  it('prevents an older search response from replacing the latest query', () => {
    expect(shouldApplyScriptResponse(3, 3)).toBe(true);
    expect(shouldApplyScriptResponse(2, 3)).toBe(false);
  });

  it('uses API covers first and keeps only an image fallback for known assets', () => {
    expect(getScriptCoverUrl({ slug: 'moon-garden', coverUrl: 'https://cdn.example.com/moon.webp' })).toBe('https://cdn.example.com/moon.webp');
    expect(getScriptCoverUrl({ slug: 'moon-garden', coverUrl: '' })).toBe('/assets/home/moon-garden-cover.jpg');
    expect(getScriptCoverUrl({ slug: 'moon-tower', coverUrl: '' })).toBe('/assets/home/moon-tower-cover.jpg');
    expect(getScriptCoverUrl({ slug: 'unknown', coverUrl: null })).toBe('');
  });

  it('uses local character portraits when API avatar urls are empty', () => {
    expect(getCharacterAvatarUrl('白藏', '')).toBe('/assets/characters/hakuzo.jpg');
    expect(getCharacterAvatarUrl('贺茂清玄', null)).toBe('/assets/characters/kiyoharu.jpg');
  });

  it('maps every 流氓叙事 character to a local portrait', () => {
    expect(getCharacterAvatarUrl('程聿怀', '')).toBe('/assets/characters/chengyuhuai.jpg');
    expect(getCharacterAvatarUrl('蒋伯驾', '')).toBe('/assets/characters/jiangbojia.jpg');
    expect(getCharacterAvatarUrl('程走柳', '')).toBe('/assets/characters/chengzouliu.jpg');
    expect(getCharacterAvatarUrl('缪宏谟', '')).toBe('/assets/characters/miaohongmo.jpg');
    expect(getCharacterAvatarUrl('黛利拉', '')).toBe('/assets/characters/delilah.jpg');
    expect(getCharacterAvatarUrl('以撒', '')).toBe('/assets/characters/isaac.jpg');
    expect(getCharacterAvatarUrl('羌青瓷', '')).toBe('/assets/characters/qiangqingci.jpg');
    expect(getCharacterAvatarUrl('奥丁', '')).toBe('/assets/characters/odin.jpg');
    expect(getCharacterAvatarUrl('阿奇', '')).toBe('/assets/characters/archie.jpg');
  });

  it('keeps explicit API avatar urls when provided', () => {
    expect(getCharacterAvatarUrl('白藏', 'https://cdn.example.com/hakuzo.webp')).toBe('https://cdn.example.com/hakuzo.webp');
  });

  it('switches dual-poster characters by gender variant', () => {
    expect(getCharacterAvatarUrl('程聿怀', '', 'male')).toBe('/assets/characters/chengyuhuai.jpg');
    expect(getCharacterAvatarUrl('程聿怀', '', 'female')).toBe('/assets/characters/chengyuhuai-female.jpg');
    expect(getCharacterAvatarUrl('羌青瓷', '', 'male')).toBe('/assets/characters/qiangqingci-male.jpg');
    expect(getCharacterAvatarUrl('羌青瓷', '', 'female')).toBe('/assets/characters/qiangqingci.jpg');
  });

  it('lets a gender variant override an explicit avatar url for dual-poster characters', () => {
    expect(getCharacterAvatarUrl('程聿怀', '/assets/characters/chengyuhuai.jpg', 'female')).toBe('/assets/characters/chengyuhuai-female.jpg');
    expect(getCharacterAvatarUrl('程聿怀', '/assets/characters/chengyuhuai.jpg')).toBe('/assets/characters/chengyuhuai.jpg');
  });

  it('ignores gender for characters without dual posters', () => {
    expect(getCharacterAvatarUrl('以撒', '', 'female')).toBe('/assets/characters/isaac.jpg');
    expect(getCharacterAvatarUrl('程走柳', '', 'male')).toBe('/assets/characters/chengzouliu.jpg');
  });

  it('lists gender variants only for dual-poster characters', () => {
    expect(getCharacterGenderVariants('程聿怀')).toEqual(['male', 'female']);
    expect(getCharacterGenderVariants('羌青瓷')).toEqual(['male', 'female']);
    expect(getCharacterGenderVariants('以撒')).toEqual([]);
  });

  it('falls back to empty avatar for unknown characters', () => {
    expect(getCharacterAvatarUrl('陌生角色', '')).toBe('');
  });

  it('calculates top bar space from status bar and WeChat capsule geometry', () => {
    expect(calculateTopBarMetrics(
      { windowWidth: 390, statusBarHeight: 47 },
      { top: 59, left: 287, width: 87, height: 32 },
    )).toEqual({ statusBarHeight: 47, contentHeight: 56, totalHeight: 103, menuReserveWidth: 115 });
  });

  it('builds CSS variables for positioning content below the custom top bar', () => {
    expect(getTopBarStyle({ statusBarHeight: 47, contentHeight: 56, totalHeight: 103, menuReserveWidth: 115 })).toEqual({
      '--topbar-status-height': '47px',
      '--topbar-content-height': '56px',
      '--topbar-total-height': '103px',
      '--topbar-menu-reserve': '115px',
    });
  });

  it('maps horizontal scroll position to the nearest script card index', () => {
    expect(getActiveScriptIndex(0, 1344, 2)).toBe(0);
    expect(getActiveScriptIndex(684, 1344, 2)).toBe(1);
    expect(getActiveScriptIndex(400, 2028, 3)).toBe(1);
    expect(getActiveScriptIndex(1336, 2028, 3)).toBe(2);
  });

  it('pins a single script to the first dot regardless of scroll values', () => {
    expect(getActiveScriptIndex(500, 660, 1)).toBe(0);
    expect(getActiveScriptIndex(500, 0, 0)).toBe(0);
  });
});
