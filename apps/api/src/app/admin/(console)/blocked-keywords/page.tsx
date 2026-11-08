import { AdminTable, formatAdminDate, LoadError } from '../../ui.js';
import { listBlockedKeywords } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';

export default async function BlockedKeywordsPage() {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  let keywords: Awaited<ReturnType<typeof listBlockedKeywords>>;
  try {
    keywords = await listBlockedKeywords();
  } catch {
    return <LoadError subject="屏蔽关键词" />;
  }

  return (
    <div>
      <h1>屏蔽关键词</h1>
      <p>
        关键词通过现有接口添加： <code>POST /api/admin/blocked-keywords</code>
      </p>
      <AdminTable label="屏蔽关键词列表，可横向滚动" isEmpty={keywords.length === 0} emptyMessage="暂无屏蔽关键词。当前没有已配置的过滤条目。">
        <table>
          <thead>
            <tr>
              <th scope="col">关键词</th>
              <th scope="col">分类</th>
              <th scope="col">启用状态</th>
              <th scope="col">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {
              (keywords as Array<Record<string, unknown>>).map((kw) => (
                <tr key={kw.id as string}>
                  <td className="identifier">{kw.keyword as string}</td>
                  <td>{(kw.category as string) || '-'}</td>
                  <td>
                    <span className="tag" data-status={kw.enabled ? 'active' : 'inactive'}>
                      {kw.enabled ? '已启用' : '未启用'}
                    </span>
                  </td>
                  <td>{kw.createdAt ? formatAdminDate(kw.createdAt as string) : '-'}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </AdminTable>
    </div>
  );
}
