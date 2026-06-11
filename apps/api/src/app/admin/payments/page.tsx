import { listPayments } from '@/server/modules/admin/index.js';

type PaymentRow = Record<string, unknown> & {
  id: string; provider: string; providerTransactionId: string | null;
  status: string; verifyResult: string; createdAt: string | null;
};

export default async function PaymentsPage() {
  let result: Awaited<ReturnType<typeof listPayments>>;
  try {
    result = await listPayments({ page: 1, pageSize: 50 });
  } catch {
    return <div style={{ padding: '20px', color: '#ba1a1a' }}>Failed to load payments. Ensure the database is running.</div>;
  }

  const statusColors: Record<string, string> = {
    pending: '#ffdfa7', success: '#dde8d4', failed: '#ffdad6', cancelled: '#f0f0f0',
  };

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px', color: '#1e1e2e' }}>Payment Records</h1>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e6e6e6', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #e6e6e6' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Provider</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Provider TX ID</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Verify</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No payments found.</td></tr>
            ) : (
              (result.items as PaymentRow[]).map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '10px 12px' }}>{p.provider}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '12px' }}>{p.providerTransactionId?.slice(0, 20) || '-'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '11px', background: statusColors[p.status] || '#f0f0f0', color: '#333' }}>{p.status}</span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>{p.verifyResult}</td>
                  <td style={{ padding: '10px 12px', color: '#888', fontSize: '12px' }}>{p.createdAt ? new Date(p.createdAt).toLocaleString() : '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: '12px', fontSize: '12px', color: '#888' }}>Total: {result.total} payments</p>
    </div>
  );
}
