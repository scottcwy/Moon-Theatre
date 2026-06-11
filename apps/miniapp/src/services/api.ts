import Taro from '@tarojs/taro';

const BASE_URL = API_BASE_URL || '';

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  url: string;
  method?: RequestMethod;
  data?: unknown;
  header?: Record<string, string>;
}

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

export interface StoredUser {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
}

export function getToken(): string {
  return Taro.getStorageSync(TOKEN_KEY) || '';
}

export function setToken(token: string): void {
  Taro.setStorageSync(TOKEN_KEY, token);
}

export function getUser(): StoredUser | null {
  try {
    const raw = Taro.getStorageSync(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
}

export function setUser(user: StoredUser): void {
  Taro.setStorageSync(USER_KEY, JSON.stringify(user));
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

  const token = getToken();
  if (token) {
    header['Authorization'] = `Bearer ${token}`;
  }

  const response = await Taro.request({
    url: `${BASE_URL}${url}`,
    method,
    data,
    header: {
      'Content-Type': 'application/json',
      ...header,
    },
  });

  if (response.statusCode === 401) {
    clearAuth();
    const pages = Taro.getCurrentPages();
    const currentPage = pages.length > 0 ? pages[pages.length - 1]?.route : '';
    if (currentPage !== 'pages/login/index') {
      Taro.reLaunch({ url: '/pages/login/index' });
    }
    throw new Error('登录已过期，请重新登录');
  }

  if (response.statusCode >= 400) {
    throw new Error(`API Error: ${response.statusCode} ${JSON.stringify(response.data)}`);
  }

  return response.data as T;
}

export const api = {
  get: <T>(url: string, header?: Record<string, string>) => request<T>({ url, method: 'GET', header }),
  post: <T>(url: string, data?: unknown, header?: Record<string, string>) => request<T>({ url, method: 'POST', data, header }),
  put: <T>(url: string, data?: unknown, header?: Record<string, string>) => request<T>({ url, method: 'PUT', data, header }),
  patch: <T>(url: string, data?: unknown, header?: Record<string, string>) => request<T>({ url, method: 'PATCH', data, header }),
  delete: <T>(url: string, header?: Record<string, string>) => request<T>({ url, method: 'DELETE', header }),
};
