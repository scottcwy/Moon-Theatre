import { listQuotaPackages } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { AdminTable, LoadError } from '../../ui.js';
import { PackageCreateForm, QuotaPackageEditor } from '../../quota-packages-forms.js';
import {
  QUOTA_PACKAGE_EMPTY,
  QUOTA_PACKAGE_OFFLINE_NOTE,
  QUOTA_PACKAGE_ORDER_NOTE,
  availabilityLabel,
} from '../../quota-package-copy.js';
import { centsToYuanInput, quotaPackageEditorKey } from '../../quota-package-patch.js';

/**
 * Package maintenance (AC-13). The list shows the stored values; the editor below it is the only
 * place a mutation happens, and every save is an explicit button press. The note above states the
 * invariant the tests pin: a price/points change never rewrites an existing order.
 */
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
      <p className="page-description">
        维护玩家可购买的充值套餐：创建、改名、调价、调整点数与排序、上下架。所有价格使用整数分保存，金额以元展示。
      </p>

      <div className="notice" role="note">
        <p>{QUOTA_PACKAGE_ORDER_NOTE}</p>
        <p>{QUOTA_PACKAGE_OFFLINE_NOTE}</p>
      </div>

      <section className="panel" aria-labelledby="package-create">
        <h2 id="package-create">新建套餐</h2>
        <PackageCreateForm />
      </section>

      <h2>当前套餐</h2>
      <AdminTable label="充值套餐列表，可横向滚动" isEmpty={packages.length === 0} emptyMessage={QUOTA_PACKAGE_EMPTY}>
        <table>
          <thead>
            <tr>
              <th scope="col">名称</th>
              <th scope="col" className="numeric">价格</th>
              <th scope="col" className="numeric">点数</th>
              <th scope="col">状态</th>
              <th scope="col">推荐</th>
              <th scope="col" className="numeric">排序</th>
              <th scope="col">维护</th>
            </tr>
          </thead>
          <tbody>
            {packages.map(pkg => (
              <tr key={pkg.id} data-package-id={pkg.id}>
                <td>{pkg.name}</td>
                <td className="numeric">¥{centsToYuanInput(pkg.priceCents)}</td>
                <td className="numeric">{pkg.points}</td>
                <td><span className="tag" data-status={pkg.active ? 'active' : 'inactive'}>{availabilityLabel(pkg.active)}</span></td>
                <td>{pkg.recommended ? '是' : '否'}</td>
                <td className="numeric">{pkg.sortOrder}</td>
                <td><a href={`#package-${pkg.id}`}>编辑</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </AdminTable>

      {packages.length > 0 && <section aria-labelledby="package-edit">
        <h2 id="package-edit">编辑套餐</h2>
        {packages.map(pkg => (
          <article className="panel" id={`package-${pkg.id}`} key={quotaPackageEditorKey(pkg)}>
            <QuotaPackageEditor quotaPackage={pkg} />
          </article>
        ))}
      </section>}
    </div>
  );
}
