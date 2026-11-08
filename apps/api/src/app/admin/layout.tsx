import './admin.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: '月满楼 · 运营管理后台' };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-root">{children}</div>;
}
