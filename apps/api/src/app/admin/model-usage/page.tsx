import { listModelUsageLogs } from '@/server/modules/admin/index.js';

export default async function ModelUsagePage() {
  let result: Awaited<ReturnType<typeof listModelUsageLogs>>;
  try {
    result = await listModelUsageLogs({ page: 1, pageSize: 50 });
  } catch {
    return <div style={{ padding: '20px', color: '#ba1a1a' }}>Failed to load model usage logs. Ensure the database is running.</div>;
  }

  const statusColors: Record<string, string> = {
    success: '#dde8d4', failed: '#ffdad6', filtered: '#ffdfa7',
  };

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px', color: '#1e1e2e' }}>Model Usage Logs</h1>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e6e6e6', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #e6e6e6' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>User</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Character</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Model</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Tier</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Points</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No model usage logs found.</td></tr>
            ) : (
              (result.items as Array<Record<string, unknown>>).map((m) => (
                <tr key={m.id as string} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '10px 12px' }}>{String((m.userName as string) || (m.userId as string).slice(0, 8))}</td>
                  <td style={{ padding: '10px 12px' }}>{String((m.characterName as string) || (m.characterId as string).slice(0, 8))}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '12px' }}>{m.modelName as string}</td>
                  <td style={{ padding: '10px 12px' }}>{m.modelTier as string}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#ba1a1a' }}>{m.pointsConsumed as number}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '11px', background: statusColors[m.status as string] || '#f0f0f0', color: '#333' }}>{m.status as string}</span>
                  </td>
                  <td style={{ padding: '10px 12px', color: '#888', fontSize: '12px' }}>{m.createdAt ? new Date(m.createdAt as string).toLocaleString() : '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: '12px', fontSize: '12px', color: '#888' }}>Total: {result.total} logs</p>
    </div>
  );
}
