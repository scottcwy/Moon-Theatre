import { listSessions } from '@/server/modules/admin/index.js';

interface SessionRow {
  id: string;
  userId: string;
  characterId: string;
  title: string | null;
  modelTier: string;
  status: string;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  characterName: string | null;
  userName: string | null;
}

export default async function SessionsPage() {
  let sessions: Awaited<ReturnType<typeof listSessions>>;
  try {
    sessions = await listSessions({ page: 1, pageSize: 50 });
  } catch {
    return <div style={{ padding: '20px', color: '#ba1a1a' }}>Failed to load sessions. Ensure the database is running.</div>;
  }

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px', color: '#1e1e2e' }}>Sessions</h1>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e6e6e6', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #e6e6e6' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>User</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Character</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Model Tier</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {sessions.items.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No sessions found.</td>
              </tr>
            ) : (
              sessions.items.map((row) => {
                const s = row as SessionRow;
                return (
                <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '10px 12px' }}>{s.userName || s.userId?.slice(0, 8)}</td>
                  <td style={{ padding: '10px 12px' }}>{s.characterName || s.characterId?.slice(0, 8)}</td>
                  <td style={{ padding: '10px 12px' }}>{s.modelTier}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: '12px', fontSize: '11px',
                      background: s.status === 'active' ? '#dde8d4' : '#f0f0f0',
                      color: s.status === 'active' ? '#192517' : '#666',
                    }}>
                      {s.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', color: '#888', fontSize: '12px' }}>
                    {s.updatedAt ? new Date(s.updatedAt as string).toLocaleString() : '-'}
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: '12px', fontSize: '12px', color: '#888' }}>
        Total: {sessions.total} sessions (showing {sessions.items.length})
      </p>
    </div>
  );
}
