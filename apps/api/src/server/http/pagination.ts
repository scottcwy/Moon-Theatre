/** 分页参数安全解析：非法/非正数一律回退默认值，绝不产生 NaN（避免 `LIMIT NaN` 打 500）。 */
export function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
