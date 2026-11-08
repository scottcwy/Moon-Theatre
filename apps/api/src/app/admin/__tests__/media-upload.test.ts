import { describe, expect, it, vi } from 'vitest';
import { AdminRequestError } from '../request.js';
import { MEDIA_MAX_BYTES } from '@/server/modules/media/limits.js';
import {
  initialMediaPickerState,
  mediaPickerReducer,
  mediaUploadErrorCopy,
  mediaUploadIssue,
  uploadMedia,
} from '../media-upload.js';

function fileMock(size: number, bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])) {
  return { size, arrayBuffer: async () => bytes.buffer.slice(0) } as unknown as File;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('picker state machine', () => {
  const file = { name: 'avatar.png', size: 4 } as unknown as File;
  const other = { name: 'avatar-2.png', size: 4 } as unknown as File;
  const pick = (state = initialMediaPickerState, value: File | null = file) =>
    mediaPickerReducer(state, { type: 'pick', file: value });

  it('clears the picker after a successful upload so the same file can be uploaded again', () => {
    const uploaded = mediaPickerReducer(
      mediaPickerReducer(pick(), { type: 'upload-start' }),
      { type: 'uploaded', reused: false },
    );
    // The upload button is driven by `file`: null means it is disabled until a new pick arrives.
    expect(uploaded.file).toBeNull();
    expect(uploaded.pending).toBe(false);
    expect(uploaded.error).toBe('');
    expect(uploaded.notice).toContain('已上传并填入地址');
    // `inputResetCount` is the signal the control uses to clear the DOM input value, so re-picking
    // the same path fires a real `change` event instead of leaving the button disabled forever.
    expect(uploaded.inputResetCount).toBe(1);

    const repicked = pick(uploaded);
    expect(repicked.file).toBe(file);
    expect(repicked.notice).toBe('');
    expect(repicked.inputResetCount).toBe(1);
    const reuploaded = mediaPickerReducer(
      mediaPickerReducer(repicked, { type: 'upload-start' }),
      { type: 'uploaded', reused: true },
    );
    expect(reuploaded.inputResetCount).toBe(2);
    expect(reuploaded.notice).toContain('已复用同一个地址');
  });

  it('keeps the selected file after a failure so the same pick can simply be retried', () => {
    const failed = mediaPickerReducer(pick(), { type: 'failed', message: '素材存储暂时不可用，请稍后重试。' });
    expect(failed.file).toBe(file);
    expect(failed.pending).toBe(false);
    expect(failed.notice).toBe('');
    expect(failed.error).toContain('素材存储暂时不可用');
    // Nothing is cleared in the DOM, so the visible filename still matches the retryable selection.
    expect(failed.inputResetCount).toBe(0);
  });

  it('starts empty, disables the action without a pick and clears stale copy on a new pick', () => {
    expect(initialMediaPickerState).toEqual({ file: null, pending: false, notice: '', error: '', inputResetCount: 0 });
    expect(initialMediaPickerState.file).toBeNull();
    const pending = mediaPickerReducer(pick(), { type: 'upload-start' });
    expect(pending).toMatchObject({ file, pending: true, notice: '', error: '' });
    const failed = mediaPickerReducer(pending, { type: 'failed', message: '仅支持 PNG、JPEG、WebP。' });
    const restarted = pick(failed, other);
    expect(restarted).toMatchObject({ file: other, pending: false, notice: '', error: '' });
    // Clearing the picker (cancelling the native dialog) leaves no file to upload.
    expect(pick(restarted, null).file).toBeNull();
  });
});

describe('client-side media gate', () => {
  it('mirrors the server byte limit before spending a request', () => {
    expect(mediaUploadIssue(0)).toContain('空文件');
    expect(mediaUploadIssue(MEDIA_MAX_BYTES + 1)).toContain('5 MiB');
    expect(mediaUploadIssue(MEDIA_MAX_BYTES)).toBeNull();
    expect(mediaUploadIssue(1024)).toBeNull();
  });

  it('maps every stable server code to its own Chinese sentence', () => {
    const copies = [
      'media_type_unsupported', 'media_too_large', 'media_dimensions_invalid', 'media_store_unavailable',
      'admin_csrf_failed',
    ].map(mediaUploadErrorCopy);
    expect(new Set(copies).size).toBe(copies.length);
    for (const copy of copies) expect(copy.length).toBeGreaterThan(6);
    expect(mediaUploadErrorCopy('media_type_unsupported')).toContain('PNG');
    expect(mediaUploadErrorCopy('media_too_large')).toContain('5 MiB');
    expect(mediaUploadErrorCopy('media_dimensions_invalid')).toContain('4096');
    expect(mediaUploadErrorCopy('media_store_unavailable')).toContain('存储');
    expect(mediaUploadErrorCopy('something_else')).toContain('上传未完成');
  });
});

describe('uploadMedia', () => {
  it('posts the raw bytes with the documented CSRF material and returns the asset view', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      id: 'asset-1', url: 'https://api.example.test/api/media/asset-1', mime: 'image/png',
      byteSize: 4, width: 64, height: 64, reused: true,
    }));
    const result = await uploadMedia(fileMock(4), fetchMock as unknown as typeof fetch);
    expect(result).toMatchObject({ id: 'asset-1', url: 'https://api.example.test/api/media/asset-1', reused: true });
    const [path, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(path).toBe('/api/admin/media');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    expect(init.headers).toEqual({ 'Content-Type': 'application/octet-stream', 'X-Admin-Request': '1' });
    expect(new Uint8Array(init.body as ArrayBuffer).byteLength).toBe(4);
  });

  it('refuses an oversize file without calling the server', async () => {
    const fetchMock = vi.fn();
    await expect(uploadMedia(fileMock(MEDIA_MAX_BYTES + 1), fetchMock as unknown as typeof fetch))
      .rejects.toBeInstanceOf(AdminRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [413, 'media_too_large', '5 MiB'],
    [415, 'media_type_unsupported', 'PNG'],
    [400, 'media_dimensions_invalid', '4096'],
    [503, 'media_store_unavailable', '存储'],
  ])('turns a %i %s response into its own copy', async (status, code, expected) => {
    const fetchMock = vi.fn(async () => jsonResponse(status, { error: code }));
    const failure = await uploadMedia(fileMock(4), fetchMock as unknown as typeof fetch).catch(cause => cause);
    expect(failure).toBeInstanceOf(AdminRequestError);
    expect((failure as AdminRequestError).code).toBe(code);
    expect((failure as AdminRequestError).message).toContain(expected);
  });

  it('sends an expired session to the login page and keeps the CSRF failure visible', async () => {
    const expired = await uploadMedia(fileMock(4), (async () => jsonResponse(401, { error: 'admin_unauthenticated' })) as unknown as typeof fetch)
      .catch(cause => cause);
    expect(expired).toBeInstanceOf(AdminRequestError);
    expect((expired as AdminRequestError).redirectTo).toBe('/admin/login?notice=expired');

    const csrf = await uploadMedia(fileMock(4), (async () => jsonResponse(403, { error: 'admin_csrf_failed' })) as unknown as typeof fetch)
      .catch(cause => cause);
    expect((csrf as AdminRequestError).message).toContain('安全校验');
  });

  it('reports a network failure instead of a fabricated success', async () => {
    const failure = await uploadMedia(fileMock(4), (async () => { throw new Error('offline'); }) as unknown as typeof fetch)
      .catch(cause => cause);
    expect(failure).toBeInstanceOf(AdminRequestError);
    expect((failure as AdminRequestError).message).toContain('网络连接失败');
  });
});
