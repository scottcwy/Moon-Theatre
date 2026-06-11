import Link from 'next/link';

const sections = [
  { href: '/admin/sessions', title: 'Sessions', description: 'View chat sessions and messages', count: 'All sessions' },
  { href: '/admin/orders', title: 'Orders', description: 'View and manage orders', count: 'All orders' },
  { href: '/admin/payments', title: 'Payments', description: 'View payment records', count: 'All payments' },
  { href: '/admin/wallet', title: 'Wallet', description: 'View wallet accounts and transactions', count: 'All accounts' },
  { href: '/admin/quota-packages', title: 'Quota Packages', description: 'Configure quota package pricing and points', count: '3 packages' },
  { href: '/admin/model-usage', title: 'Model Usage', description: 'View model call logs and consumption', count: 'All logs' },
  { href: '/admin/blocked-keywords', title: 'Blocked Keywords', description: 'Manage content filtering keywords', count: 'Keyword list' },
  { href: '/admin/review-logs', title: 'Review Logs', description: 'View flagged content and review records', count: 'All logs' },
];

export default function AdminDashboard() {
  return (
    <div>
      <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px', color: '#242624' }}>Admin Dashboard</h1>
      <p style={{ color: '#666b63', marginBottom: '24px', fontSize: '14px' }}>
        V1 admin: view sessions, orders, payments, wallet, model usage, blocked keywords, and review logs.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            style={{
              display: 'block',
              padding: '20px',
              background: '#fff',
              borderRadius: '12px',
              border: '1px solid #e6e6e6',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px', color: '#242624' }}>{section.title}</h2>
            <p style={{ fontSize: '13px', color: '#666b63', marginBottom: '8px' }}>{section.description}</p>
            <span style={{ fontSize: '12px', color: '#8a6100', fontWeight: 500 }}>{section.count} →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
