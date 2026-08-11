/** 分页参数安全解析：非纯数字（含尾随垃圾字符如 `12abc`）/非正数一律回退默认值，绝不产生 NaN（避免 `LIMIT NaN` 打 500）。 */
export function parsePositiveInteger(value: string | null, fallback: number): number {
  const raw = (value ?? '').trim();
  if (!/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
