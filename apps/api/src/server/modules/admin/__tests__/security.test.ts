import { expect, it } from 'vitest';
import * as security from '../security.js';
import { MEDIA_UPLOAD_CONTENT_TYPES } from '../../media/limits.js';
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
it('accepts exactly the documented raw upload content types for the media endpoint', () => {
  const headers = { origin: 'http://localhost:3000', 'x-admin-request': '1' };
  const request = (contentType: string, path = '/api/admin/media') => new Request(`http://localhost:3000${path}`, {
    method: 'POST', headers: { ...headers, 'content-type': contentType },
  });
  for (const contentType of MEDIA_UPLOAD_CONTENT_TYPES)
    expect(() => security.validateAdminWrite(request(contentType), { body: 'media_upload' })).not.toThrow();
  // Multipart, generic JSON and anything else stay a CSRF failure: the upload is a raw body.
  for (const contentType of ['application/json', 'multipart/form-data; boundary=x', 'text/plain', 'image/gif'])
    expect(() => security.validateAdminWrite(request(contentType), { body: 'media_upload' })).toThrow('admin_csrf_failed');
  // The default admin write still requires JSON, so the exception cannot widen other routes.
  expect(() => security.validateAdminWrite(request('application/octet-stream'))).toThrow('admin_csrf_failed');
});
it('binds the raw-body exception to the upload path, not to the caller', () => {
  const headers = { origin: 'http://localhost:3000', 'x-admin-request': '1' };
  const request = (path: string, contentType = 'application/octet-stream') => new Request(`http://localhost:3000${path}`, {
    method: 'POST', headers: { ...headers, 'content-type': contentType },
  });
  // A handler that asks for the raw-body kind somewhere else gets nothing: the path is the gate.
  for (const path of ['/api/admin/characters', '/api/admin/media/extra', '/api/admin/mediax', '/api/media/1111']) {
    expect(() => security.validateAdminWrite(request(path), { body: 'media_upload' }), path).toThrow('admin_csrf_failed');
  }
  // Even on the upload path the exception needs the documented types, and JSON alone is never widened.
  expect(() => security.validateAdminWrite(request('/api/admin/media', 'image/png'), { body: 'json' })).toThrow('admin_csrf_failed');
  expect(() => security.validateAdminWrite(request('/api/admin/media', 'application/json'))).not.toThrow();
  // The opt-in is a named body kind: the CSRF boundary re-exports no caller-supplied content-type list.
  expect('MEDIA_UPLOAD_CONTENT_TYPES' in security).toBe(false);
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
