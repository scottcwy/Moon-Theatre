'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { adminRequest, AdminRequestError } from './request.js';
import {
  buildAdjustmentBody,
  newAdjustmentKey,
  type AdjustmentIssues,
  type AdjustmentFormValues,
} from './wallet-adjustment-patch.js';
import {
  ADJUSTMENT_FINALIZE_CONFIRMATION,
  ADJUSTMENT_AUDIT_FINALIZED_COPY,
  ADJUSTMENT_AUDIT_PENDING_COPY,
  describeAdjustmentFailure,
  describeAdjustmentOutcome,
  describeAdjustmentQueryFailure,
} from './wallet-copy.js';

interface AdjustmentResult {
  transactionId: string;
  balanceAfter: number;
  alreadyAdjusted: boolean;
}

interface PendingAudit {
  transactionId: string;
  balanceAfter: number;
  dedupeKey: string;
  idempotencyKey: string;
}

interface AdjustmentStatus {
  transaction: { id: string; userId: string; type: string; amount: number; balanceAfter: number; idempotencyKey: string | null; adjustmentReason: string | null; createdAt: string };
  audit: { result: string; actorSource: string } | null;
  complete: boolean;
}

function failureOf(cause: unknown, fallback: string): AdminRequestError {
  return cause instanceof AdminRequestError ? cause : new AdminRequestError(fallback);
}

function pendingFrom(failure: AdminRequestError, idempotencyKey: string): PendingAudit | null {
  const details = failure.details as Partial<PendingAudit> | undefined;
  if (failure.code !== 'admin_audit_pending' || !details || typeof details.transactionId !== 'string' ||
      typeof details.balanceAfter !== 'number' || typeof details.dedupeKey !== 'string') return null;
  return { transactionId: details.transactionId, balanceAfter: details.balanceAfter, dedupeKey: details.dedupeKey, idempotencyKey };
}

const DEFAULT_VALUES: AdjustmentFormValues = { userId: '', delta: '', reason: '' };

/**
 * Manual point adjustment (AC-14).
 *
 * The operator sees the client-generated idempotency key before submitting, then the resulting
 * balance, whether the call was a replay, the transaction id and the key to re-query. A `409` is
 * explained as one of three different states (parameter conflict / negative balance / audit
 * conflict), and the audit-pending shape offers the finalize-only action, which never moves money.
 */
