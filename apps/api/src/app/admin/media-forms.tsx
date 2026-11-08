'use client';

import { useEffect, useReducer, useRef } from 'react';
import { MEDIA_ACCEPT, MEDIA_LIMITS_COPY } from '@/server/modules/media/limits.js';
import { AdminRequestError } from './request.js';
import { initialMediaPickerState, mediaPickerReducer, uploadMedia } from './media-upload.js';

/**
 * Reusable local-media control: a file picker next to the pre-existing manual URL field.
 *
 * The returned URL is written into that same field, so the stored payload shape, the content
 * contract and every existing absolute URL stay untouched. The control never renders a server path,
 * the media root or a raw error; failures are mapped to the server's stable codes.
 */
export function MediaField({
  name,
  label,
  value,
  onValueChange,
  disabled = false,
  describedBy,
  previewAlt,
  required = true,
}: {
  name: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  describedBy?: string;
  previewAlt?: string;
  /** Character avatars are mandatory; a script cover is nullable and can be cleared. */
  required?: boolean;
}) {
  const [state, dispatch] = useReducer(mediaPickerReducer, initialMediaPickerState);
  const fileInput = useRef<HTMLInputElement>(null);
  const { file, pending, notice, error } = state;

  // A successful upload clears the state, but not the DOM value of the input: re-picking the same
  // file would then fire no `change` event and `上传并使用` would stay disabled until a page reload.
  useEffect(() => {
    if (state.inputResetCount > 0 && fileInput.current) fileInput.current.value = '';
  }, [state.inputResetCount]);

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    dispatch({ type: 'pick', file: event.target.files?.[0] ?? null });
  }

  async function upload() {
    if (!file || pending) return;
    dispatch({ type: 'upload-start' });
    try {
      const result = await uploadMedia(file);
      onValueChange(result.url);
      dispatch({ type: 'uploaded', reused: result.reused });
    } catch (cause) {
      const failure = cause instanceof AdminRequestError ? cause : new AdminRequestError('上传未完成，请稍后重试。');
      // The selection survives a failure, so the operator can retry the same file without re-picking.
      dispatch({ type: 'failed', message: failure.message });
      if (failure.redirectTo) window.location.assign(failure.redirectTo);
    }
  }

  const trimmed = value.trim();
  return <div className="media-field" data-media-field={name}>
    <label>{label}
      <input
        name={name}
        value={value}
        onChange={event => onValueChange(event.target.value)}
        disabled={disabled}
        aria-describedby={describedBy}
        placeholder="粘贴已有图片地址，或选择文件上传"
        spellCheck={false}
        required={required}
      />
    </label>
    <div className="media-picker">
      <input
        ref={fileInput}
        type="file"
        accept={MEDIA_ACCEPT}
        onChange={pick}
        disabled={disabled || pending}
        aria-label={`${label}：选择本地图片文件`}
        data-media-file={name}
      />
      <button type="button" className="button" onClick={upload} disabled={!file || pending || disabled} data-media-upload={name}>
        {pending ? '正在上传…' : '上传并使用'}
      </button>
    </div>
    <p className="muted" data-media-limits={name}>{MEDIA_LIMITS_COPY}</p>
    {trimmed && <div className="media-preview">
      <img src={trimmed} alt={previewAlt ?? `${label}预览`} data-media-preview={name} />
    </div>}
    <div role="status" aria-live="polite">{notice && <p className="notice success">{notice}</p>}</div>
    <div role="alert" aria-live="assertive">{error && <p className="notice error">{error}</p>}</div>
  </div>;
}
