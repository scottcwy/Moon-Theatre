import Link from 'next/link';

export const dynamic = 'force-dynamic';

const navItems = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/sessions', label: 'Sessions' },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/payments', label: 'Payments' },
  { href: '/admin/wallet', label: 'Wallet' },
  { href: '/admin/quota-packages', label: 'Quota Packages' },
  { href: '/admin/model-usage', label: 'Model Usage' },
  { href: '/admin/memories', label: 'Memories' },
  { href: '/admin/blocked-keywords', label: 'Blocked Keywords' },
  { href: '/admin/review-logs', label: 'Review Logs' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <aside
        style={{
          width: '220px',
          background: '#242624',
          color: '#eff1ed',
          padding: '16px 0',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '0 16px 16px', fontSize: '18px', fontWeight: 700, color: '#f1d08a' }}>
          剧本杀 Admin
        </div>
        <nav>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'block',
                padding: '10px 16px',
                color: '#eff1ed',
                textDecoration: 'none',
                fontSize: '14px',
                borderLeft: '3px solid transparent',
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main style={{ flex: 1, padding: '24px', background: '#f5f5f5' }}>{children}</main>
    </div>
  );
}
