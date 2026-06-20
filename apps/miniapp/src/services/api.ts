import Taro from '@tarojs/taro';

const BASE_URL = API_BASE_URL;
const DEV_TOKEN = 'dev-auth-bypass-token';
const DEV_USER: StoredUser = {
  id: 'dev-user',
  nickname: '开发调试用户',
  avatarUrl: null,
};

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  url: string;
  method?: RequestMethod;
  data?: unknown;
  header?: Record<string, string>;
}

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

export type ApiErrorCode = 'AUTH_EXPIRED' | 'API_ERROR';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly statusCode: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isAuthExpiredError(error: unknown): error is ApiError {
  return isApiError(error) && error.code === 'AUTH_EXPIRED';
}

export interface StoredUser {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
}

export function getToken(): string {
  const token = Taro.getStorageSync(TOKEN_KEY) || '';
  if (!token && DEV_AUTH_BYPASS) {
    return DEV_TOKEN;
  }
  return token;
}

export function setToken(token: string): void {
  Taro.setStorageSync(TOKEN_KEY, token);
}

export function getUser(): StoredUser | null {
  try {
    const raw = Taro.getStorageSync(USER_KEY);
    if (raw) return JSON.parse(raw) as StoredUser;
    return DEV_AUTH_BYPASS ? DEV_USER : null;
  } catch {
    return DEV_AUTH_BYPASS ? DEV_USER : null;
  }
}

export function setUser(user: StoredUser): void {
  Taro.setStorageSync(USER_KEY, JSON.stringify(user));
}

export function applyDevAuthBypass(): boolean {
  if (!DEV_AUTH_BYPASS) return false;
  setToken(DEV_TOKEN);
  setUser(DEV_USER);
  return true;
}

export function clearAuth(): void {
  Taro.removeStorageSync(TOKEN_KEY);
  Taro.removeStorageSync(USER_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

async function request<T>(options: RequestOptions): Promise<T> {
  const { url, method = 'GET', data, header = {} } = options;
  const requestUrl = `${BASE_URL}${url}`;

  const token = getToken();
  if (token) {
    header['Authorization'] = `Bearer ${token}`;
  }

  let response: Taro.request.SuccessCallbackResult;
  try {
    response = await Taro.request({
      url: requestUrl,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...header,
      },
    });
  } catch (err) {
    const reason = getNetworkErrorMessage(err);
    throw new ApiError('API_ERROR', 0, `网络请求失败: ${method} ${requestUrl} (${reason})`, err);
  }

  if (response.statusCode === 401) {
    clearAuth();
    throw new ApiError('AUTH_EXPIRED', 401, '登录已过期，请重新登录', response.data);
  }

  if (response.statusCode >= 400) {
    const message = getErrorMessage(response.data, `API Error: ${response.statusCode}`);
    throw new ApiError('API_ERROR', response.statusCode, message, response.data);
  }

  return response.data as T;
}

function getNetworkErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.errMsg === 'string') return record.errMsg;
    if (typeof record.message === 'string') return record.message;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown';
}

function getErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.error === 'string') return record.error;
    if (typeof record.message === 'string') return record.message;
  }
  return fallback;
}

export interface StreamCallbacks {
  onDelta: (content: string) => void;
  onDone: (result: {
    messageId: string;
    sessionId: string;
    mood?: string;
    fallback?: boolean;
    bondLevel?: number;
    bondExp?: number;
    balanceAfter?: number;
  }) => void;
  onError: (message: string) => void;
  onAuthExpired?: () => void;
}

function decodeChunk(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    const textDecoderCtor = (globalThis as unknown as {
      TextDecoder?: new () => { decode: (input: ArrayBuffer) => string };
    }).TextDecoder;
    if (textDecoderCtor) {
      return new textDecoderCtor().decode(data);
    }
    return String.fromCharCode(...new Uint8Array(data));
  }
  return '';
}

export function streamChat(
  payload: {
    characterId: string;
    sessionId?: string;
    message: string;
    modelTier: string;
  },
  callbacks: StreamCallbacks
): { abort: () => void } {
  const token = getToken() || '';
  let buffer = '';

  const processStreamText = (text: string) => {
    buffer += text;

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.type === 'delta' && parsed.content) {
          callbacks.onDelta(parsed.content);
        } else if (parsed.type === 'done') {
          callbacks.onDone({
            messageId: parsed.messageId,
            sessionId: parsed.sessionId,
            mood: parsed.mood,
            fallback: parsed.fallback,
            bondLevel: parsed.bondLevel,
            bondExp: parsed.bondExp,
            balanceAfter: parsed.balanceAfter,
          });
        } else if (parsed.type === 'error') {
          callbacks.onError(parsed.message || 'Stream error');
        }
      } catch {
        continue;
      }
    }
  };

  const requestTask = Taro.request({
    url: `${BASE_URL}/api/chat/stream`,
    method: 'POST',
    data: payload,
    header: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    enableChunked: true,
    responseType: 'text',
    success(res) {
      if (res.statusCode === 401) {
        clearAuth();
        callbacks.onAuthExpired?.();
        callbacks.onError('登录已过期，请重新登录');
        return;
      }
      if (res.statusCode === 402) {
        const data = res.data as string;
        try {
          const parsed = JSON.parse(data);
          callbacks.onError(parsed.error || '点数不足');
        } catch {
          callbacks.onError('点数不足');
        }
        return;
      }
      if (res.statusCode >= 400) {
        callbacks.onError(`请求失败 (${res.statusCode})`);
        return;
      }

      const data = decodeChunk(res.data);
      if (data) {
        processStreamText(data.endsWith('\n') ? data : `${data}\n`);
      }
    },
    fail(err) {
      const message = err.errMsg || 'Stream request failed';
      callbacks.onError(message);
    },
  });

  requestTask.onChunkReceived((res) => {
    const chunk = decodeChunk(res.data);
    processStreamText(chunk);
  });

  return {
    abort: () => requestTask.abort(),
  };
}

export const api = {
  get: <T>(url: string, header?: Record<string, string>) => request<T>({ url, method: 'GET', header }),
  post: <T>(url: string, data?: unknown, header?: Record<string, string>) => request<T>({ url, method: 'POST', data, header }),
  put: <T>(url: string, data?: unknown, header?: Record<string, string>) => request<T>({ url, method: 'PUT', data, header }),
  patch: <T>(url: string, data?: unknown, header?: Record<string, string>) => request<T>({ url, method: 'PATCH', data, header }),
  delete: <T>(url: string, header?: Record<string, string>) => request<T>({ url, method: 'DELETE', header }),
  streamChat,
};
