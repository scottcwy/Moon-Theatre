import { listQuotaPackages } from '@/server/modules/admin/index.js';

export default async function QuotaPackagesPage() {
  let packages: Awaited<ReturnType<typeof listQuotaPackages>>;
  try {
    packages = await listQuotaPackages();
  } catch {
    return <div style={{ padding: '20px', color: '#ba1a1a' }}>Failed to load quota packages. Ensure the database is running.</div>;
  }

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px', color: '#1e1e2e' }}>Quota Packages</h1>
      <p style={{ fontSize: '13px', color: '#888', marginBottom: '16px' }}>
        To update a package, use the API: <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: '4px' }}>PATCH /api/admin/quota-packages/[id]</code>
      </p>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e6e6e6', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #e6e6e6' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Name</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Price</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Points</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Active</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Recommended</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Sort</th>
            </tr>
          </thead>
          <tbody>
            {packages.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No quota packages found.</td></tr>
            ) : (
              (packages as Array<Record<string, unknown>>).map((pkg) => (
                <tr key={pkg.id as string} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{pkg.name as string}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>¥{((pkg.priceCents as number) / 100).toFixed(2)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{pkg.points as number}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '11px', background: (pkg.active as boolean) ? '#dde8d4' : '#f0f0f0', color: (pkg.active as boolean) ? '#192517' : '#666' }}>
                      {pkg.active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>{pkg.recommended ? '★ Yes' : 'No'}</td>
                  <td style={{ padding: '10px 12px' }}>{pkg.sortOrder as number}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
