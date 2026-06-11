import { listReviewLogs } from '@/server/modules/admin/index.js';

export default async function ReviewLogsPage() {
  let result: Awaited<ReturnType<typeof listReviewLogs>>;
  try {
    result = await listReviewLogs({ page: 1, pageSize: 50 });
  } catch {
    return <div style={{ padding: '20px', color: '#ba1a1a' }}>Failed to load review logs. Ensure the database is running.</div>;
  }

  const statusColors: Record<string, string> = {
    normal: '#dde8d4', flagged: '#ffdad6', resolved: '#c8e6c9',
  };

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px', color: '#1e1e2e' }}>Review Logs</h1>
      <p style={{ fontSize: '13px', color: '#888', marginBottom: '16px' }}>
        To create a review, use the API: <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: '4px' }}>POST /api/admin/review</code>
      </p>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e6e6e6', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #e6e6e6' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Session</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Message</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Reviewer</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Note</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No review logs found.</td></tr>
            ) : (
              (result.items as Array<Record<string, unknown>>).map((r) => (
                <tr key={r.id as string} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '12px' }}>{(r.sessionId as string).slice(0, 8)}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '12px' }}>{(r.messageId as string)?.slice(0, 8) || '-'}</td>
                  <td style={{ padding: '10px 12px' }}>{(r.reviewerId as string) || '-'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '11px', background: statusColors[r.status as string] || '#f0f0f0', color: '#333' }}>{r.status as string}</span>
                  </td>
                  <td style={{ padding: '10px 12px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(r.note as string) || '-'}</td>
                  <td style={{ padding: '10px 12px', color: '#888', fontSize: '12px' }}>{r.createdAt ? new Date(r.createdAt as string).toLocaleString() : '-'}</td>
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
