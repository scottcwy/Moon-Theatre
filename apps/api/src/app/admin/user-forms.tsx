'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminRequest, AdminRequestError } from './request.js';
import {
  USER_BAN_CONFIRMATION,
  USER_UNBAN_CONFIRMATION,
  describeUserStatusChange,
  userStatusLabel,
} from './user-copy.js';

/**
 * Ban/unban action. The transition is only offered after an explicit confirmation that names the
 * consequence (existing credentials stop authorizing new user requests), and the button stays disabled
 * until then — the same shape as the publish/unpublish and disable-account confirmations.
 */
export function UserStatusAction({ userId, status }: { userId: string; status: 'active' | 'banned' }) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const next = status === 'active' ? 'banned' : 'active';
  const label = status === 'active' ? '封禁' : '解封';

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !confirmed) return;
    busy.current = true;
    setPending(true);
    setMessage('');
    try {
      const result = await adminRequest<{ user: { status: 'active' | 'banned' }; changed: boolean }>(
        `/api/admin/users/${encodeURIComponent(userId)}`,
        'PATCH',
        { status: next },
      );
      setFailed(false);
      setMessage(describeUserStatusChange({ status: result.user.status, changed: result.changed }));
      setConfirmed(false);
      router.refresh();
    } catch (cause) {
      const failure = cause instanceof AdminRequestError
        ? cause
        : new AdminRequestError(`${label}未完成，请稍后重试。`);
      setFailed(true);
      // A 400 here means the body/status was refused by the server; say so instead of guessing.
      setMessage(failure.code === 'admin_input_invalid' ? '状态只能是正常或已封禁，请刷新页面后重试。' : failure.message);
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const confirmationId = `user-status-confirmation-${userId}`;
  return <form className="user-status-action" onSubmit={submit} aria-label={`${label}用户`} aria-busy={pending}>
    <p className="muted">当前状态：{userStatusLabel(status)} · 将变更为：{userStatusLabel(next)}</p>
    <label className="checkbox" htmlFor={confirmationId}>
      <input
        id={confirmationId}
        name="confirmation"
        type="checkbox"
        checked={confirmed}
        disabled={pending}
        onChange={event => setConfirmed(event.target.checked)}
      />
      {status === 'active' ? USER_BAN_CONFIRMATION : USER_UNBAN_CONFIRMATION}
    </label>
    <button className={status === 'active' ? 'danger' : 'primary'} disabled={pending || !confirmed}>
      {pending ? `${label}中…` : `确认${label}`}
    </button>
    <div role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
      {message && <p className={`notice ${failed ? 'error' : 'success'}`}>{message}</p>}
    </div>
  </form>;
}
