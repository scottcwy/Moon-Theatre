'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavigationItem {
  href: string;
  label: string;
  /** Optional heading rendered above this entry. */
  group?: string;
  /** Overview must match exactly so it is not highlighted on every nested page. */
  exact?: boolean;
}

const items: NavigationItem[] = [
  { href: '/admin', label: '运营概览', exact: true },
  { href: '/admin/characters', label: '角色卡片' },
  { href: '/admin/users', label: '用户管理', group: '玩家' },
  { href: '/admin/sessions', label: '玩家会话', group: '交易与内容' },
  { href: '/admin/orders', label: '订单记录' },
  { href: '/admin/payments', label: '支付记录' },
  { href: '/admin/wallet', label: '钱包与流水' },
  { href: '/admin/quota-packages', label: '充值套餐' },
  { href: '/admin/models', label: '模型档位' },
  { href: '/admin/model-usage', label: '模型用量' },
  { href: '/admin/blocked-keywords', label: '屏蔽关键词' },
  { href: '/admin/review-logs', label: '审核记录' },
  { href: '/admin/accounts', label: '管理员账号', group: '后台管理' },
  { href: '/admin/account', label: '我的账号' },
];

export function AdminNavigation() {
  const pathname = usePathname();
  return <nav aria-label="后台导航">{items.map(item => <div key={item.href}>
    {item.group && <p className="nav-label">{item.group}</p>}
    <Link
      href={item.href}
      aria-current={item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`) ? 'page' : undefined}
    >{item.label}</Link>
  </div>)}</nav>;
}
