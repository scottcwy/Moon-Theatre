import { listAdminMemories } from '@/server/modules/memory/index.js';

export default async function AdminMemoriesPage() {
  const memories = await listAdminMemories({ page: 1, pageSize: 50 });

  return (
    <div>
      <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px', color: '#242624' }}>Memories</h1>
      <p style={{ color: '#666b63', marginBottom: '16px', fontSize: '14px' }}>
        Review extracted memories. Use <code style={{ background: '#f0f0f0', padding: '2px 4px' }}>PATCH /api/admin/memories/:id</code> to disable or correct a memory.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '12px', overflow: 'hidden' }}>
        <thead>
          <tr style={{ background: '#f1f1f1', textAlign: 'left' }}>
            <th style={{ padding: '12px', fontSize: '13px' }}>User</th>
            <th style={{ padding: '12px', fontSize: '13px' }}>Character</th>
            <th style={{ padding: '12px', fontSize: '13px' }}>Type</th>
            <th style={{ padding: '12px', fontSize: '13px' }}>Content</th>
            <th style={{ padding: '12px', fontSize: '13px' }}>Status</th>
            <th style={{ padding: '12px', fontSize: '13px' }}>Updated</th>
          </tr>
        </thead>
        <tbody>
          {memories.items.map((memory) => (
            <tr key={String(memory.id)} style={{ borderTop: '1px solid #e6e6e6' }}>
              <td style={{ padding: '12px', fontSize: '13px' }}>{String(memory.userName ?? memory.userId)}</td>
              <td style={{ padding: '12px', fontSize: '13px' }}>{String(memory.characterName ?? memory.characterId)}</td>
              <td style={{ padding: '12px', fontSize: '13px' }}>{String(memory.type)}</td>
              <td style={{ padding: '12px', fontSize: '13px', maxWidth: '520px' }}>{String(memory.content)}</td>
              <td style={{ padding: '12px', fontSize: '13px' }}>{memory.enabled ? 'enabled' : 'disabled'}</td>
              <td style={{ padding: '12px', fontSize: '13px' }}>{new Date(String(memory.updatedAt)).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
