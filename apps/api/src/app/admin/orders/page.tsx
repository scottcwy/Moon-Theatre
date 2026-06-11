import { listOrders } from '@/server/modules/admin/index.js';

type OrderRow = Record<string, unknown> & {
  id: string; userId: string; merchantOrderNo: string; amountCents: number;
  pointsAmount: number; status: string; createdAt: string | null;
  userName: string | null;
};

export default async function OrdersPage() {
  let result: Awaited<ReturnType<typeof listOrders>>;
  try {
    result = await listOrders({ page: 1, pageSize: 50 });
  } catch {
    return <div style={{ padding: '20px', color: '#ba1a1a' }}>Failed to load orders. Ensure the database is running.</div>;
  }

  const statusColors: Record<string, string> = {
    created: '#ffdfa7', prepay_created: '#ffdfa7', paid: '#dde8d4',
    credited: '#c8e6c9', closed: '#f0f0f0', failed: '#ffdad6', refunded: '#f0f0f0',
  };

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px', color: '#1e1e2e' }}>Orders</h1>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e6e6e6', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #e6e6e6' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>User</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Order #</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Amount</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Points</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No orders found.</td>
              </tr>
            ) : (
              (result.items as OrderRow[]).map((o) => (
                <tr key={o.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '10px 12px' }}>{String(o.userName || (o.userId as string).slice(0, 8))}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '12px' }}>{o.merchantOrderNo.slice(0, 16)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>¥{(o.amountCents / 100).toFixed(2)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{o.pointsAmount}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: '12px', fontSize: '11px',
                      background: statusColors[o.status as string] || '#f0f0f0', color: '#333',
                    }}>{o.status as string}</span>
                  </td>
                  <td style={{ padding: '10px 12px', color: '#888', fontSize: '12px' }}>
                    {o.createdAt ? new Date(o.createdAt).toLocaleString() : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: '12px', fontSize: '12px', color: '#888' }}>Total: {result.total} orders</p>
    </div>
  );
}
