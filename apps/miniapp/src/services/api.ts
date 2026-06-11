import Taro from '@tarojs/taro';

const BASE_URL = process.env.API_BASE_URL || '';

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  url: string;
  method?: RequestMethod;
  data?: unknown;
  header?: Record<string, string>;
}

function getToken(): string {
  return Taro.getStorageSync('token') || '';
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