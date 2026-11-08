/**
 * Pure form construction for quota package maintenance (AC-13).
 *
 * Kept out of the client component so the exact payload a save sends can be asserted directly:
 * prices are integer cents derived from a yuan string without float arithmetic, and a save sends only
 * the fields the operator actually changed (an unchanged field never triggers a needless audit row).
 */
import { QUOTA_PACKAGE_DESCRIPTION_MAX, QUOTA_PACKAGE_NAME_MAX } from '@/server/modules/admin/quota-package-limits.js';

export interface QuotaPackageFormValues {
  name: string;
  /** Yuan text as typed, e.g. `6`, `6.5`, `6.55`. Converted to integer cents before sending. */
  priceYuan: string;
  points: string;
  sortOrder: string;
  description: string;
  recommended: boolean;
  active: boolean;
}

export interface QuotaPackageInitial {
  name: string;
  priceCents: number;
  points: number;
  sortOrder: number;
  description: string | null;
  recommended: boolean;
  active: boolean;
}

export interface QuotaPackageIssues { [field: string]: string }

export type QuotaPackageBody = {
  name: string;
  priceCents: number;
  points: number;
  sortOrder?: number;
  description?: string;
  recommended?: boolean;
  active?: boolean;
};

export interface QuotaPackagePatch {
  name?: string;
  priceCents?: number;
  points?: number;
  sortOrder?: number;
  description?: string | null;
  recommended?: boolean;
  active?: boolean;
}

const YUAN = /^\d+(\.\d{1,2})?$/;
const COUNT = /^\d+$/;

/** `6` → 600, `6.5` → 650, `6.55` → 655. Anything with more precision, a sign or a separator is invalid. */
export function parseYuanToCents(value: string): number | null {
  const text = value.trim();
  if (!YUAN.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** `600` → `6.00` (integer arithmetic; no float rounding). */
export function centsToYuanInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

export function quotaPackageNameIssue(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return '套餐名称不能为空';
  if (Array.from(trimmed).length > QUOTA_PACKAGE_NAME_MAX) return `套餐名称最多 ${QUOTA_PACKAGE_NAME_MAX} 个字符`;
  return null;
}

export function quotaPackageDescriptionIssue(description: string): string | null {
  return Array.from(description.trim()).length > QUOTA_PACKAGE_DESCRIPTION_MAX
    ? `说明最多 ${QUOTA_PACKAGE_DESCRIPTION_MAX} 个字符`
    : null;
}

function parseCount(value: string): number | null {
  const text = value.trim();
  return COUNT.test(text) ? Number(text) : null;
}

/** Validates every field once; returns the issued field errors plus the parsed values. */
function parseForm(values: QuotaPackageFormValues) {
  const issues: QuotaPackageIssues = {};
  const name = values.name.trim();
  const nameIssue = quotaPackageNameIssue(name);
  if (nameIssue) issues.name = nameIssue;
  const description = values.description.trim();
  const descriptionIssue = quotaPackageDescriptionIssue(description);
  if (descriptionIssue) issues.description = descriptionIssue;

  const priceCents = parseYuanToCents(values.priceYuan);
  if (priceCents === null) issues.priceYuan = '价格需为不小于 0 的金额，最多两位小数';
  const points = parseCount(values.points);
  if (points === null || points < 1) issues.points = '点数需为正整数';
  const sortOrder = parseCount(values.sortOrder);
  if (sortOrder === null) issues.sortOrder = '排序需为不小于 0 的整数';
  return { issues, name, description, priceCents, points, sortOrder };
}

export function buildQuotaPackageCreate(values: QuotaPackageFormValues): { body?: QuotaPackageBody; issues: QuotaPackageIssues } {
  const parsed = parseForm(values);
  if (Object.keys(parsed.issues).length > 0) return { issues: parsed.issues };
  return {
    issues: {},
    body: {
      name: parsed.name,
      priceCents: parsed.priceCents!,
      points: parsed.points!,
      sortOrder: parsed.sortOrder!,
      ...(parsed.description ? { description: parsed.description } : {}),
      recommended: values.recommended,
      active: values.active,
    },
  };
}

/** Sends only the fields that differ from the stored row, compared after normalisation. */
export function buildQuotaPackagePatch(input: {
  form: QuotaPackageFormValues;
  initial: QuotaPackageInitial;
}): { patch?: QuotaPackagePatch; issues: QuotaPackageIssues } {
  const { form, initial } = input;
  const parsed = parseForm(form);
  if (Object.keys(parsed.issues).length > 0) return { issues: parsed.issues };

  const patch: QuotaPackagePatch = {};
  if (parsed.name !== initial.name) patch.name = parsed.name;
  if (parsed.priceCents !== initial.priceCents) patch.priceCents = parsed.priceCents!;
  if (parsed.points !== initial.points) patch.points = parsed.points!;
  if (parsed.sortOrder !== initial.sortOrder) patch.sortOrder = parsed.sortOrder!;
  const description = parsed.description || null;
  if (description !== initial.description) patch.description = description;
  if (form.recommended !== initial.recommended) patch.recommended = form.recommended;
  if (form.active !== initial.active) patch.active = form.active;
  return { patch, issues: {} };
}

/**
 * React key for one inline editor. It is the package id **only**: `router.refresh()` after a save brings
 * a new `updatedAt`, and including that in the key remounts the editor, resetting every `useState` —
 * including the confirmation the operator just earned. The editor re-prefills its fields from the PATCH
 * response, so keeping the component mounted cannot produce a stale save.
 */
export function quotaPackageEditorKey(quotaPackage: { id: string }): string {
  return quotaPackage.id;
}
