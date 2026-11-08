// Small same-origin transport for the colocated admin forms. Never handles session tokens.
export class AdminRequestError extends Error {
  constructor(
    message: string,
    readonly redirectTo?: string,
    readonly retryAfter?: number,
    /** Stable server error code, when the response carried one. */
    readonly code?: string,
    /** Response body, for surfaces that render field-level issues. Never a session or token value. */
    readonly details?: unknown,
    /** HTTP status, so a caller can tell "no such row" (404) from an outage. */
    readonly status?: number,
  ) { super(message); }
}
const errorCopy: Record<string, string> = {
  admin_login_failed: '邮箱或密码不正确，或账号不可用。请核对后重试。',
  admin_current_password_invalid: '当前密码不正确，请重新输入。',
  admin_password_invalid: '密码不符合要求：请使用 15–128 个字符，避免常见弱密码。',
  admin_input_invalid: '填写内容不符合要求，请检查邮箱与密码。',
  admin_account_conflict: '该邮箱已被使用，请更换邮箱。',
  admin_credentials_changed: '账号凭据已变更，请重新登录后操作。',
  admin_account_forbidden: '不能操作此账号。受保护账号与当前账号不能在此重置或停用。',
  admin_account_not_found: '账号已不存在，请刷新列表。',
  admin_csrf_failed: '请求未通过安全校验，请刷新页面后重试。',
};
export async function adminRequest<T = unknown>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: object,
): Promise<T> {
  // Writes carry the CSRF material the admin guard requires; reads use the same cookie-bound,
  // no-store transport so the console never caches private figures.
  const write = method !== 'GET';
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(write
        ? { headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify(body) }
        : {}),
    });
  } catch { throw new AdminRequestError('网络连接失败，请检查连接后重试。'); }
  const data: unknown = await response.json().catch(() => ({}));
  if (response.ok) return data as T;
  const code = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string' ? data.error : '';
  const fail = (message: string, redirectTo?: string, retryAfter?: number) =>
    new AdminRequestError(message, redirectTo, retryAfter, code, data, response.status);
  if (response.status === 401) {
    if (path === '/api/admin/session' && method === 'POST') throw fail(errorCopy.admin_login_failed ?? '登录失败，请核对邮箱与密码。');
    throw fail('登录已失效，请重新登录。', '/admin/login?notice=expired');
  }
  if (response.status === 403 && code === 'admin_password_change_required')
    throw fail('请先修改初始密码。', '/admin/change-password');
  if (response.status === 429) {
    const header = response.headers.get('Retry-After');
    const seconds = header && /^\d+$/.test(header) ? Math.max(1, Number(header)) : Math.max(1, Math.ceil((Date.parse(header ?? '') - Date.now()) / 1000) || 60);
    throw fail(`尝试过于频繁，请在 ${seconds} 秒后手动重试。`, undefined, seconds);
  }
  if (response.status === 503) throw fail('服务暂时不可用，请稍后手动重试。');
  throw fail(errorCopy[code] ?? (response.status === 403 ? '没有执行此操作的权限，请检查账号状态。' : '操作未完成，请检查填写内容后重试。'));
}
export function passwordConfirmationError(password: string, confirmation: string): string | null {
  if (password !== confirmation) return '两次输入的密码不一致，请重新确认。';
  const length = Array.from(password).length;
  return length < 15 || length > 128 ? '密码须为 15–128 个字符（表情按一个字符计）。' : null;
}
