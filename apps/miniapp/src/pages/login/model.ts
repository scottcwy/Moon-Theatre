export function getLoginErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (statusCode === 400 || statusCode === 401) {
      return '微信登录凭证无效，请重试';
    }
    if (statusCode === 503) {
      return '微信登录暂不可用，请稍后再试';
    }
  }
  return '登录失败，请重试';
}
