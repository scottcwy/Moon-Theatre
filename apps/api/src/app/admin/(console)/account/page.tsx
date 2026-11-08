import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { CredentialForm, PasswordPolicy } from '../../forms.js';

export default async function MyAccountPage() {
  const identity = await requireAdminPageAuth();
  if (!identity) return <AdminIdentityRequired />;
  const { account } = identity;
  return <div><h1>我的账号</h1><p className="page-description">管理自己的登录凭据。修改密码或邮箱后，需要重新登录。</p>
    <section className="panel account-summary"><h2>账号信息</h2><dl>
      <dt>邮箱</dt><dd className="account-email">{account.email}</dd><dt>账号状态</dt><dd>正常{account.isProtected ? ' · 受保护账号' : ''}</dd>
      <dt>邮箱修改</dt><dd>{account.isProtected ? '仅本人验证当前密码后可修改' : '普通管理员邮箱创建后不可修改'}</dd>
    </dl>{account.isProtected && <p className="notice warning">受保护账号不能被任何管理员停用或重置密码。若无法登录，请通过服务器恢复。</p>}</section>
    <div className="account-forms"><section className="panel"><h2>修改密码</h2><PasswordPolicy />
      <CredentialForm mode="password" endpoint="/api/admin/account/password" email={account.email} next="/admin/account" />
      <p className="muted">修改后全部设备的登录会话立即失效。</p>
    </section>{account.isProtected && <section className="panel"><h2>修改受保护账号邮箱</h2><p className="muted">新邮箱须未被其他管理员使用。修改后全部会话失效，请使用新邮箱重新登录。</p>
      <CredentialForm mode="email" endpoint="/api/admin/account/email" email={account.email} next="/admin/account" />
    </section>}</div>
  </div>;
}
