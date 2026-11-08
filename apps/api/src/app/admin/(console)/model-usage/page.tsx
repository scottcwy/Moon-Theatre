import { AdminTable, adminStatus, formatAdminDate, LoadError } from '../../ui.js';
import { listModelUsageLogs } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';

export default async function ModelUsagePage() {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  let result: Awaited<ReturnType<typeof listModelUsageLogs>>;
  try {
    result = await listModelUsageLogs({ page: 1, pageSize: 50 });
  } catch {
    return <LoadError subject="模型用量" />;
  }

  return (
    <div>
      <h1>模型用量</h1>
      <AdminTable label="模型用量记录，可横向滚动" isEmpty={result.items.length === 0} emptyMessage="暂无模型用量。产生模型调用后可在此查看。">
        <table>
          <thead>
            <tr>
              <th scope="col">玩家</th>
              <th scope="col">角色</th>
              <th scope="col">模型</th>
              <th scope="col">档位</th>
              <th scope="col" className="numeric">点数</th>
              <th scope="col">状态</th>
              <th scope="col">时间（北京时间）</th>
            </tr>
          </thead>
          <tbody>
            {
              (result.items as Array<Record<string, unknown>>).map((m) => (
                <tr key={m.id as string}>
                  <td>{String((m.userName as string) || (m.userId as string).slice(0, 8))}</td>
                  <td>{String((m.characterName as string) || (m.characterId as string).slice(0, 8))}</td>
                  <td className="identifier">{m.modelName as string}</td>
                  <td>{adminStatus(m.modelTier as string)}</td>
                  <td className="numeric">{m.pointsConsumed as number}</td>
                  <td>
                    <span className="tag" data-status={m.status as string}>{adminStatus(m.status as string)}</span>
                  </td>
                  <td>{m.createdAt ? formatAdminDate(m.createdAt as string) : '-'}</td>
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
