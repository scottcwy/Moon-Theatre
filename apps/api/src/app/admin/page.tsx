import Link from 'next/link';
import { getAdminStats } from '@/server/modules/admin/index.js';

type MetricKey = 'sessions' | 'orders' | 'payments' | 'wallet' | 'modelUsage';
type DashboardSection = {
  href: string;
  title: string;
  description: string;
  metric?: MetricKey;
  count?: string;
};

const sections: DashboardSection[] = [
  { href: '/admin/sessions', title: 'Sessions', description: 'View chat sessions and messages', metric: 'sessions' },
  { href: '/admin/orders', title: 'Orders', description: 'View and manage orders', metric: 'orders' },
  { href: '/admin/payments', title: 'Payments', description: 'View payment records', metric: 'payments' },
  { href: '/admin/wallet', title: 'Wallet', description: 'View wallet accounts and transactions', metric: 'wallet' },
  { href: '/admin/quota-packages', title: 'Quota Packages', description: 'Configure quota package pricing and points', count: '3 packages' },
  { href: '/admin/model-usage', title: 'Model Usage', description: 'View model call logs and consumption', metric: 'modelUsage' },
  { href: '/admin/memories', title: 'Memories', description: 'Review, disable, and correct extracted memories', count: 'Admin memory list' },
  { href: '/admin/blocked-keywords', title: 'Blocked Keywords', description: 'Manage content filtering keywords', count: 'Keyword list' },
  { href: '/admin/review-logs', title: 'Review Logs', description: 'View flagged content and review records', count: 'All logs' },
];

export default async function AdminDashboard() {
  const stats = await getAdminStats();
  const metricLabels: Record<MetricKey, string> = {
    sessions: `${stats.sessions.total} sessions`,
    orders: `${stats.orders.total} orders`,
    payments: `¥${(stats.payments.paidAmountCents / 100).toFixed(2)} paid`,
    wallet: `${stats.wallet.balancePoints} points`,
    modelUsage: `${stats.modelUsage.total} calls`,
  };

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
            <span style={{ fontSize: '12px', color: '#8a6100', fontWeight: 500 }}>
              {section.metric ? metricLabels[section.metric] : section.count} →
            </span>
          </Link>
        ))}
      </div>
      <div style={{ marginTop: '24px', fontSize: '13px', color: '#666b63' }}>
        Users: {stats.users.total} total / {stats.users.today} today · Messages: {stats.messages.total} total / {stats.messages.today} today · Filtered: {stats.moderation.filtered}
      </div>
    </div>
  );
}
