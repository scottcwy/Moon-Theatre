import { describe, expect, it } from 'vitest';
import {
  featuredScripts,
  getCharacterAvatarUrl,
  getCharacterDecisionBadge,
  getCharacterDetailUrl,
  getScriptRoleSelectUrl,
  homeSections,
} from './index.model';
import { calculateTopBarMetrics, getTopBarStyle } from '../../utils/topbar';

describe('home navigation helpers', () => {
  it('builds character detail URLs with an explicit character id', () => {
    expect(getCharacterDetailUrl('abc-123')).toBe('/pages/character/detail?characterId=abc-123');
  });

  it('rejects empty character ids instead of routing to a broken detail page', () => {
    expect(() => getCharacterDetailUrl('  ')).toThrow('characterId is required');
  });

  it('features Moon Garden and Rogue Narrative carousel cards with processed cover assets', () => {
    expect(featuredScripts.map((script) => script.title)).toEqual(['月见庭院：狐神的新娘', '流氓叙事']);
    expect(featuredScripts[0]?.cover).toBe('/assets/home/moon-garden-cover.jpg');
    expect(featuredScripts[1]?.cover).toBe('/assets/home/liumang-cover.jpg');
    expect(featuredScripts[1]?.tag).toBe('沉浸式体验');
  });

  it('keeps the home flow centered on choosing a role from a script', () => {
    expect(homeSections.scriptTitle).toBe('热门剧本');
    expect(homeSections.scriptPrimaryAction).toBe('选择角色');
    expect(homeSections.characterTitle).toBe('最近角色');
  });

  it('routes Moon Garden script selection to its dedicated role selection page', () => {
    expect(getScriptRoleSelectUrl('moon-garden')).toBe('/pages/role-select/moon-garden');
  });

  it('rejects unknown scripts instead of falling through to the first character', () => {
    expect(() => getScriptRoleSelectUrl('unknown-script')).toThrow('unsupported script id');
  });

  it('uses local character portraits when API avatar urls are empty', () => {
    expect(getCharacterAvatarUrl('白藏', '')).toBe('/assets/characters/hakuzo.jpg');
    expect(getCharacterAvatarUrl('贺茂清玄', null)).toBe('/assets/characters/kiyoharu.jpg');
  });

  it('keeps explicit API avatar urls when provided', () => {
    expect(getCharacterAvatarUrl('白藏', 'https://cdn.example.com/hakuzo.webp')).toBe('https://cdn.example.com/hakuzo.webp');
  });

  it('adds decision badges to character cards instead of a generic role label', () => {
    expect(getCharacterDecisionBadge('白藏')).toBe('新手友好');
    expect(getCharacterDecisionBadge('贺茂清玄')).toBe('隐藏线多');
    expect(getCharacterDecisionBadge('陌生角色')).toBe('可选角色');
  });

  it('calculates top bar space from status bar and WeChat capsule geometry', () => {
    expect(
      calculateTopBarMetrics(
        { windowWidth: 390, statusBarHeight: 47 },
        { top: 59, left: 287, width: 87, height: 32 },
      ),
    ).toEqual({
      statusBarHeight: 47,
      contentHeight: 56,
      totalHeight: 103,
      menuReserveWidth: 115,
    });
  });

  it('builds CSS variables for positioning content below the custom top bar', () => {
    expect(getTopBarStyle({ statusBarHeight: 47, contentHeight: 56, totalHeight: 103, menuReserveWidth: 115 })).toEqual({
      '--topbar-status-height': '47px',
      '--topbar-content-height': '56px',
      '--topbar-total-height': '103px',
      '--topbar-menu-reserve': '115px',
    });
  });
});
