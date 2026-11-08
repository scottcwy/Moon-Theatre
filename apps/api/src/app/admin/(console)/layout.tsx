import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { AdminNavigation } from '../navigation.js';
import { LogoutButton } from '../forms.js';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // Redirect boundary only. Every child page keeps its own full guard before queries.
  const identity = await requireAdminPageAuth({ allowRestricted: true });
  if (!identity) redirect('/admin/login?notice=expired');
  if (identity.account.mustChangePassword) redirect('/admin/change-password');
  return <div className="admin-shell">
    <a className="skip-link" href="#admin-main">跳至主要内容</a>
    <aside className="sidebar"><Link className="brand" href="/admin">月满楼</Link><p className="subbrand">运营管理后台</p>
      <AdminNavigation /><p className="sidebar-foot">独立管理员身份<br />与小程序用户账号分离</p>
    </aside>
    <div className="workspace"><header className="topbar"><span>月满楼 / 运营管理</span><div className="identity-actions">
      <Link href="/admin/account" className="identity-email" aria-label={`我的账号：${identity.account.email}`}>{identity.account.email}</Link><LogoutButton />
    </div></header><main id="admin-main" className="content" tabIndex={-1}>{children}</main></div>
  </div>;
}
