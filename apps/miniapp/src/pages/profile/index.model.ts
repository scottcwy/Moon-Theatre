const PREFERRED_NAME_REQUIRED_MESSAGE = '请输入 1—20 个字符的对话称呼';
const PREFERRED_NAME_TOO_LONG_MESSAGE = '对话称呼最多 20 个字符';

export function getProfileDisplayName(
  preferredName: string | null | undefined,
  nickname: string | null | undefined,
): string {
  return preferredName?.trim() || nickname?.trim() || '我的';
}

export function getProfileStatusLabel(status: string | null | undefined): string {
  return !status || status === 'active' ? '已登录' : '状态待确认';
}

export function getPreferredNameSaveValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].length > 20) return null;
  return trimmed;
}

export function getPreferredNameError(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return PREFERRED_NAME_REQUIRED_MESSAGE;
  if ([...trimmed].length > 20) return PREFERRED_NAME_TOO_LONG_MESSAGE;
  return '';
}
