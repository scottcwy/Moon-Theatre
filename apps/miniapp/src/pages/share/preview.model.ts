/** 分享海报通用兜底文案：不绑定任何剧本，避免出现月见庭院残留。 */
export const FALLBACK_SHARE_EXCERPT = '在月满楼，每一段关系都从此刻开始。';

/** 海报画布 3 行截断上限（38px 字号 × 3 行 ≈ 36 字），超出加省略号。 */
export const SHARE_EXCERPT_MAX_LENGTH = 36;

export function truncateExcerpt(text: string, maxLength = SHARE_EXCERPT_MAX_LENGTH): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).trimEnd()}…`;
}

/**
 * 分享引言数据驱动：角色所属剧本简介优先，其次角色简介；都没有时用品牌兜底。
 */
export function getShareExcerpt(
  scriptDescription?: string | null,
  characterDescription?: string | null,
): string {
  const source = scriptDescription?.trim() || characterDescription?.trim() || '';
  return truncateExcerpt(source) || FALLBACK_SHARE_EXCERPT;
}
