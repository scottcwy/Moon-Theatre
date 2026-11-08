'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminRequest, AdminRequestError } from './request.js';
import {
  buildQuotaPackageCreate,
  buildQuotaPackagePatch,
  centsToYuanInput,
  type QuotaPackageFormValues,
  type QuotaPackageInitial,
  type QuotaPackageIssues,
} from './quota-package-patch.js';
import {
  QUOTA_PACKAGE_ACTIVE_LABEL,
  QUOTA_PACKAGE_DESCRIPTION_LABEL,
  QUOTA_PACKAGE_NOTHING_TO_SAVE,
  QUOTA_PACKAGE_OFFLINE_CONFIRMATION,
  QUOTA_PACKAGE_ONLINE_CONFIRMATION,
  QUOTA_PACKAGE_ORDER_LABEL,
  QUOTA_PACKAGE_POINTS_LABEL,
  QUOTA_PACKAGE_PRICE_LABEL,
  QUOTA_PACKAGE_RECOMMENDED_LABEL,
  availabilityLabel,
  describeQuotaPackageAvailability,
  describeQuotaPackageCreate,
  describeQuotaPackageSave,
  quotaPackageFailureCopy,
} from './quota-package-copy.js';
import type { AdminQuotaPackage } from '@/server/modules/admin/index.js';

const CREATE_DEFAULTS: QuotaPackageFormValues = {
  name: '', priceYuan: '', points: '', sortOrder: '0', description: '', recommended: false, active: true,
};

function failureOf(cause: unknown, fallback: string): AdminRequestError {
  return cause instanceof AdminRequestError ? cause : new AdminRequestError(fallback);
}

function Issue({ message }: { message?: string }) {
  return message ? <p className="field-error">{message}</p> : null;
}

function PackageFields({ values, issues, disabled, onChange }: {
  values: QuotaPackageFormValues;
  issues: QuotaPackageIssues;
  disabled: boolean;
  onChange: (field: keyof QuotaPackageFormValues, value: string | boolean) => void;
}) {
  return <>
    <div className="field-grid">
      <label>套餐名称
        <input name="name" value={values.name} maxLength={80} required disabled={disabled}
          onChange={event => onChange('name', event.target.value)} />
        <Issue message={issues.name} />
      </label>
      <label>{QUOTA_PACKAGE_PRICE_LABEL}
        <input name="priceYuan" value={values.priceYuan} inputMode="decimal" required disabled={disabled}
          placeholder="例如 6.00" onChange={event => onChange('priceYuan', event.target.value)} />
        <Issue message={issues.priceYuan} />
      </label>
      <label>{QUOTA_PACKAGE_POINTS_LABEL}
        <input name="points" value={values.points} inputMode="numeric" required disabled={disabled}
          onChange={event => onChange('points', event.target.value)} />
        <Issue message={issues.points} />
      </label>
      <label>{QUOTA_PACKAGE_ORDER_LABEL}
        <input name="sortOrder" value={values.sortOrder} inputMode="numeric" required disabled={disabled}
          onChange={event => onChange('sortOrder', event.target.value)} />
        <Issue message={issues.sortOrder} />
      </label>
    </div>
    <label>{QUOTA_PACKAGE_DESCRIPTION_LABEL}
      <textarea name="description" value={values.description} rows={2} maxLength={256} disabled={disabled}
        onChange={event => onChange('description', event.target.value)} />
      <Issue message={issues.description} />
    </label>
    <label className="checkbox">
      <input name="recommended" type="checkbox" checked={values.recommended} disabled={disabled}
        onChange={event => onChange('recommended', event.target.checked)} />
      {QUOTA_PACKAGE_RECOMMENDED_LABEL}
    </label>
  </>;
}

