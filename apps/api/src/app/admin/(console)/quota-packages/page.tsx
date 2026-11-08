import { AdminTable, LoadError } from '../../ui.js';
import { listQuotaPackages } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';

export default async function QuotaPackagesPage() {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  let packages: Awaited<ReturnType<typeof listQuotaPackages>>;
  try {
    packages = await listQuotaPackages();
  } catch {
    return <LoadError subject="充值套餐" />;
  }

  return (
    <div>
      <h1>充值套餐</h1>
      <p>
        套餐配置通过现有接口维护： <code>PATCH /api/admin/quota-packages/[id]</code>
      </p>
      <AdminTable label="充值套餐列表，可横向滚动" isEmpty={packages.length === 0} emptyMessage="暂无充值套餐，请联系配置维护人员。">
        <table>
          <thead>
            <tr>
              <th scope="col">名称</th>
              <th scope="col" className="numeric">价格</th>
              <th scope="col" className="numeric">点数</th>
              <th scope="col">启用状态</th>
              <th scope="col">推荐</th>
              <th scope="col">排序</th>
            </tr>
          </thead>
          <tbody>
            {
              (packages as Array<Record<string, unknown>>).map((pkg) => (
                <tr key={pkg.id as string}>
                  <td>{pkg.name as string}</td>
                  <td className="numeric">¥{((pkg.priceCents as number) / 100).toFixed(2)}</td>
                  <td className="numeric">{pkg.points as number}</td>
                  <td>
                    <span className="tag" data-status={pkg.active ? 'active' : 'inactive'}>
                      {pkg.active ? '已启用' : '未启用'}
                    </span>
                  </td>
                  <td>{pkg.recommended ? '是' : '否'}</td>
                  <td>{pkg.sortOrder as number}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </AdminTable>
    </div>
  );
}
