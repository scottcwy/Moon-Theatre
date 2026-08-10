import { describe, expect, it } from 'vitest';
import { buildScriptCatalogUrl, getScriptModeBadge, scriptCatalogSections } from './catalog.model';

describe('script catalog model', () => {
  it('builds encoded catalog searches and restores the full list for blank queries', () => {
    expect(buildScriptCatalogUrl(' 月见 狐神 ')).toBe('/api/scripts?q=%E6%9C%88%E8%A7%81%20%E7%8B%90%E7%A5%9E');
    expect(buildScriptCatalogUrl('')).toBe('/api/scripts');
  });

  it('labels playable scripts as script mode and others as coming soon', () => {
    expect(getScriptModeBadge({ supportsScriptMode: true })).toBe(scriptCatalogSections.availableBadge);
    expect(getScriptModeBadge({ supportsScriptMode: false })).toBe(scriptCatalogSections.previewBadge);
  });

  it('keeps the catalog title and search copy stable', () => {
    expect(scriptCatalogSections.title).toBe('剧本目录');
    expect(scriptCatalogSections.searchPlaceholder).toBe('搜索剧本名称、类型或关键词');
  });
});
