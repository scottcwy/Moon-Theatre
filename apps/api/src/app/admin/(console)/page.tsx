import Link from 'next/link';
import { getAdminStats } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';

export default async function AdminDashboard() {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  const stats = await getAdminStats();
  const sections = [
    { href: '/admin/sessions', title: '玩家会话', description: '查看玩家、角色与会话状态', value: stats.sessions?.total, unit: '条会话' },
    { href: '/admin/orders', title: '订单记录', description: '查看订单金额、点数与状态', value: stats.orders?.total, unit: '条订单' },
    { href: '/admin/payments', title: '支付记录', description: '已支付金额', value: stats.payments?.paidAmountCents == null ? undefined : `¥${(stats.payments.paidAmountCents / 100).toFixed(2)}`, unit: '' },
    { href: '/admin/wallet', title: '钱包与流水', description: '查看账户余额与近期变动', value: stats.wallet?.balancePoints, unit: '余额点数' },
    { href: '/admin/model-usage', title: '模型用量', description: '查看模型调用与点数消耗', value: stats.modelUsage?.total, unit: '次调用' },
  ];
  return <div><h1>运营概览</h1><p className="page-description">查看真实运营数据，进入对应记录核对详情。</p>
    <div className="table-wrap" role="region" aria-label="运营数据概览" tabIndex={0}><table className="overview-table"><thead><tr><th scope="col">业务</th><th scope="col">统计</th><th scope="col">说明</th></tr></thead><tbody>
      {sections.map(section => <tr key={section.href}><td><Link href={section.href}>{section.title}</Link></td><td className="numeric">{section.value ?? '—'} {section.value == null ? '' : section.unit}</td><td>{section.description}</td></tr>)}
    </tbody></table></div>
    <section className="panel overview-summary"><h2>玩家与内容</h2><dl><dt>玩家</dt><dd>累计 {stats.users?.total ?? '—'} / 今日 {stats.users?.today ?? '—'}</dd><dt>消息</dt><dd>累计 {stats.messages?.total ?? '—'} / 今日 {stats.messages?.today ?? '—'}</dd><dt>过滤记录</dt><dd>{stats.moderation?.filtered ?? '—'}</dd></dl></section>
    <section className="overview-links"><h2>配置与管理</h2><div><Link href="/admin/quota-packages">充值套餐</Link><Link href="/admin/blocked-keywords">屏蔽关键词</Link><Link href="/admin/review-logs">审核记录</Link><Link href="/admin/accounts">管理员账号</Link></div></section>
  </div>;
}
