import { expect, it } from 'vitest';
import * as security from '../security.js';
it('requires exact configured Origin, JSON and custom header on every write method', () => {
  for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
    const headers = { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-admin-request': '1' };
    expect(() => security.validateAdminWrite(new Request('http://localhost:3000/api/admin/session', { method, headers }))).not.toThrow();
    for (const key of Object.keys(headers)) {
      const missing = { ...headers }; delete missing[key as keyof typeof headers];
      expect(() => security.validateAdminWrite(new Request('http://localhost:3000/api/admin/session', { method, headers: missing }))).toThrow('admin_csrf_failed');
    }
    expect(() => security.validateAdminWrite(new Request('http://localhost:3000/api/admin/session', { method, headers: { ...headers, origin: 'https://evil.test' } }))).toThrow();
  }
});
it('only trusts one valid proxy IP in production; local fake IPs all share local budget', () => {
  expect(security.adminClientIp(new Headers({ 'x-admin-client-ip': '1.2.3.4' }), false)).toBe('local');
  expect(security.adminClientIp(new Headers({ 'x-admin-client-ip': '1.2.3.4' }), true)).toBe('1.2.3.4');
  for (const ip of ['', '1.2.3.4, 2.3.4.5', 'unknown', '127.0.0.1:42'])
    expect(() => security.adminClientIp(new Headers({ 'x-admin-client-ip': ip, 'x-forwarded-for': '1.2.3.4' }), true)).toThrow();
});
it('safe return paths reject external, control, backslash, encoded and login loops', () => {
  for (const path of ['//evil.test', '/admin\\evil', '/admin/%5cevil', '/admin/%0aevil', 'https://evil.test/admin', '/admin/login', '/admin/change-password', '/admin/../api/admin', '/administrator', '/admin//login', '/admin/%2flogin', '/admin/login/../change-password', '/admin/%256cogin'])
    expect(security.safeAdminReturnPath(path)).toBe('/admin');
  expect(security.safeAdminReturnPath('/admin/sessions?page=2')).toBe('/admin/sessions?page=2');
});
