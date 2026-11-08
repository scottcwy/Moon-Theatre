import { AdminRequestError } from './request.js';
import { MEDIA_MAX_BYTES } from '@/server/modules/media/limits.js';

export interface MediaUploadResult {
  id: string;
  url: string;
  mime: string;
  byteSize: number;
  width: number;
  height: number;
  reused: boolean;
}

/** The small part of `File` the upload needs, so the contract stays testable without a DOM. */
export interface UploadableFile {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const errorCopy: Record<string, string> = {
  media_type_unsupported: '仅支持 PNG、JPEG、WebP 图片；文件扩展名与声明类型不参与判断。',
  media_too_large: '图片不能超过 5 MiB，请压缩后重新上传。',
  media_dimensions_invalid: '图片尺寸不符合要求：每边 1–4096 像素，长宽比不超过 20:1。',
  media_store_unavailable: '素材存储暂时不可用，本次没有上传成功，请稍后重试。',
  admin_csrf_failed: '请求未通过安全校验，请刷新页面后重试。',
  admin_dependency_unavailable: '服务暂时不可用，请稍后重试。',
};

export function mediaUploadErrorCopy(code: string): string {
  return errorCopy[code] ?? '上传未完成，请检查图片后重试。';
}

/** Mirrors the server byte limit; the type and dimensions stay the server's decision. */
export function mediaUploadIssue(size: number): string | null {
  if (size <= 0) return '不能上传空文件，请重新选择图片。';
  if (size > MEDIA_MAX_BYTES) return '图片不能超过 5 MiB，请压缩后重新上传。';
  return null;
}

/**
 * State machine of the picker+upload control, kept pure so it is testable without a DOM.
 *
 * The DOM `<input type="file">` keeps its value after an upload, and re-picking the *same* file then
 * fires no `change` event: the control would stay disabled forever. `inputResetCount` is the signal
 * the component uses to clear the input value after a successful upload, so the same file can be
 * picked again. A failure keeps the selection (the operator can simply retry) and clears nothing.
 */
export interface MediaPickerState {
  file: File | null;
  pending: boolean;
  notice: string;
  error: string;
  inputResetCount: number;
}

export type MediaPickerEvent =
  | { type: 'pick'; file: File | null }
  | { type: 'upload-start' }
  | { type: 'uploaded'; reused: boolean }
  | { type: 'failed'; message: string };

export const initialMediaPickerState: MediaPickerState = {
  file: null, pending: false, notice: '', error: '', inputResetCount: 0,
};

export function mediaPickerReducer(state: MediaPickerState, event: MediaPickerEvent): MediaPickerState {
  switch (event.type) {
    case 'pick':
      return { ...state, file: event.file, notice: '', error: '' };
    case 'upload-start':
      if (!state.file || state.pending) return state;
      return { ...state, pending: true, notice: '', error: '' };
    case 'uploaded':
      return {
        file: null,
        pending: false,
        notice: event.reused
          ? '这份图片之前已上传，已复用同一个地址（不会产生重复文件）。'
          : '已上传并填入地址：保存本页后生效。',
        error: '',
        inputResetCount: state.inputResetCount + 1,
      };
    case 'failed':
      return { ...state, pending: false, notice: '', error: event.message };
  }
}

/**
 * One raw-body POST. Only the CSRF material is set here; the browser supplies `Content-Length`, and
 * the server never trusts a declared type or a filename. A session expiry redirects to the login
 * page like every other admin transport; failures keep the stable server code and its own copy.
 */
export async function uploadMedia(
  file: UploadableFile,
  fetchImpl: typeof fetch = fetch,
): Promise<MediaUploadResult> {
  const issue = mediaUploadIssue(file.size);
  if (issue) throw new AdminRequestError(issue, undefined, undefined, 'media_too_large', undefined, 413);

  let response: Response;
  try {
    response = await fetchImpl('/api/admin/media', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Admin-Request': '1' },
      body: await file.arrayBuffer(),
    });
  } catch {
    throw new AdminRequestError('网络连接失败，请检查连接后重试。');
  }

  const data: unknown = await response.json().catch(() => ({}));
  if (response.ok) return data as MediaUploadResult;

  const body = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
  const code = typeof body.error === 'string' ? body.error : '';
  if (response.status === 401) {
    throw new AdminRequestError('登录已失效，请重新登录。', '/admin/login?notice=expired', undefined, code, data, response.status);
  }
  throw new AdminRequestError(
    mediaUploadErrorCopy(code),
    undefined,
    undefined,
    code || undefined,
    data,
    response.status,
  );
}
