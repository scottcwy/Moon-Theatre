import { listWalletAccounts, listWalletTransactions } from '@/server/modules/admin/index.js';

export default async function WalletPage() {
  let accounts: Awaited<ReturnType<typeof listWalletAccounts>>;
  let transactions: Awaited<ReturnType<typeof listWalletTransactions>>;

  try {
    [accounts, transactions] = await Promise.all([
      listWalletAccounts({ page: 1, pageSize: 30 }),
      listWalletTransactions({ page: 1, pageSize: 30 }),
    ]);
  } catch {
    return <div style={{ padding: '20px', color: '#ba1a1a' }}>Failed to load wallet data. Ensure the database is running.</div>;
  }

  const txTypeColors: Record<string, string> = {
    recharge: '#dde8d4',
    consume: '#ffdad6',
    adjust: '#ffdfa7',
  };

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px', color: '#1e1e2e' }}>Wallet</h1>

      <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px', color: '#1e1e2e' }}>Accounts</h2>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e6e6e6', overflow: 'auto', marginBottom: '32px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #e6e6e6' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>User</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Balance</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Recharged</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Consumed</th>
            </tr>
          </thead>
          <tbody>
            {accounts.items.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No wallet accounts found.</td>
              </tr>
            ) : (
              (accounts.items as Array<Record<string, unknown>>).map((a) => (
                <tr key={a.id as string} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '10px 12px' }}>{String((a.userName as string) || (a.userId as string).slice(0, 8))}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{a.balancePoints as number}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#3e6b47' }}>+{a.totalRechargedPoints as number}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#ba1a1a' }}>-{a.totalConsumedPoints as number}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px', color: '#1e1e2e' }}>Recent Transactions</h2>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e6e6e6', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #e6e6e6' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>User</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Type</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Amount</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>After</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {transactions.items.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No transactions found.</td>
              </tr>
            ) : (
              (transactions.items as Array<Record<string, unknown>>).map((t) => (
                <tr key={t.id as string} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '10px 12px' }}>{String((t.userName as string) || (t.userId as string).slice(0, 8))}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: '12px', fontSize: '11px',
                      background: txTypeColors[t.type as string] || '#f0f0f0',
                      color: '#333',
                    }}>
                      {t.type as string}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 500,
                    color: (t.type as string) === 'consume' ? '#ba1a1a' : '#3e6b47' }}>
                    {(t.type as string) === 'consume' ? '-' : '+'}{t.amount as number}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{t.balanceAfter as number}</td>
                  <td style={{ padding: '10px 12px', color: '#888', fontSize: '12px' }}>
                    {t.createdAt ? new Date(t.createdAt as string).toLocaleString() : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
