import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ token: undefined as string | undefined, resolve: vi.fn(), noStore: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => name === 'admin_session_v2' && mocks.token ? { value: mocks.token } : undefined }) }));
vi.mock('next/cache', () => ({ unstable_noStore: mocks.noStore }));
vi.mock('../authentication.js', () => ({ resolveAdminToken: mocks.resolve }));
import { requireAdminPageAuth } from '../page-auth.js';
afterEach(() => { mocks.token = undefined; vi.clearAllMocks(); });
it('SSR uses same resolver, new cookie and no-store, rejecting missing and restricted identities', async () => {
  mocks.resolve.mockResolvedValue(null);
  expect(await requireAdminPageAuth()).toBeNull();
  expect(mocks.noStore).toHaveBeenCalled();
  mocks.token = 'new-token'; mocks.resolve.mockRejectedValue(new Error('restricted/dependency'));
  expect(await requireAdminPageAuth()).toBeNull();
  expect(mocks.resolve).toHaveBeenLastCalledWith('new-token', {});
});
it('SSR returns independent account identity, explicitly restricted only on opt-in pages', async () => {
  const identity = { adminAccountId: 'account', account: { mustChangePassword: true } };
  mocks.token = 'new-token'; mocks.resolve.mockResolvedValue(identity);
  expect(await requireAdminPageAuth({ allowRestricted: true })).toBe(identity);
  expect(mocks.resolve).toHaveBeenLastCalledWith('new-token', { allowRestricted: true });
});
