import { AdminTable, adminStatus, formatAdminDate, LoadError } from '../../ui.js';
import { listOrders } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';

type OrderRow = Record<string, unknown> & {
  id: string; userId: string; merchantOrderNo: string; amountCents: number;
  pointsAmount: number; status: string; createdAt: string | null;
  userName: string | null;
};

export default async function OrdersPage() {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  let result: Awaited<ReturnType<typeof listOrders>>;
  try {
    result = await listOrders({ page: 1, pageSize: 50 });
  } catch {
    return <LoadError subject="订单记录" />;
  }

  return (
    <div>
      <h1>订单记录</h1>
      <AdminTable label="订单记录列表，可横向滚动" isEmpty={result.items.length === 0} emptyMessage="暂无订单记录。玩家创建订单后可在此查看。">
        <table>
          <thead>
            <tr>
              <th scope="col">玩家</th>
              <th scope="col">订单号</th>
              <th scope="col" className="numeric">金额</th>
              <th scope="col" className="numeric">点数</th>
              <th scope="col">状态</th>
              <th scope="col">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {
              (result.items as OrderRow[]).map((o) => (
                <tr key={o.id}>
                  <td>{String(o.userName || (o.userId as string).slice(0, 8))}</td>
                  <td className="identifier">{o.merchantOrderNo.slice(0, 16)}</td>
                  <td className="numeric">¥{(o.amountCents / 100).toFixed(2)}</td>
                  <td className="numeric">{o.pointsAmount}</td>
                  <td>
                    <span className="tag" data-status={o.status}>{adminStatus(o.status as string)}</span>
                  </td>
                  <td>
                    {o.createdAt ? formatAdminDate(o.createdAt) : '-'}
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </AdminTable>
      <p>共 {result.total} 条订单，本页最多显示 50 条</p>
    </div>
  );
}
