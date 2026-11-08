/**
 * Chinese copy for quota package maintenance (AC-13). One module so the list, the create form and
 * the inline editor cannot drift, and so the sentence that matters — existing orders keep their
 * snapshot — is testable text rather than a JSX literal.
 */
import type { AdminQuotaPackage } from '@/server/modules/admin/index.js';

export const QUOTA_PACKAGE_PRICE_LABEL = '价格（元）';
export const QUOTA_PACKAGE_POINTS_LABEL = '点数';
export const QUOTA_PACKAGE_ORDER_LABEL = '排序';
export const QUOTA_PACKAGE_DESCRIPTION_LABEL = '说明';
export const QUOTA_PACKAGE_RECOMMENDED_LABEL = '推荐套餐';
export const QUOTA_PACKAGE_ACTIVE_LABEL = '启用（玩家可购买）';

export const QUOTA_PACKAGE_AVAILABILITY_LABELS = { active: '已上架', inactive: '已下架' } as const;

/**
 * The decision the operator must see before a price/points change: orders are snapshots, not a join
 * to the current package row.
 */
export const QUOTA_PACKAGE_ORDER_NOTE =
  '调价或改点数只影响之后创建的订单；已有订单按下单时的金额与点数快照保留，不会被重算。';

export const QUOTA_PACKAGE_OFFLINE_NOTE =
  '下架（停用）后玩家无法再购买该套餐，公开套餐列表不再展示；已有订单金额与点数不变，历史订单仍可查看。';

export const QUOTA_PACKAGE_OFFLINE_CONFIRMATION =
  '我确认下架该套餐：下架后玩家无法再购买，已有订单的金额与点数保持不变。';

export const QUOTA_PACKAGE_ONLINE_CONFIRMATION = '我确认上架该套餐：上架后玩家可立即购买，价格与点数按当前值。';

export const QUOTA_PACKAGE_EMPTY = '暂无充值套餐。可用上方表单创建第一个套餐。';
export const QUOTA_PACKAGE_NOTHING_TO_SAVE = '没有字段变化，本次未写入，也未新增审计记录。';
export const QUOTA_PACKAGE_NAME_CONFLICT_COPY = '已存在同名套餐，请使用不同名称。';

export function availabilityLabel(active: boolean): string {
  return active ? QUOTA_PACKAGE_AVAILABILITY_LABELS.active : QUOTA_PACKAGE_AVAILABILITY_LABELS.inactive;
}

export function describeQuotaPackageCreate(result: { package: AdminQuotaPackage }): string {
  return `已创建套餐「${result.package.name}」；启用状态下玩家可立即购买，已停用时不会出现在购买列表。`;
}

export function describeQuotaPackageSave(result: { changed: boolean; package: AdminQuotaPackage }): string {
  if (!result.changed) return '没有字段变化，本次未写入，也未新增审计记录。';
  return `已保存套餐「${result.package.name}」的修改；已有订单的金额与点数不受影响。`;
}

export function describeQuotaPackageAvailability(result: { changed: boolean; package: AdminQuotaPackage }): string {
  if (!result.changed) return '套餐上下架状态已是目标值，本次没有新的变更。';
  return result.package.active
    ? `已上架套餐「${result.package.name}」，玩家现在可以购买。`
    : `已下架套餐「${result.package.name}」，玩家无法再购买；已有订单不受影响。`;
}

/** Server error codes are stable keys; the console maps them instead of echoing English text. */
export function quotaPackageFailureCopy(code: string | undefined, fallback: string): string {
  if (code === 'quota_package_name_conflict') return QUOTA_PACKAGE_NAME_CONFLICT_COPY;
  if (code === 'admin_input_invalid') return '填写内容不符合要求，请检查后重试。';
  return fallback;
}
