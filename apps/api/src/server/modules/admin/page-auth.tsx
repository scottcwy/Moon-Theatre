import { cookies } from 'next/headers';
import { config } from '../../config/index.js';
import { resolveAdminSession } from './audit.js';

export const ADMIN_SESSION_COOKIE = 'admin_session';

export async function requireAdminPageAuth(): Promise<{ userId: string } | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const identity = await resolveAdminSession(sessionId);
  if (!identity || !config.adminUserIds.includes(identity.userId)) {
    return null;
  }
  return identity;
}

export function AdminIdentityRequired() {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, color: '#ba1a1a' }}>Administrator identity required</h1>
      <p style={{ color: '#666', fontSize: 14 }}>
        Basic authentication is a deployment gate only. Create an administrator session with
        <code>POST /api/admin/session</code> using a whitelisted user JWT before opening this page.
      </p>
    </div>
  );
}
