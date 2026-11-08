import { redirect } from 'next/navigation';
import { requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { safeAdminReturnPath } from '@/server/modules/admin/security.js';
import { CredentialForm } from '../forms.js';

const notices: Record<string, string> = {
  expired: '登录已失效或账号状态已变更，请重新登录。',
  'password-changed': '密码已修改，全部登录会话已退出。请使用新密码重新登录。',
  'email-changed': '邮箱已修改，全部登录会话已退出。请使用新邮箱重新登录。',
  'logged-out': '你已安全退出后台。',
};
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; notice?: string }> }) {
  const params = await searchParams;
  const next = safeAdminReturnPath(params.next);
  const identity = await requireAdminPageAuth({ allowRestricted: true });
  if (identity) redirect(identity.account.mustChangePassword ? `/admin/change-password?next=${encodeURIComponent(next)}` : next);
  return <main className="auth-stage"><div className="auth-panel">
    <section className="auth-brand"><div className="brand">月满楼</div><h2>运营管理后台</h2><p>管理员账号独立于小程序用户。<br />请使用已创建的邮箱账号登录。</p></section>
    <section className="auth-form"><h1>管理员登录</h1><p className="muted">使用邮箱与密码进入后台</p>
      {params.notice && notices[params.notice] && <p className="notice" role="status">{notices[params.notice]}</p>}
      <CredentialForm mode="login" endpoint="/api/admin/session" next={next} />
      <p className="muted recovery-help">无法登录时，请联系其他管理员重置密码。受保护账号失去访问权时，须由服务器恢复；不提供邮件找回或公开注册。</p>
    </section>
  </div></main>;
}
