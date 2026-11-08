import { AdminTable, adminStatus, formatAdminDate, LoadError } from '../../ui.js';
import { listPayments } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';

type PaymentRow = Record<string, unknown> & {
  id: string; provider: string; providerTransactionId: string | null;
  status: string; verifyResult: string; createdAt: string | null;
};

export default async function PaymentsPage() {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  let result: Awaited<ReturnType<typeof listPayments>>;
  try {
    result = await listPayments({ page: 1, pageSize: 50 });
  } catch {
    return <LoadError subject="支付记录" />;
  }

  return (
    <div>
      <h1>支付记录</h1>
      <AdminTable label="支付记录列表，可横向滚动" isEmpty={result.items.length === 0} emptyMessage="暂无支付记录。产生支付后可在此查看。">
        <table>
          <thead>
            <tr>
              <th scope="col">支付渠道</th>
              <th scope="col">渠道交易号</th>
              <th scope="col">状态</th>
              <th scope="col">验证结果</th>
              <th scope="col">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {
              (result.items as PaymentRow[]).map((p) => (
                <tr key={p.id}>
                  <td>{p.provider}</td>
                  <td className="identifier">{p.providerTransactionId?.slice(0, 20) || '-'}</td>
                  <td>
                    <span className="tag" data-status={p.status}>{adminStatus(p.status)}</span>
                  </td>
                  <td>{adminStatus(p.verifyResult)}</td>
                  <td>{p.createdAt ? formatAdminDate(p.createdAt) : '-'}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </AdminTable>
      <p>共 {result.total} 条支付记录，本页最多显示 50 条</p>
    </div>
  );
}
