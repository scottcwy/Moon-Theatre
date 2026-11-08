import type { ReactNode } from 'react';

export function AdminTable({ label, isEmpty, emptyMessage, children }: {
  label: string; isEmpty: boolean; emptyMessage: string; children: ReactNode;
}) {
  if (isEmpty) return <p className="empty">{emptyMessage}</p>;
  return <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

export function formatAdminDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}
const statuses: Record<string, string> = {
  active: '进行中', inactive: '未启用', ended: '已结束', archived: '已归档', deleted: '已删除',
  created: '已创建', prepay_created: '已预支付', pending: '待处理', paid: '已支付', credited: '已入账',
  closed: '已关闭', failed: '失败', refunded: '已退款', cancelled: '已取消', success: '成功',
  normal: '正常', flagged: '待审核', resolved: '已处理', filtered: '已过滤',
  recharge: '充值', consume: '消费', adjust: '调整', refund: '退款', verified: '验证通过',
  valid: '有效', invalid: '无效', unverified: '未验证', unknown: '未知', passed: '通过', rejected: '拒绝',
  out_of_scope: '超出范围', creating: '创建中', provider_error: '渠道错误', provider_result_unknown: '渠道结果待确认',
  basic: '基础', casual: '轻松', standard: '标准', immersive: '沉浸', premium: '高级', pro: '专业', free: '免费',
};
export function adminStatus(value: unknown): string { return typeof value === 'string' ? statuses[value] ?? value : '—'; }
export function LoadError({ subject }: { subject: string }) {
  return <section className="notice error" role="alert"><h1>{subject}暂时无法加载</h1><p>服务暂时不可用，未展示不完整数据。请稍后重试；若持续失败，请联系服务器维护人员。</p><a href="">重新加载</a></section>;
}
