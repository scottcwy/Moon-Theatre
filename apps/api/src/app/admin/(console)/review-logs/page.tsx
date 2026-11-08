import { AdminTable, adminStatus, formatAdminDate, LoadError } from '../../ui.js';
import { listReviewLogs } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';

export default async function ReviewLogsPage() {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  let result: Awaited<ReturnType<typeof listReviewLogs>>;
  try {
    result = await listReviewLogs({ page: 1, pageSize: 50 });
  } catch {
    return <LoadError subject="审核记录" />;
  }


  return (
    <div>
      <h1>审核记录</h1>
      <p>
        审核通过现有接口登记： <code>POST /api/admin/review</code>
      </p>
      <AdminTable label="审核记录列表，可横向滚动" isEmpty={result.items.length === 0} emptyMessage="暂无审核记录。产生审核记录后可在此查看。">
        <table>
          <thead>
            <tr>
              <th scope="col">会话</th>
              <th scope="col">消息</th>
              <th scope="col">审核人</th>
              <th scope="col">状态</th>
              <th scope="col">备注</th>
              <th scope="col">时间（北京时间）</th>
            </tr>
          </thead>
          <tbody>
            {
              (result.items as Array<Record<string, unknown>>).map((r) => (
                <tr key={r.id as string}>
                  <td className="identifier">{(r.sessionId as string).slice(0, 8)}</td>
                  <td className="identifier">{(r.messageId as string)?.slice(0, 8) || '-'}</td>
                  <td className="identifier">{r.reviewerAdminAccountId ? <>管理员 {r.reviewerAdminAccountId as string}</> : r.reviewerId ? <>历史用户 {r.reviewerId as string}</> : '—'}</td>
                  <td>
                    <span className="tag" data-status={r.status as string}>{adminStatus(r.status as string)}</span>
                  </td>
                  <td className="note-cell">{(r.note as string) || '-'}</td>
                  <td>{r.createdAt ? formatAdminDate(r.createdAt as string) : '-'}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </AdminTable>
      <p>共 {result.total} 条记录，本页最多显示 50 条</p>
    </div>
  );
}
