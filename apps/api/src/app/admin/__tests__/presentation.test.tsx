import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { adminStatus, formatAdminDate } from '../ui.js';
import { CredentialForm } from '../forms.js';
vi.stubGlobal('React', React);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
it('translates real model tiers and lifecycle statuses while retaining provider data', () => {
  expect(adminStatus('casual')).toBe('轻松');
  expect(adminStatus('immersive')).toBe('沉浸');
  expect(adminStatus('prepay_created')).toBe('已预支付');
  expect(adminStatus('out_of_scope')).toBe('超出范围');
  expect(adminStatus('provider_result_unknown')).toBe('渠道结果待确认');
  expect(adminStatus('creating')).toBe('创建中');
  expect(adminStatus('aggregate')).toBe('aggregate');
});
it('formats missing dates as unavailable, not fake timestamps', () => {
  expect(formatAdminDate(null)).toBe('—');
  expect(formatAdminDate('invalid')).toBe('—');
  expect(formatAdminDate('2026-11-07T00:00:00Z')).toContain('8:00:00');
});
it('unexpected page failures have a Chinese retry boundary without exposing error internals', async () => {
  const ErrorPage = (await import('../error.js')).default;
  const html = renderToStaticMarkup(<ErrorPage error={new Error('SQL SECRET')} reset={() => undefined} />);
  expect(html).toContain('重新尝试');
  expect(html).toContain('返回登录');
  expect(html).not.toContain('SQL SECRET');
});
it('credential forms have named native fields with correct autocomplete and no UTF16 length constraints', () => {
  const html = renderToStaticMarkup(<CredentialForm mode="password" endpoint="/api/admin/account/password" email="owner@example.test" />);
  expect(html).toContain('autoComplete="current-password"');
  expect(html).toContain('autoComplete="new-password"');
  expect(html).toContain('name="confirmation"');
  expect(html).not.toContain('minLength');
  expect(html).not.toContain('maxLength');
  expect(html).toContain('role="alert"');
});
