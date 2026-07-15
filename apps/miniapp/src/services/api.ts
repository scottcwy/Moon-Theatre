import Taro from '@tarojs/taro';
import type { ChatMode } from '../types';

const BASE_URL = API_BASE_URL;
const DEV_TOKEN = 'dev-auth-bypass-token';
const API_REQUEST_TIMEOUT_MS = 30000;
const CHAT_STREAM_REQUEST_TIMEOUT_MS = 130000;
const IDEMPOTENT_REQUEST_MAX_ATTEMPTS = 2;
const IDEMPOTENT_REQUEST_RETRY_DELAY_MS = 300;
const API_DEBUG_LOG_PREFIX = '[api]';
const DEV_USER: StoredUser = {
  id: 'dev-user',
  nickname: '开发调试用户',
  avatarUrl: null,
  preferredName: null,
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
  preferredName: string | null;
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
    if (raw) return normalizeStoredUser(JSON.parse(raw));
    return DEV_AUTH_BYPASS ? DEV_USER : null;
  } catch {
    return DEV_AUTH_BYPASS ? DEV_USER : null;
  }
}

function normalizeStoredUser(value: unknown): StoredUser {
  const user = value as Partial<StoredUser>;
  return {
    id: user.id || '',
    nickname: user.nickname ?? null,
    avatarUrl: user.avatarUrl ?? null,
    preferredName: user.preferredName ?? null,
  };
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

export async function verifyStoredAuth(): Promise<boolean> {
  if (!getToken()) return false;

  try {
    const user = await api.get<StoredUser & { status?: string }>('/api/me');
    if (user.status && user.status !== 'active') {
      clearAuth();
      return false;
    }
    setUser({
      id: user.id,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      preferredName: user.preferredName,
    });
    return true;
  } catch (error) {
    if (isAuthExpiredError(error)) {
      return false;
    }
    if (isApiError(error) && error.statusCode === 0) {
      return true;
    }
    clearAuth();
    return false;
  }
}

async function request<T>(options: RequestOptions): Promise<T> {
  const { url, method = 'GET', data, header = {} } = options;
  const requestUrl = `${BASE_URL}${url}`;

  const token = getToken();
  if (token) {
    header['Authorization'] = `Bearer ${token}`;
  }

  const maxAttempts = method === 'GET' ? IDEMPOTENT_REQUEST_MAX_ATTEMPTS : 1;
  let response: Taro.request.SuccessCallbackResult | undefined;
  let lastNetworkError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    logApiRequestStart(method, requestUrl, attempt, maxAttempts);
    try {
      response = await Taro.request({
        url: requestUrl,
        method,
        data,
        header: {
          'Content-Type': 'application/json',
          ...header,
        },
        timeout: API_REQUEST_TIMEOUT_MS,
      });
      logApiRequestSuccess(method, requestUrl, attempt, startedAt, response.statusCode);
      lastNetworkError = undefined;
      break;
    } catch (err) {
      lastNetworkError = err;
      logApiRequestFailure(method, requestUrl, attempt, startedAt, err);
      if (attempt >= maxAttempts || !isTransientNetworkError(err)) {
        break;
      }
      await delay(IDEMPOTENT_REQUEST_RETRY_DELAY_MS);
    }
  }

  if (!response) {
    const reason = getNetworkErrorMessage(lastNetworkError);
    throw new ApiError('API_ERROR', 0, `网络请求失败: ${method} ${requestUrl} (${reason})`, lastNetworkError);
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

function logApiRequestStart(method: RequestMethod, requestUrl: string, attempt: number, maxAttempts: number): void {
  if (!API_DEBUG_LOGS) return;
  console.info(`${API_DEBUG_LOG_PREFIX} ${method} ${requestUrl} attempt ${attempt}/${maxAttempts} start`);
}

function logApiRequestSuccess(
  method: RequestMethod,
  requestUrl: string,
  attempt: number,
  startedAt: number,
  statusCode: number,
): void {
  if (!API_DEBUG_LOGS) return;
  console.info(
    `${API_DEBUG_LOG_PREFIX} ${method} ${requestUrl} attempt ${attempt} success ${statusCode} in ${Date.now() - startedAt}ms`,
  );
}

function logApiRequestFailure(
  method: RequestMethod,
  requestUrl: string,
  attempt: number,
  startedAt: number,
  error: unknown,
): void {
  if (!API_DEBUG_LOGS) return;
  console.warn(
    `${API_DEBUG_LOG_PREFIX} ${method} ${requestUrl} attempt ${attempt} failed in ${Date.now() - startedAt}ms: ${getNetworkErrorMessage(error)}`,
  );
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

function isTransientNetworkError(error: unknown): boolean {
  const message = getNetworkErrorMessage(error).toLowerCase();
  return message.includes('timeout') || message.includes('abort') || message.includes('socket hang up');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    mode: ChatMode;
    clientMessageId?: string;
    mood?: string;
    fallback?: boolean;
    replayed?: boolean;
    blocked?: boolean;
    outOfScope?: boolean;
    bondLevel?: number;
    bondExp?: number;
    unlockedAchievements?: unknown[];
    unlockedTitles?: unknown[];
    balanceAfter?: number;
  }) => void;
  onError: (message: string) => void;
  onAuthExpired?: () => void;
}

interface StreamChatBasePayload {
  characterId: string;
  sessionId?: string;
  message: string;
  modelTier: string;
  clientMessageId?: string;
}

export type StreamChatPayload = StreamChatBasePayload & (
  | { mode: 'script'; scriptId: string }
  | { mode: 'free'; scriptId?: never }
);

interface ChunkDecoder {
  decode: (data: unknown) => string;
  flush: () => string;
}

function createChunkDecoder(): ChunkDecoder {
  const textDecoderCtor = (globalThis as unknown as {
    TextDecoder?: new (label?: string) => {
      decode: (input?: ArrayBufferView | ArrayBuffer, options?: { stream?: boolean }) => string;
    };
  }).TextDecoder;

  if (textDecoderCtor) {
    const decoder = new textDecoderCtor('utf-8');
    return {
      decode(data: unknown): string {
        if (typeof data === 'string') {
          return data;
        }
        if (data instanceof ArrayBuffer) {
          return decoder.decode(new Uint8Array(data), { stream: true });
        }
        return '';
      },
      flush(): string {
        return decoder.decode();
      },
    };
  }

  let pending = new Uint8Array(0);
  return {
    decode(data: unknown): string {
      if (typeof data === 'string') {
        return data;
      }
      if (!(data instanceof ArrayBuffer)) {
        return '';
      }

      const bytes = concatBytes(pending, new Uint8Array(data));
      const pendingLength = getIncompleteUtf8TailLength(bytes);
      const completeLength = bytes.length - pendingLength;
      pending = pendingLength > 0 ? bytes.slice(completeLength) : new Uint8Array(0);

      return decodeUtf8Bytes(bytes.slice(0, completeLength));
    },
    flush(): string {
      const text = pending.length > 0 ? decodeUtf8Bytes(pending) : '';
      pending = new Uint8Array(0);
      return text;
    },
  };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function getIncompleteUtf8TailLength(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;

  let start = bytes.length - 1;
  while (start >= 0 && (bytes[start]! & 0xc0) === 0x80) {
    start -= 1;
  }

  if (start < 0) return bytes.length;

  const lead = bytes[start]!;
  const expected = lead < 0x80 ? 1 : (lead & 0xe0) === 0xc0 ? 2 : (lead & 0xf0) === 0xe0 ? 3 : (lead & 0xf8) === 0xf0 ? 4 : 1;
  const available = bytes.length - start;

  return available < expected ? available : 0;
}

function decodeUtf8Bytes(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i]!;

    if (first < 0x80) {
      output += String.fromCharCode(first);
      i += 1;
      continue;
    }

    if ((first & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      output += String.fromCharCode(((first & 0x1f) << 6) | (bytes[i + 1]! & 0x3f));
      i += 2;
      continue;
    }

    if ((first & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      output += String.fromCharCode(((first & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f));
      i += 3;
      continue;
    }

    if ((first & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      const codePoint = ((first & 0x07) << 18) | ((bytes[i + 1]! & 0x3f) << 12) | ((bytes[i + 2]! & 0x3f) << 6) | (bytes[i + 3]! & 0x3f);
      output += String.fromCodePoint(codePoint);
      i += 4;
      continue;
    }

    output += '\uFFFD';
    i += 1;
  }
  return output;
}

function decodeChunk(data: unknown, decoder: ChunkDecoder): string {
  if (typeof data === 'string') {
    return data;
  }
  return decoder.decode(data);
}

export function streamChat(
  payload: StreamChatPayload,
  callbacks: StreamCallbacks
): { abort: () => void } {
  const token = getToken() || '';
  let buffer = '';
  let receivedChunk = false;
  const chunkDecoder = createChunkDecoder();

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
            mode: parsed.mode,
            clientMessageId: parsed.clientMessageId,
            mood: parsed.mood,
            fallback: parsed.fallback,
            replayed: parsed.replayed,
            blocked: parsed.blocked,
            outOfScope: parsed.outOfScope,
            bondLevel: parsed.bondLevel,
            bondExp: parsed.bondExp,
            unlockedAchievements: parsed.unlockedAchievements,
            unlockedTitles: parsed.unlockedTitles,
            balanceAfter: parsed.balanceAfter,
          });
        } else if (parsed.type === 'error') {
          callbacks.onError(parsed.code || parsed.message || 'unknown');
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
    timeout: CHAT_STREAM_REQUEST_TIMEOUT_MS,
    success(res) {
      if (res.statusCode === 401) {
        clearAuth();
        if (callbacks.onAuthExpired) callbacks.onAuthExpired();
        else callbacks.onError('auth_expired');
        return;
      }
      if (res.statusCode === 402) {
        callbacks.onError(getStreamErrorCode(res.data, 'insufficient_points'));
        return;
      }
      if (res.statusCode >= 400) {
        callbacks.onError(getStreamErrorCode(res.data, 'unknown'));
        return;
      }

      const data = receivedChunk ? chunkDecoder.flush() : decodeChunk(res.data, chunkDecoder) + chunkDecoder.flush();
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
    receivedChunk = true;
    const chunk = decodeChunk(res.data, chunkDecoder);
    processStreamText(chunk);
  });

  return {
    abort: () => requestTask.abort(),
  };
}

function getStreamErrorCode(data: unknown, fallback: string): string {
  if (typeof data === 'string') {
    try {
      return getStreamErrorCode(JSON.parse(data), fallback);
    } catch {
      return fallback;
    }
  }
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.error === 'string') return record.error;
    if (typeof record.code === 'string') return record.code;
  }
  return fallback;
}

export const api = {
  get: <T>(url: string, header?: Record<string, string>) => request<T>({ url, method: 'GET', header }),
  post: <T>(url: string, data?: unknown, header?: Record<string, string>) => request<T>({ url, method: 'POST', data, header }),
  put: <T>(url: string, data?: unknown, header?: Record<string, string>) => request<T>({ url, method: 'PUT', data, header }),
  patch: <T>(url: string, data?: unknown, header?: Record<string, string>) => request<T>({ url, method: 'PATCH', data, header }),
  delete: <T>(url: string, header?: Record<string, string>) => request<T>({ url, method: 'DELETE', header }),
  streamChat,
};
