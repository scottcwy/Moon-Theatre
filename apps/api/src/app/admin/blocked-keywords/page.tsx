import { listBlockedKeywords } from '@/server/modules/admin/index.js';

export default async function BlockedKeywordsPage() {
  let keywords: Awaited<ReturnType<typeof listBlockedKeywords>>;
  try {
    keywords = await listBlockedKeywords();
  } catch {
    return <div style={{ padding: '20px', color: '#ba1a1a' }}>Failed to load blocked keywords. Ensure the database is running.</div>;
  }

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px', color: '#1e1e2e' }}>Blocked Keywords</h1>
      <p style={{ fontSize: '13px', color: '#888', marginBottom: '16px' }}>
        To add a keyword, use the API: <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: '4px' }}>POST /api/admin/blocked-keywords</code>
      </p>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e6e6e6', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #e6e6e6' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Keyword</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Category</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Enabled</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {keywords.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No blocked keywords found.</td></tr>
            ) : (
              (keywords as Array<Record<string, unknown>>).map((kw) => (
                <tr key={kw.id as string} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: '#ba1a1a' }}>{kw.keyword as string}</td>
                  <td style={{ padding: '10px 12px' }}>{(kw.category as string) || '-'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '11px', background: (kw.enabled as boolean) ? '#dde8d4' : '#f0f0f0', color: (kw.enabled as boolean) ? '#192517' : '#666' }}>
                      {kw.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', color: '#888', fontSize: '12px' }}>{kw.createdAt ? new Date(kw.createdAt as string).toLocaleString() : '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
