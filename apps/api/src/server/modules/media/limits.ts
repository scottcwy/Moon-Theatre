/**
 * Local media limits shared by the upload service, the strict delivery route and the browser control.
 * Dependency-free on purpose (the same pattern as `model-limits.ts`): the numbers and copy the form
 * shows are the numbers the server enforces, so a value the UI accepts can never be refused for a
 * different reason than the one it displayed.
 */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_MAX_DIMENSION = 4096;
export const MEDIA_MIN_DIMENSION = 1;
/** 20:1 accepts covers and portraits while refusing a "text file dressed as a banner" shape. */
export const MEDIA_MAX_ASPECT_RATIO = 20;

export const MEDIA_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type MediaMime = (typeof MEDIA_MIME_TYPES)[number];

export const MEDIA_EXTENSIONS: Record<MediaMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * The upload is a RAW body, not JSON and not multipart: `request.formData()` buffers the whole
 * payload before any bound can be applied. These are the only accepted `Content-Type` values; the
 * declared value is never used to decide the stored type (the magic bytes are).
 */
export const MEDIA_UPLOAD_CONTENT_TYPES = ['application/octet-stream', 'image/png', 'image/jpeg', 'image/webp'] as const;

export const MEDIA_ACCEPT = MEDIA_MIME_TYPES.join(',');

export const MEDIA_LIMITS_COPY = `支持 PNG / JPEG / WebP；单张不超过 5 MiB；每边 ${MEDIA_MIN_DIMENSION}–${MEDIA_MAX_DIMENSION} 像素，长宽比不超过 ${MEDIA_MAX_ASPECT_RATIO}:1。上传后自动填入地址，已发布的旧引用不会失效。`;

export function mediaExtension(mime: string): string | null {
  return mime in MEDIA_EXTENSIONS ? MEDIA_EXTENSIONS[mime as MediaMime] : null;
}