/** Creates one package. The amount/points effect note is rendered on the page above this form. */
export function PackageCreateForm() {
  const router = useRouter();
  const busy = useRef(false);
  const [values, setValues] = useState<QuotaPackageFormValues>(CREATE_DEFAULTS);
  const [issues, setIssues] = useState<QuotaPackageIssues>({});
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');

  function change(field: keyof QuotaPackageFormValues, value: string | boolean) {
    setValues(current => ({ ...current, [field]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const built = buildQuotaPackageCreate(values);
    setIssues(built.issues);
    if (!built.body) return;
    busy.current = true;
    setPending(true);
    setMessage('');
    try {
      const result = await adminRequest<{ package: AdminQuotaPackage; changed: boolean }>(
        '/api/admin/quota-packages', 'POST', built.body,
      );
      setFailed(false);
      setMessage(describeQuotaPackageCreate(result));
      setValues(CREATE_DEFAULTS);
      router.refresh();
    } catch (cause) {
      const failure = failureOf(cause, '创建套餐未完成，请稍后重试。');
      setFailed(true);
      setMessage(quotaPackageFailureCopy(failure.code, failure.message));
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <form className="package-form" onSubmit={submit} aria-label="新建充值套餐" aria-busy={pending}>
    <fieldset disabled={pending}>
      <PackageFields values={values} issues={issues} disabled={pending} onChange={change} />
      <label className="checkbox">
        <input name="active" type="checkbox" checked={values.active} disabled={pending}
          onChange={event => change('active', event.target.checked)} />
        {QUOTA_PACKAGE_ACTIVE_LABEL}
      </label>
      <div className="editor-actions">
        <button className="primary" disabled={pending}>{pending ? '正在创建…' : '创建套餐'}</button>
      </div>
    </fieldset>
    <div role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
      {message && <p className={`notice ${failed ? 'error' : 'success'}`}>{message}</p>}
    </div>
  </form>;
}

/**
 * Inline editor for one package: an explicit 保存修改 (nothing is saved on blur), plus an
 * availability switch that asks for confirmation and states that existing orders keep their snapshot.
 */
export function QuotaPackageEditor({ quotaPackage }: { quotaPackage: AdminQuotaPackage }) {
  const router = useRouter();
  const busy = useRef(false);
  const initial: QuotaPackageInitial = {
    name: quotaPackage.name,
    priceCents: quotaPackage.priceCents,
    points: quotaPackage.points,
    sortOrder: quotaPackage.sortOrder,
    description: quotaPackage.description,
    recommended: quotaPackage.recommended,
    active: quotaPackage.active,
  };
  const initialForm: QuotaPackageFormValues = {
    name: initial.name,
    priceYuan: centsToYuanInput(initial.priceCents),
    points: String(initial.points),
    sortOrder: String(initial.sortOrder),
    description: initial.description ?? '',
    recommended: initial.recommended,
    active: initial.active,
  };
  const [values, setValues] = useState(initialForm);
  const [issues, setIssues] = useState<QuotaPackageIssues>({});
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);

  // The editor stays mounted across a refresh (its key is the package id, so the confirmation message
  // survives), which means the fields have to be re-prefilled here when the stored row changed. Without
  // this, a refresh after another operator's edit would leave stale values in the form. A render-phase
  // adjustment is the documented React way to react to new props without an extra remount.
  const rowStamp = quotaPackage.updatedAt.toISOString();
  const [syncedRow, setSyncedRow] = useState(rowStamp);
  if (syncedRow !== rowStamp) {
    setSyncedRow(rowStamp);
    setValues(initialForm);
    setConfirming(false);
  }

  function change(field: keyof QuotaPackageFormValues, value: string | boolean) {
    setValues(current => ({ ...current, [field]: value }));
  }

  async function patch(
    body: object,
    describe: (result: { package: AdminQuotaPackage; changed: boolean }) => string,
    fallback: string,
  ) {
    busy.current = true;
    setPending(true);
    setMessage('');
    try {
      const result = await adminRequest<{ package: AdminQuotaPackage; changed: boolean }>(
        `/api/admin/quota-packages/${encodeURIComponent(quotaPackage.id)}`, 'PATCH', body,
      );
      setFailed(false);
      setMessage(describe(result) || '');
      setValues({
        name: result.package.name,
        priceYuan: centsToYuanInput(result.package.priceCents),
        points: String(result.package.points),
        sortOrder: String(result.package.sortOrder),
        description: result.package.description ?? '',
        recommended: result.package.recommended,
        active: result.package.active,
      });
      router.refresh();
      return result;
    } catch (cause) {
      const failure = failureOf(cause, fallback);
      setFailed(true);
      setMessage(quotaPackageFailureCopy(failure.code, failure.message));
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
      return null;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const built = buildQuotaPackagePatch({ form: values, initial });
    setIssues(built.issues);
    if (!built.patch) return;
    if (Object.keys(built.patch).length === 0) {
      setFailed(false);
      setMessage(QUOTA_PACKAGE_NOTHING_TO_SAVE);
      return;
    }
    await patch(built.patch, result => describeQuotaPackageSave(result), '保存套餐未完成，请稍后重试。');
  }

  async function toggleAvailability() {
    if (busy.current) return;
    await patch({ active: !quotaPackage.active }, result => describeQuotaPackageAvailability(result), '上下架未完成，请稍后重试。');
    setConfirming(false);
  }

  return <form className="package-form" onSubmit={save} aria-label={`编辑套餐 ${quotaPackage.name}`} aria-busy={pending}>
    <h3>{quotaPackage.name}
      <span className="tag" data-status={quotaPackage.active ? 'active' : 'inactive'}>{availabilityLabel(quotaPackage.active)}</span>
    </h3>
    <fieldset disabled={pending}>
      <PackageFields values={values} issues={issues} disabled={pending} onChange={change} />
      <div className="editor-actions">
        <button className="primary" disabled={pending}>{pending ? '正在保存…' : '保存修改'}</button>
        <button type="button" className={quotaPackage.active ? 'danger' : ''} disabled={pending} onClick={() => setConfirming(true)}>
          {quotaPackage.active ? '下架该套餐' : '上架该套餐'}
        </button>
      </div>
      {confirming && <div className="notice warning" role="alert">
        <p>{quotaPackage.active ? QUOTA_PACKAGE_OFFLINE_CONFIRMATION : QUOTA_PACKAGE_ONLINE_CONFIRMATION}</p>
        <div className="editor-actions">
          <button type="button" className={quotaPackage.active ? 'danger' : 'primary'} disabled={pending} onClick={toggleAvailability}>
            {quotaPackage.active ? '确认下架' : '确认上架'}
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirming(false)}>取消</button>
        </div>
      </div>}
    </fieldset>
    <div role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
      {message && <p className={`notice ${failed ? 'error' : 'success'}`}>{message}</p>}
    </div>
  </form>;
}
