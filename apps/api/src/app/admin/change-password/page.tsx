import { redirect } from 'next/navigation';
import { requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { safeAdminReturnPath } from '@/server/modules/admin/security.js';
import { CredentialForm, LogoutButton, PasswordPolicy } from '../forms.js';

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const identity = await requireAdminPageAuth({ allowRestricted: true });
  if (!identity) redirect('/admin/login?notice=expired');
  const next = safeAdminReturnPath((await searchParams).next);
  return <main className="auth-stage"><div className="auth-panel">
    <section className="auth-brand"><div className="brand">月满楼</div><h2>保护后台访问</h2><p>临时密码只用于首次验证。<br />修改后，请使用新密码重新登录。</p></section>
    <section className="auth-form"><h1>修改密码</h1><p className="account-email">{identity.account.email}</p>
      {identity.account.mustChangePassword && <p className="notice warning">当前账号须先修改临时密码，才能访问运营数据。</p>}
      <PasswordPolicy /><CredentialForm mode="password" endpoint="/api/admin/account/password" email={identity.account.email} next={next} />
      <p className="muted">修改成功后，包含当前会话在内的全部会话立即失效，不会自动登录。</p><LogoutButton />
    </section>
  </div></main>;
}
