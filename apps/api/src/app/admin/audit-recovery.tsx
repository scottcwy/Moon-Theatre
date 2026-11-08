'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminRequest, AdminRequestError } from './request.js';
import { AUDIT_RECOVERY_COPY, describeAuditRecoveryFailure } from './audit-recovery-copy.js';

/**
 * The one finalize-only recovery action shared by the four audit surfaces (character publish, script
 * publish, model publish, wallet adjustment).
 *
 * It calls an existing `finalize-audit` route and nothing else: the route re-locks the stored intent,
 * verifies it against the persisted business result, and appends the recovery event under the current
 * administrator. No publish, publish-task work, content/configuration write or money movement happens
 * here, and the UI copies say so. A `409` is rendered as "无法确认该待恢复意图" and leaves the business
 * result untouched; it is never reported as a generic outage.
 */
export async function finalizeAuditIntent<T = { alreadyFinalized?: boolean }>(endpoint: string): Promise<T> {
  return adminRequest<T>(endpoint, 'POST', {});
}

export function FinalizeAuditAction({
  endpoint,
  /** Stable selector value for tests/QA; it is the task id or entity id, never a secret. */
  identifier,
  showNote = false,
}: {
  endpoint: string;
  identifier: string;
  showNote?: boolean;
}) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  async function finalize() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage('');
    try {
      await finalizeAuditIntent(endpoint);
      setFailed(false);
      setMessage(AUDIT_RECOVERY_COPY.success);
      router.refresh();
    } catch (cause) {
      const failure = cause instanceof AdminRequestError
        ? cause
        : new AdminRequestError(AUDIT_RECOVERY_COPY.failed);
      setFailed(true);
      setMessage(describeAuditRecoveryFailure({ code: failure.code, status: failure.status }, failure.message));
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <div className="finalize-audit" data-finalize-audit={identifier}>
    {showNote && <p className="muted">{AUDIT_RECOVERY_COPY.note}</p>}
    <button type="button" onClick={finalize} disabled={pending}>
      {pending ? AUDIT_RECOVERY_COPY.pendingAction : AUDIT_RECOVERY_COPY.action}
    </button>
    {message && <p className={`notice ${failed ? 'error' : 'success'}`} role={failed ? 'alert' : 'status'}>{message}</p>}
  </div>;
}
