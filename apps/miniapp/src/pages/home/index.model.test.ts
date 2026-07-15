import { describe, expect, it } from 'vitest';
import {
  buildScriptsUrl,
  getCharacterAvatarUrl,
  getCharacterDecisionBadge,
  getCharacterDetailUrl,
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
    expect(homeSections.scriptPrimaryAction).toBe('选择角色');
    expect(homeSections.characterTitle).toBe('最近角色');
  });

  it('routes every API script id to the generic role selection page', () => {
    expect(getScriptRoleSelectUrl('script-uuid')).toBe('/pages/script/select?scriptId=script-uuid');
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
    expect(getScriptCoverUrl({ slug: 'unknown', coverUrl: null })).toBe('');
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
});
