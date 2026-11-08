'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminRequest, AdminRequestError, passwordConfirmationError } from './request.js';

type Mode = 'login' | 'create' | 'reset' | 'password' | 'email';
const labels: Record<Mode, string> = { login: '登录后台', create: '创建管理员', reset: '确认重置密码', password: '修改密码并退出', email: '修改邮箱并退出' };
export function CredentialForm({ mode, endpoint, next = '/admin', email = '' }: { mode: Mode; endpoint: string; next?: string; email?: string }) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!retryAt) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    tick(); const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || Date.now() < retryAt) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (key: string) => String(data.get(key) ?? '');
    setError(''); setSuccess('');
    if (mode !== 'login' && mode !== 'email') {
      const validation = passwordConfirmationError(value('newPassword'), value('confirmation'));
      if (validation) { setError(validation); return; }
    }
    const body = mode === 'login' ? { email: value('email').trim().toLowerCase(), password: value('password') }
      : mode === 'create' ? { email: value('email').trim().toLowerCase(), password: value('newPassword') }
      : mode === 'reset' ? { password: value('newPassword') }
      : mode === 'password' ? { currentPassword: value('currentPassword'), newPassword: value('newPassword') }
      : { email: value('email').trim().toLowerCase(), currentPassword: value('currentPassword') };
    busy.current = true; setPending(true);
    try {
      const result = await adminRequest<{ mustChangePassword?: boolean }>(endpoint, mode === 'email' ? 'PATCH' : 'POST', body);
      form.reset();
      if (mode === 'login') {
        window.location.assign(result.mustChangePassword ? `/admin/change-password?next=${encodeURIComponent(next)}` : next);
      } else if (mode === 'password' || mode === 'email') {
        window.location.assign(`/admin/login?notice=${mode === 'password' ? 'password-changed' : 'email-changed'}&next=${encodeURIComponent(next)}`);
      } else {
        setSuccess(mode === 'create' ? '管理员已创建。请安全告知对方临时密码；首次登录须修改密码。' : '密码已重置，全部会话已失效。对方下次登录须修改密码；停用状态不会改变。');
        router.refresh();
      }
    } catch (cause) {
      const failure = cause instanceof AdminRequestError ? cause : new AdminRequestError('操作未完成，请稍后重试。');
      setError(failure.message);
      if (failure.retryAfter) { setRetryAt(Date.now() + failure.retryAfter * 1000); setRemaining(failure.retryAfter); }
      if (failure.redirectTo) { form.reset(); window.location.assign(failure.redirectTo); }
    } finally { busy.current = false; setPending(false); }
  }
  const newPassword = mode === 'create' || mode === 'reset' || mode === 'password';
  // `method="post"` is a safety net, not the submit path: React handles submit. Without it a
  // native submit (page still hydrating, or the bundle failed) would GET the credentials into the
  // URL, the server log and the Referer. Nothing here is ever submitted natively.
  return <form method="post" onSubmit={submit} className="credential-form" aria-label={labels[mode]} aria-busy={pending}>
    <fieldset disabled={pending}>
      {(mode === 'login' || mode === 'create' || mode === 'email') && <label>邮箱
        <input name="email" type="email" autoComplete="username" required maxLength={254} defaultValue={email} spellCheck={false} autoCapitalize="none" />
      </label>}
      {mode === 'login' && <label>密码<input name="password" type="password" autoComplete="current-password" required /></label>}
      {(mode === 'password' || mode === 'email') && <>
        <input type="text" name="username" autoComplete="username" defaultValue={email} hidden readOnly />
        <label>当前密码<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
      </>}
      {newPassword && <>
        <label>{mode === 'password' ? '新密码' : '临时密码'}<input name="newPassword" type="password" autoComplete="new-password" required aria-describedby="password-policy" /></label>
        <label>确认{mode === 'password' ? '新密码' : '临时密码'}<input name="confirmation" type="password" autoComplete="new-password" required aria-describedby="password-policy" /></label>
      </>}
      <button className="primary" type="submit" disabled={remaining > 0}>{pending ? '正在提交…' : remaining > 0 ? `${remaining} 秒后可重试` : labels[mode]}</button>
    </fieldset>
    <div role="alert" aria-live="assertive">{error && <p className="notice error">{error}</p>}</div>
    <div role="status" aria-live="polite">{success && <p className="notice success">{success}</p>}</div>
  </form>;
}
export function LogoutButton() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function logout() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    try { await adminRequest('/api/admin/session', 'DELETE', {}); window.location.assign('/admin/login?notice=logged-out'); }
    catch (cause) {
      if (cause instanceof AdminRequestError && cause.redirectTo) window.location.assign(cause.redirectTo);
      else setError(cause instanceof Error ? cause.message : '退出失败，请重试。');
    } finally { busy.current = false; setPending(false); }
  }
  return <div className="logout"><button type="button" onClick={logout} disabled={pending}>{pending ? '正在退出…' : '退出登录'}</button>{error && <p role="alert" className="error">{error}</p>}</div>;
}
export function DisableAccount({ id }: { id: string }) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current || !confirmed) return;
    busy.current = true; setPending(true); setMessage('');
    try {
      await adminRequest(`/api/admin/accounts/${encodeURIComponent(id)}`, 'PATCH', { active: false });
      setFailed(false); setMessage('账号已停用，全部会话已失效。'); setConfirmed(false); router.refresh();
    } catch (cause) {
      setFailed(true); setMessage(cause instanceof Error ? cause.message : '停用失败，请重试。');
      if (cause instanceof AdminRequestError && cause.redirectTo) window.location.assign(cause.redirectTo);
    } finally { busy.current = false; setPending(false); }
  }
  return <form onSubmit={submit} aria-label="停用账号" aria-busy={pending}>
    <p className="muted">停用后不能登录，全部现有会话立即失效；账号与审计记录保留。恢复登录须由服务器处理。</p>
    <label className="checkbox"><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} />我确认停用此账号</label>
    <button className="danger" disabled={pending || !confirmed}>{pending ? '正在停用…' : '确认停用'}</button>
    {message && <p className={`notice ${failed ? 'error' : 'success'}`} role={failed ? 'alert' : 'status'}>{message}</p>}
  </form>;
}
export function PasswordPolicy() {
  return <p id="password-policy" className="muted">密码须为 15–128 个字符，避免常见弱密码。空格保留，不会自动修剪；表情按一个字符计。</p>;
}
