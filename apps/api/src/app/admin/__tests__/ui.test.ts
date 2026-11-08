import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminRequest, AdminRequestError, passwordConfirmationError } from '../request.js';

afterEach(() => vi.unstubAllGlobals());
describe('credential UI request contract', () => {
  it('uses same-origin cookies, JSON, CSRF header and no-store; never transforms passwords', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authenticated: true })));
    vi.stubGlobal('fetch', fetch);
    await adminRequest('/api/admin/session', 'POST', { email: 'a@example.test', password: '  exact password  ' });
    expect(fetch).toHaveBeenCalledWith('/api/admin/session', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify({ email: 'a@example.test', password: '  exact password  ' }) }));
    await adminRequest('/api/admin/session', 'DELETE', {});
    expect(fetch.mock.calls[1]![1].body).toBe('{}');
  });
  it.each([
    [401, 'admin_unauthenticated', '/admin/login?notice=expired'],
    [403, 'admin_password_change_required', '/admin/change-password'],
    [403, 'admin_account_forbidden', undefined],
    [503, 'raw SQL secret', undefined],
  ])('sanitizes %s errors and only redirects authentication boundaries', async (status, code, redirectTo) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: code }), { status })));
    try { await adminRequest('/api/admin/accounts', 'POST', {}); throw new Error('expected rejection'); }
    catch (error) {
      expect(error).toBeInstanceOf(AdminRequestError);
      expect((error as AdminRequestError).redirectTo).toBe(redirectTo);
      expect((error as Error).message).not.toContain('SQL');
    }
  });
  it('keeps bad-login errors inline and honors Retry-After without retrying', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{"error":"admin_login_invalid"}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"error":"admin_login_limited"}', { status: 429, headers: { 'Retry-After': '90' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(adminRequest('/api/admin/session', 'POST', {})).rejects.toMatchObject({ redirectTo: undefined });
    await expect(adminRequest('/api/admin/session', 'POST', {})).rejects.toMatchObject({ retryAfter: 90 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('sanitizes non-object errors and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('null', { status: 400 })).mockRejectedValueOnce(new Error('internal socket details')));
    await expect(adminRequest('/api/admin/accounts', 'POST', {})).rejects.toBeInstanceOf(AdminRequestError);
    await expect(adminRequest('/api/admin/accounts', 'POST', {})).rejects.toThrow('网络连接失败');
  });
  it('validates confirmation and Unicode codepoints without trimming/normalizing', () => {
    expect(passwordConfirmationError('😀'.repeat(15), '😀'.repeat(15))).toBeNull();
    expect(passwordConfirmationError('😀'.repeat(14), '😀'.repeat(14))).toContain('15');
    expect(passwordConfirmationError('a'.repeat(129), 'a'.repeat(129))).toContain('128');
    expect(passwordConfirmationError('  secure password  ', 'secure password')).toContain('不一致');
  });
});
