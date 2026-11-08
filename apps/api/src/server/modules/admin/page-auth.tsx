import { cookies } from 'next/headers';
import { unstable_noStore as noStore } from 'next/cache';
import { resolveAdminToken } from './authentication.js';
import type { AdminIdentity } from './authentication.js';
import { ADMIN_SESSION_COOKIE } from './security.js';
export { ADMIN_SESSION_COOKIE } from './security.js';

export async function requireAdminPageAuth(options: { allowRestricted?: boolean } = {}): Promise<AdminIdentity | null> {
  noStore();
  const cookieStore = await cookies();
  try { return await resolveAdminToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value, options); }
  catch { return null; } // No page query on restricted, expired or unavailable authentication.
}
export function AdminIdentityRequired() {
  return <div><h1>需要管理员身份</h1><p>请登录独立管理员账号；首次登录须先修改密码。</p><a href="/admin/login">前往登录</a></div>;
}
