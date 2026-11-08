import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  MEDIA_MAX_BYTES,
  MEDIA_MAX_ASPECT_RATIO,
  MEDIA_MAX_DIMENSION,
  MEDIA_MIN_DIMENSION,
  mediaExtension,
  type MediaMime,
} from './limits.js';

export type MediaFileErrorCode = 'invalid_path' | 'not_found' | 'store_unavailable';

/**
 * Storage-level failure. `invalid_path` is never caused by request input (the path is derived from
 * a sha256 and a mime allowlist); it exists so a corrupted database row cannot turn into a read
 * outside the media root.
 */
export class MediaFileError extends Error {
  constructor(readonly code: MediaFileErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'MediaFileError';
  }
}

export class MediaBodyTooLargeError extends Error {
  constructor(message = 'media_too_large') {
    super(message);
    this.name = 'MediaBodyTooLargeError';
  }
}

const HASH_PATTERN = /^[a-f0-9]{64}$/;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = '';
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index] ?? 0);
  return value;
}

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

/**
 * The declared content type and the client filename are never consulted. Only the bytes decide,
 * and only the three image formats the product displays are accepted.
 */
export function sniffImageMime(bytes: Uint8Array): MediaMime | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (ascii(bytes, 12, 4) !== 'IHDR') return null;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function isJpegSof(marker: number): boolean {
  return (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
}

/** Walks the JPEG segments until the SOF header; a malformed stream is refused, never guessed. */
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  for (let segments = 0; segments < 256; segments += 1) {
    if (offset + 2 > bytes.length || bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1]!;
    while (marker === 0xff) {
      offset += 1;
      if (offset + 2 > bytes.length) return null;
      marker = bytes[offset + 1]!;
    }
    offset += 2;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // markers without a length
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / start of scan without any SOF
    if (offset + 2 > bytes.length) return null;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (isJpegSof(marker)) {
      if (length < 7) return null;
      return { width: u16be(bytes, offset + 5), height: u16be(bytes, offset + 3) };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 20) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X') {
    if (bytes.length < 30) return null;
    return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  }
  if (chunk === 'VP8L') {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null;
    const packed = u32le(bytes, 21);
    return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') {
    if (bytes.length < 30) return null;
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
  }
  return null;
}

/**
 * Reads only the dimension header — no decode, no re-encode, no resize. The product's stated
 * limitation is that a valid header is required, not a valid pixel stream; delivery always sets
 * `X-Content-Type-Options: nosniff`, so a header-only file cannot be interpreted as another type.
 */
export function readImageDimensions(bytes: Uint8Array, mime: MediaMime): { width: number; height: number } | null {
  if (mime === 'image/png') return pngDimensions(bytes);
  if (mime === 'image/jpeg') return jpegDimensions(bytes);
  if (mime === 'image/webp') return webpDimensions(bytes);
  return null;
}

export function isValidMediaDimensions(width: number, height: number): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (width < MEDIA_MIN_DIMENSION || height < MEDIA_MIN_DIMENSION) return false;
  if (width > MEDIA_MAX_DIMENSION || height > MEDIA_MAX_DIMENSION) return false;
  return Math.max(width, height) / Math.min(width, height) <= MEDIA_MAX_ASPECT_RATIO;
}

/**
 * `<root>/<hash[0:2]>/<hash>.<ext>`. The hash and extension are validated, and the resolved path is
 * checked again against the root: a traversal value (or a corrupted row) throws instead of being
 * resolved into a path outside the media root.
 */
export function mediaFilePath(root: string, contentHash: string, mime: string): string {
  if (!HASH_PATTERN.test(contentHash)) throw new MediaFileError('invalid_path', 'media_invalid_hash');
  const extension = mediaExtension(mime);
  if (!extension) throw new MediaFileError('invalid_path', 'media_invalid_mime');
  const base = path.resolve(root);
  const file = path.resolve(base, contentHash.slice(0, 2), `${contentHash}.${extension}`);
  const relative = path.relative(base, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new MediaFileError('invalid_path', 'media_path_outside_root');
  }
  return file;
}

export async function hasMediaFile(root: string, contentHash: string, mime: string): Promise<boolean> {
  const file = mediaFilePath(root, contentHash, mime);
  try {
    const info = await stat(file);
    return info.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new MediaFileError('store_unavailable', 'media_store_unavailable');
  }
}

/**
 * Writes through a uniquely named temp file in the SAME directory and renames it into place, so a
 * reader never observes a partially written asset. `existed` tells the caller whether the bytes were
 * already on disk (content addressing makes the second write a no-op), which is what keeps a failed
 * insert from deleting a file another upload produced.
 */
export async function writeMediaFile(
  root: string,
  contentHash: string,
  mime: string,
  bytes: Uint8Array,
): Promise<{ path: string; existed: boolean }> {
  const file = mediaFilePath(root, contentHash, mime);
  const directory = path.dirname(file);
  const existed = await hasMediaFile(root, contentHash, mime).catch(() => false);
  let temp: string | null = null;
  try {
    await mkdir(directory, { recursive: true });
    temp = path.join(directory, `.${contentHash}.${randomUUID()}.tmp`);
    const handle = await open(temp, 'wx', 0o640);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
    return { path: file, existed };
  } catch (error) {
    if (temp) await rm(temp, { force: true }).catch(() => {});
    if (error instanceof MediaFileError) throw error;
    throw new MediaFileError('store_unavailable', 'media_store_unavailable');
  }
}

export async function readMediaFile(root: string, contentHash: string, mime: string): Promise<Uint8Array> {
  const file = mediaFilePath(root, contentHash, mime);
  try {
    return new Uint8Array(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new MediaFileError('not_found', 'media_not_found');
    throw new MediaFileError('store_unavailable', 'media_store_unavailable');
  }
}

/**
 * Removes one content-addressed file. NOT used by the upload pipeline: a file without a row is
 * harmless and self-healing, while deleting a file that a concurrent identical upload already
 * observed can leave that upload's row without a file. Kept as the storage primitive a future,
 * non-racing maintenance/GC task would need (and exercised by its own tests).
 */
export async function removeMediaFile(root: string, contentHash: string, mime: string): Promise<void> {
  const file = mediaFilePath(root, contentHash, mime);
  await rm(file, { force: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return;
    throw new MediaFileError('store_unavailable', 'media_store_unavailable');
  });
}

/**
 * Bounded raw-body reader. The body is consumed chunk by chunk and the read is cancelled the moment
 * the limit is crossed, so an oversized upload never occupies memory proportional to its size (a
 * multipart/formData parse would buffer first).
 */
export async function readBoundedBody(
  stream: ReadableStream<Uint8Array> | null | undefined,
  maxBytes = MEDIA_MAX_BYTES,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new MediaBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already cancelled/closed */ }
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
