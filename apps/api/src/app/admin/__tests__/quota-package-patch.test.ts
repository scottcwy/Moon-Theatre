import { describe, expect, it } from 'vitest';
import {
  buildQuotaPackageCreate,
  buildQuotaPackagePatch,
  centsToYuanInput,
  parseYuanToCents,
  quotaPackageDescriptionIssue,
  quotaPackageEditorKey,
  quotaPackageNameIssue,
  type QuotaPackageFormValues,
  type QuotaPackageInitial,
} from '../quota-package-patch.js';

const packageId = '11111111-1111-4111-8111-111111111111';

function values(overrides: Partial<QuotaPackageFormValues> = {}): QuotaPackageFormValues {
  return {
    name: '体验包',
    priceYuan: '6.00',
    points: '60',
    sortOrder: '1',
    description: '60 点数，适合初次体验',
    recommended: false,
    active: true,
    ...overrides,
  };
}

function initial(overrides: Partial<QuotaPackageInitial> = {}): QuotaPackageInitial {
  return {
    name: '体验包',
    priceCents: 600,
    points: 60,
    sortOrder: 1,
    description: '60 点数，适合初次体验',
    recommended: false,
    active: true,
    ...overrides,
  };
}

describe('yuan/cents conversion (integer cents, no float rounding)', () => {
  it.each([
    ['6', 600], ['6.0', 600], ['6.00', 600], ['6.5', 650], ['6.55', 655], ['0', 0], ['0.00', 0], ['1234.56', 123456],
  ])('parses %s as %i cents', (input, cents) => {
    expect(parseYuanToCents(input)).toBe(cents);
  });

  it.each(['', ' ', '-1', '6.555', '6,00', 'abc', '6.', '.5', '1e3', '6.5.5', '+6'])('refuses %s', input => {
    expect(parseYuanToCents(input)).toBeNull();
  });

  it('renders the stored cents back as a two-decimal yuan input', () => {
    expect(centsToYuanInput(600)).toBe('6.00');
    expect(centsToYuanInput(655)).toBe('6.55');
    expect(centsToYuanInput(0)).toBe('0.00');
    expect(parseYuanToCents(centsToYuanInput(123456))).toBe(123456);
  });
});

describe('package field validation', () => {
  it('requires a trimmed name and bounds its length', () => {
    expect(quotaPackageNameIssue('  ')).toBe('套餐名称不能为空');
    expect(quotaPackageNameIssue('a'.repeat(65))).toBe('套餐名称最多 64 个字符');
    expect(quotaPackageNameIssue('  标准包  ')).toBeNull();
  });

  it('bounds the description', () => {
    expect(quotaPackageDescriptionIssue('a'.repeat(257))).toBe('说明最多 256 个字符');
    expect(quotaPackageDescriptionIssue('')).toBeNull();
  });
});

describe('create body', () => {
  it('sends exactly the documented fields and nothing else', () => {
    const result = buildQuotaPackageCreate(values());
    expect(result.issues).toEqual({});
    expect(result.body).toEqual({
      name: '体验包',
      priceCents: 600,
      points: 60,
      sortOrder: 1,
      description: '60 点数，适合初次体验',
      recommended: false,
      active: true,
    });
  });

  it('omits an empty description instead of sending an empty string', () => {
    expect(buildQuotaPackageCreate(values({ description: '   ' })).body).toEqual({
      name: '体验包', priceCents: 600, points: 60, sortOrder: 1, recommended: false, active: true,
    });
  });

  it('trims the name and accepts a zero price (free package)', () => {
    expect(buildQuotaPackageCreate(values({ name: '  免费包 ', priceYuan: '0' })).body).toMatchObject({
      name: '免费包', priceCents: 0,
    });
  });

  it.each([
    [{ priceYuan: '' }, 'priceYuan'],
    [{ priceYuan: '-1' }, 'priceYuan'],
    [{ points: '0' }, 'points'],
    [{ points: '-5' }, 'points'],
    [{ points: '1.5' }, 'points'],
    [{ sortOrder: '' }, 'sortOrder'],
    [{ sortOrder: '-1' }, 'sortOrder'],
    [{ name: '  ' }, 'name'],
    [{ name: 'a'.repeat(65) }, 'name'],
    [{ description: 'a'.repeat(257) }, 'description'],
  ] as const)('refuses %o before any request', (overrides, field) => {
    const result = buildQuotaPackageCreate(values(overrides as Partial<QuotaPackageFormValues>));
    expect(result.body).toBeUndefined();
    expect(result.issues[field]).toBeTruthy();
  });
});

describe('inline edit patch', () => {
  it('sends only the fields the operator actually changed', () => {
    const result = buildQuotaPackagePatch({ form: values({ priceYuan: '9.00' }), initial: initial() });
    expect(result.issues).toEqual({});
    expect(result.patch).toEqual({ priceCents: 900 });
  });

  it('maps every editable field', () => {
    const result = buildQuotaPackagePatch({
      form: values({ name: '标准包', points: '200', sortOrder: '2', description: '新说明', recommended: true, active: false }),
      initial: initial(),
    });
    expect(result.patch).toEqual({
      name: '标准包', points: 200, sortOrder: 2, description: '新说明', recommended: true, active: false,
    });
  });

  it('normalises a cleared description to null so it can be emptied', () => {
    const result = buildQuotaPackagePatch({ form: values({ description: '' }), initial: initial() });
    expect(result.patch).toEqual({ description: null });
  });

  it('returns an empty patch when nothing changed (no needless audit row)', () => {
    const result = buildQuotaPackagePatch({ form: values(), initial: initial() });
    expect(result.issues).toEqual({});
    expect(result.patch).toEqual({});
  });

  it('compares the parsed cent value, so 6 and 6.00 are the same price', () => {
    expect(buildQuotaPackagePatch({ form: values({ priceYuan: '6' }), initial: initial() }).patch).toEqual({});
  });

  it('refuses an invalid field instead of sending a half-valid patch', () => {
    const result = buildQuotaPackagePatch({ form: values({ priceYuan: 'x', points: '0' }), initial: initial() });
    expect(result.patch).toBeUndefined();
    expect(Object.keys(result.issues).sort()).toEqual(['points', 'priceYuan']);
  });
});

describe('editor remount key', () => {
  it('keys the inline editor by package id alone, so a refresh cannot drop the save confirmation', () => {
    const before = { id: packageId, updatedAt: new Date('2026-10-01T00:00:00Z') };
    const after = { id: packageId, updatedAt: new Date('2026-11-02T03:04:05Z') };
    expect(quotaPackageEditorKey(before)).toBe(packageId);
    // A `router.refresh()` brings a new `updatedAt`; if that changed the key, React would remount the
    // editor and reset every `useState` — including the message the operator just earned.
    expect(quotaPackageEditorKey(after)).toBe(quotaPackageEditorKey(before));
    expect(quotaPackageEditorKey({ id: 'other-package' })).not.toBe(quotaPackageEditorKey(before));
  });
});
