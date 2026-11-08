import Link from 'next/link';
import { listAdminAccounts } from '@/server/modules/admin/accounts.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { CredentialForm, DisableAccount, PasswordPolicy } from '../../forms.js';
import { AdminTable, formatAdminDate, LoadError } from '../../ui.js';

export default async function AccountsPage() {
  const identity = await requireAdminPageAuth();
  if (!identity) return <AdminIdentityRequired />;
  let accounts: Awaited<ReturnType<typeof listAdminAccounts>>;
  try { accounts = await listAdminAccounts(identity); }
  catch { return <LoadError subject="管理员账号" />; }
  return <div><div className="page-heading"><div><h1>管理员账号</h1><p className="page-description">维护独立登录账号，查看账号状态与首次改密要求。</p></div><a className="button primary" href="#create-account">创建管理员</a></div>
    <AdminTable label="管理员账号列表" isEmpty={accounts.length === 0} emptyMessage="暂无管理员账号。可在下方创建普通管理员；若账号状态异常，请联系服务器维护人员。"><table><thead><tr><th scope="col">邮箱 / 身份</th><th scope="col">账号状态</th><th scope="col">密码状态</th><th scope="col">创建时间</th><th scope="col">操作</th></tr></thead><tbody>
      {accounts.map(account => {
        const self = account.id === identity.adminAccountId;
        const reason = account.isProtected ? '受保护账号不能被重置或停用' : self ? '请在“我的账号”修改密码；不能停用自己' : '';
        return <tr key={account.id} data-account-id={account.id}>
          <td><strong className="account-email">{account.email}</strong><span className="under">{self ? '当前登录账号' : account.isProtected ? '受保护账号' : '普通管理员'}{self && account.isProtected ? ' · 受保护' : ''}</span></td>
          <td><span className={`tag ${account.active ? 'ok' : 'neutral'}`}>{account.active ? '正常' : '已停用'}</span></td>
          <td><span className={`tag ${account.mustChangePassword ? 'warn' : 'neutral'}`}>{account.mustChangePassword ? '登录须改密' : '已设置密码'}</span></td>
          <td>{formatAdminDate(account.createdAt)}</td><td className="account-actions">
            {reason ? <><button disabled title={reason}>重置密码</button><button disabled title={reason}>停用</button><p className="muted">{reason}</p>{self && <Link href="/admin/account">管理我的账号</Link>}</> : <>
              <details><summary>重置密码</summary><div className="action-disclosure"><p className="muted">全部会话将失效，下次登录须修改临时密码。重置不会启用已停用账号。</p><CredentialForm mode="reset" endpoint={`/api/admin/accounts/${encodeURIComponent(account.id)}/reset-password`} /></div></details>
              {account.active ? <details><summary>停用账号</summary><div className="action-disclosure"><DisableAccount id={account.id} /></div></details> : <p className="muted">已停用，恢复登录须由服务器处理。</p>}
            </>}
          </td></tr>;
      })}
    </tbody></table></AdminTable><p className="muted table-total">共 {accounts.length} 个账号 · 账号与审计记录保留，不提供删除或网页启用操作。</p>
    <section id="create-account" className="panel create-account"><h2>创建管理员</h2><p className="muted">普通管理员拥有现有后台权限，邮箱创建后不可修改。请安全传递临时密码；首次登录必须改密。</p><PasswordPolicy />
      <CredentialForm mode="create" endpoint="/api/admin/accounts" />
    </section>
  </div>;
}
