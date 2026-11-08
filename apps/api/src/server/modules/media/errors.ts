import { HttpError } from '../../http/errors.js';

export type MediaErrorCode =
  | 'media_type_unsupported'
  | 'media_too_large'
  | 'media_dimensions_invalid'
  | 'media_store_unavailable'
  | 'media_not_found';

const MEDIA_ERROR_STATUS: Record<MediaErrorCode, number> = {
  media_type_unsupported: 415,
  media_too_large: 413,
  media_dimensions_invalid: 400,
  media_store_unavailable: 503,
  media_not_found: 404,
};

/** Stable code + precise status; the browser maps the code to Chinese copy, never to a raw error. */
export class MediaError extends HttpError {
  constructor(readonly code: MediaErrorCode) {
    super(code, MEDIA_ERROR_STATUS[code]);
    this.name = 'MediaError';
  }
}
