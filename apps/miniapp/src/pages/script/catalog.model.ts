export type ScriptAvailability = 'available' | 'preview';

export interface ScriptCatalogItem {
  id: string;
  title: string;
  description: string;
  slug: string;
  genre: string;
  coverUrl: string | null;
  sortOrder: number;
  supportsScriptMode: boolean;
  availability: ScriptAvailability;
}

export const scriptCatalogSections = {
  title: '剧本目录',
  kicker: '选一个剧本，开启专属故事',
  searchPlaceholder: '搜索剧本名称、类型或关键词',
  availableBadge: '剧本模式',
  previewBadge: '即将上线',
} as const;

export function buildScriptCatalogUrl(query: string): string {
  const keyword = query.trim();
  return keyword ? `/api/scripts?q=${encodeURIComponent(keyword)}` : '/api/scripts';
}

export function getScriptModeBadge(item: Pick<ScriptCatalogItem, 'supportsScriptMode'>): string {
  return item.supportsScriptMode ? scriptCatalogSections.availableBadge : scriptCatalogSections.previewBadge;
}
