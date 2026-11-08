import { AdminTable, adminStatus, formatAdminDate, LoadError } from '../../ui.js';
import { listWalletAccounts, listWalletTransactions } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';

export default async function WalletPage() {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  let accounts: Awaited<ReturnType<typeof listWalletAccounts>>;
  let transactions: Awaited<ReturnType<typeof listWalletTransactions>>;

  try {
    [accounts, transactions] = await Promise.all([
      listWalletAccounts({ page: 1, pageSize: 30 }),
      listWalletTransactions({ page: 1, pageSize: 30 }),
    ]);
  } catch {
    return <LoadError subject="钱包与流水" />;
  }

  return (
    <div>
      <h1>钱包与流水</h1>

      <h2>钱包账户</h2>
      <AdminTable label="钱包账户，可横向滚动" isEmpty={accounts.items.length === 0} emptyMessage="暂无钱包账户。玩家开通钱包后可在此查看。">
        <table>
          <thead>
            <tr>
              <th scope="col">玩家</th>
              <th scope="col" className="numeric">余额点数</th>
              <th scope="col" className="numeric">累计充值</th>
              <th scope="col" className="numeric">累计消费</th>
            </tr>
          </thead>
          <tbody>
            {
              (accounts.items as Array<Record<string, unknown>>).map((a) => (
                <tr key={a.id as string}>
                  <td>{String((a.userName as string) || (a.userId as string).slice(0, 8))}</td>
                  <td className="numeric">{a.balancePoints as number}</td>
                  <td className="numeric">+{a.totalRechargedPoints as number}</td>
                  <td className="numeric">-{a.totalConsumedPoints as number}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </AdminTable>

      <h2>近期流水</h2>
      <AdminTable label="近期流水，可横向滚动" isEmpty={transactions.items.length === 0} emptyMessage="暂无钱包流水。产生点数变动后可在此查看。">
        <table>
          <thead>
            <tr>
              <th scope="col">玩家</th>
              <th scope="col">类型</th>
              <th scope="col" className="numeric">金额</th>
              <th scope="col" className="numeric">变动后余额</th>
              <th scope="col">时间（北京时间）</th>
            </tr>
          </thead>
          <tbody>
            {
              (transactions.items as Array<Record<string, unknown>>).map((t) => (
                <tr key={t.id as string}>
                  <td>{String((t.userName as string) || (t.userId as string).slice(0, 8))}</td>
                  <td>
                    <span className="tag" data-status={t.type as string}>
                      {adminStatus(t.type as string)}
                    </span>
                  </td>
                  <td className="numeric">
                    {(t.type as string) === 'consume' ? '-' : '+'}{t.amount as number}
                  </td>
                  <td className="numeric">{t.balanceAfter as number}</td>
                  <td>
                    {t.createdAt ? formatAdminDate(t.createdAt as string) : '-'}
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </AdminTable>
    </div>
  );
}