export function WalletAdjustmentForm() {
  const router = useRouter();
  const busy = useRef(false);
  const [values, setValues] = useState<AdjustmentFormValues>(DEFAULT_VALUES);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [issues, setIssues] = useState<AdjustmentIssues>({});
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<(AdjustmentResult & { idempotencyKey: string; userId: string }) | null>(null);
  const [auditPending, setAuditPending] = useState<PendingAudit | null>(null);
  const [finalizeConfirmed, setFinalizeConfirmed] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeMessage, setFinalizeMessage] = useState('');
  const [finalized, setFinalized] = useState<{ transactionId: string; balanceAfter: number; idempotencyKey: string } | null>(null);
  const [queryKey, setQueryKey] = useState('');
  const [status, setStatus] = useState<AdjustmentStatus | null>(null);
  const [querying, setQuerying] = useState(false);
  const [queryMessage, setQueryMessage] = useState('');

  // Generated in the browser so the operator can copy it and re-use it for a deliberate replay.
  useEffect(() => {
    setIdempotencyKey(current => current || newAdjustmentKey());
  }, []);

  function change(field: keyof AdjustmentFormValues, value: string) {
    setValues(current => ({ ...current, [field]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const built = buildAdjustmentBody(values, idempotencyKey);
    setIssues(built.issues);
    if (!built.body) return;
    busy.current = true;
    setPending(true);
    setMessage('');
    setResult(null);
    setAuditPending(null);
    setFinalizeMessage('');
    setFinalizeConfirmed(false);
    setFinalized(null);
    try {
      const response = await adminRequest<AdjustmentResult>('/api/admin/wallet/adjustments', 'POST', built.body);
      setFailed(false);
      setMessage(describeAdjustmentOutcome(response));
      setResult({ ...response, idempotencyKey: built.body.idempotencyKey, userId: built.body.userId });
      setQueryKey(built.body.idempotencyKey);
      router.refresh();
    } catch (cause) {
      const failure = failureOf(cause, '调账未完成，请稍后重试。');
      setFailed(true);
      const audit = pendingFrom(failure, built.body.idempotencyKey);
      if (audit) {
        setAuditPending(audit);
        setQueryKey(built.body.idempotencyKey);
        setMessage(ADJUSTMENT_AUDIT_PENDING_COPY);
        router.refresh();
      } else {
        setMessage(describeAdjustmentFailure({ code: failure.code, details: failure.details }, failure.message));
      }
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function finalizeAudit() {
    if (!auditPending || !finalizeConfirmed || busy.current) return;
    busy.current = true;
    setFinalizing(true);
    setFinalizeMessage('');
    try {
      const result = await adminRequest<{ transactionId: string; balanceAfter: number; alreadyFinalized: boolean }>(
        `/api/admin/wallet/adjustments/${encodeURIComponent(auditPending.idempotencyKey)}/finalize-audit`, 'POST', {},
      );
      setAuditPending(null);
      setFinalizeConfirmed(false);
      setFinalized({ ...result, idempotencyKey: auditPending.idempotencyKey });
      router.refresh();
    } catch (cause) {
      const failure = failureOf(cause, '审计收尾未完成，请稍后重试。');
      setFinalizeMessage(describeAdjustmentFailure({ code: failure.code, details: failure.details }, failure.message));
    } finally {
      busy.current = false;
      setFinalizing(false);
    }
  }

  async function query(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = queryKey.trim();
    if (!key || querying) return;
    setQuerying(true);
    setQueryMessage('');
    setStatus(null);
    try {
      const response = await adminRequest<AdjustmentStatus>(
        `/api/admin/wallet/adjustments/${encodeURIComponent(key)}`, 'GET',
      );
      setStatus(response);
    } catch (cause) {
      const failure = failureOf(cause, '查询调账结果未完成，请稍后重试。');
      setQueryMessage(describeAdjustmentQueryFailure(
        { code: failure.code, status: failure.status, details: failure.details }, failure.message,
      ));
    } finally {
      setQuerying(false);
    }
  }

  return <div className="panel">
    <h2>人工调账</h2>
    <form className="adjustment-form" onSubmit={submit} aria-label="人工调账" aria-busy={pending}>
      <fieldset disabled={pending}>
        <div className="field-grid">
          <label>目标用户 ID
            <input name="userId" value={values.userId} required maxLength={36} spellCheck={false}
              autoCapitalize="none" placeholder="完整 UUID" onChange={event => change('userId', event.target.value)} />
            {issues.userId && <p className="field-error">{issues.userId}</p>}
          </label>
          <label>调整量（正数增加，负数扣减）
            {/* A digits-only keypad has no minus key on iOS/Android, which would make a debit impossible
                to type on a phone. The value stays server-authoritative: the builder and the API both
                validate the signed integer. */}
            <input name="delta" value={values.delta} required inputMode="text" placeholder="例如 -50"
              onChange={event => change('delta', event.target.value)} />
            {issues.delta && <p className="field-error">{issues.delta}</p>}
          </label>
        </div>
        <label>调整原因（必填）
          <input name="reason" value={values.reason} required maxLength={256}
            onChange={event => change('reason', event.target.value)} />
          {issues.reason && <p className="field-error">{issues.reason}</p>}
        </label>
        <label>幂等标识（本次请求的标识，重放须完全一致）
          <input name="idempotencyKey" value={idempotencyKey} readOnly maxLength={128} className="identifier" />
          {issues.idempotencyKey && <p className="field-error">{issues.idempotencyKey}</p>}
        </label>
        <div className="editor-actions">
          <button className="primary" disabled={pending}>{pending ? '正在提交…' : '提交调账'}</button>
          <button type="button" disabled={pending} onClick={() => setIdempotencyKey(newAdjustmentKey())}>
            重新生成幂等标识
          </button>
        </div>
      </fieldset>
      <p className="muted">幂等标识在同一后台内全局唯一：相同标识 + 相同操作者/用户/方向/金额/原因返回首次结果，任一不同则拒绝，不会产生第二笔流水。</p>
      <div role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
        {message && <p className={`notice ${failed ? 'error' : 'success'}`}>{message}</p>}
      </div>
    </form>

    {result && <section className="panel" aria-label="调账结果">
      <h3>调账结果</h3>
      <dl>
        <dt>是否重放</dt><dd>{result.alreadyAdjusted ? '是（返回首次结果，无第二笔流水）' : '否（本次新写入一笔调整流水）'}</dd>
        <dt>调整后余额</dt><dd>{result.balanceAfter} 点</dd>
        <dt>交易流水 ID</dt><dd className="identifier">{result.transactionId}</dd>
        <dt>幂等标识</dt><dd className="identifier">{result.idempotencyKey}</dd>
      </dl>
      <p><Link href={`/admin/wallet?userId=${encodeURIComponent(result.userId)}`}>在下方流水中查看该用户的流水</Link></p>
    </section>}

    {auditPending && <section className="panel" aria-label="审计待恢复">
      <h3>审计待恢复（资金已按上方结果变动）</h3>
      <dl>
        <dt>交易流水 ID</dt><dd className="identifier">{auditPending.transactionId}</dd>
        <dt>调整后余额</dt><dd>{auditPending.balanceAfter} 点</dd>
        <dt>幂等标识</dt><dd className="identifier">{auditPending.idempotencyKey}</dd>
      </dl>
      <p className="muted">收尾只把已有审计意图标记为完成，不改动余额、不新增流水，也不能用于纠正金额。</p>
      <label className="checkbox">
        <input name="finalizeConfirmation" type="checkbox" checked={finalizeConfirmed} disabled={finalizing}
          onChange={event => setFinalizeConfirmed(event.target.checked)} />
        {ADJUSTMENT_FINALIZE_CONFIRMATION}
      </label>
      <div className="editor-actions">
        <button type="button" className="primary" disabled={finalizing || !finalizeConfirmed} onClick={finalizeAudit}>
          {finalizing ? '正在收尾…' : '仅收尾审计'}
        </button>
      </div>
      <div role="alert" aria-live="assertive">
        {finalizeMessage && <p className="notice error">{finalizeMessage}</p>}
      </div>
    </section>}

    {finalized && <section className="panel" aria-label="审计收尾结果">
      <h3>审计收尾结果</h3>
      <dl>
        <dt>交易流水 ID</dt><dd className="identifier">{finalized.transactionId}</dd>
        <dt>调整后余额</dt><dd>{finalized.balanceAfter} 点</dd>
        <dt>幂等标识</dt><dd className="identifier">{finalized.idempotencyKey}</dd>
      </dl>
      <p className="notice success">{ADJUSTMENT_AUDIT_FINALIZED_COPY}</p>
    </section>}

    <form className="adjustment-query" onSubmit={query} aria-label="查询调账结果" aria-busy={querying}>
      <label>按幂等标识查询
        <input name="queryIdempotencyKey" value={queryKey} maxLength={128} spellCheck={false}
          onChange={event => setQueryKey(event.target.value)} />
      </label>
      <button disabled={querying || !queryKey.trim()}>{querying ? '查询中…' : '查询调账结果'}</button>
      <div role="status" aria-live="polite">
        {queryMessage && <p className="notice error">{queryMessage}</p>}
        {status && <div className="notice">
          <p>审计状态：{status.complete ? '已完成' : '待恢复'}（{status.audit?.result ?? '无审计记录'}）</p>
          <dl>
            <dt>交易流水 ID</dt><dd className="identifier">{status.transaction.id}</dd>
            <dt>金额</dt><dd>{status.transaction.amount > 0 ? `+${status.transaction.amount}` : status.transaction.amount} 点</dd>
            <dt>变动后余额</dt><dd>{status.transaction.balanceAfter} 点</dd>
            <dt>原因</dt><dd>{status.transaction.adjustmentReason ?? '—'}</dd>
          </dl>
        </div>}
      </div>
    </form>
  </div>;
}
