import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MediaBodyTooLargeError,
  MediaFileError,
  hasMediaFile,
  isValidMediaDimensions,
  mediaFilePath,
  readBoundedBody,
  readImageDimensions,
  readMediaFile,
  removeMediaFile,
  sniffImageMime,
  writeMediaFile,
} from '../storage.js';
import {
  gifBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
  textBytes,
  webpExtendedBytes,
  webpLosslessBytes,
  webpLossyBytes,
} from './image-fixtures.js';

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'media-storage-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const hash = 'ab'.repeat(32);

describe('magic-byte sniffing', () => {
  it('accepts exactly the three allowed image signatures', () => {
    expect(sniffImageMime(pngBytes())).toBe('image/png');
    expect(sniffImageMime(jpegBytes())).toBe('image/jpeg');
    expect(sniffImageMime(webpExtendedBytes())).toBe('image/webp');
    expect(sniffImageMime(webpLosslessBytes())).toBe('image/webp');
    expect(sniffImageMime(webpLossyBytes())).toBe('image/webp');
  });

  it('rejects anything else, including a renamed or truncated file', () => {
    expect(sniffImageMime(gifBytes())).toBeNull();
    expect(sniffImageMime(pdfBytes())).toBeNull();
    expect(sniffImageMime(textBytes())).toBeNull();
    expect(sniffImageMime(new Uint8Array(0))).toBeNull();
    expect(sniffImageMime(pngBytes().slice(0, 4))).toBeNull();
    // A RIFF container that is not WEBP (e.g. WAV) is not an image.
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20]);
    expect(sniffImageMime(wav)).toBeNull();
  });
});

describe('header-only dimension parsing', () => {
  it('reads PNG IHDR width/height without decoding the image', () => {
    expect(readImageDimensions(pngBytes(640, 480), 'image/png')).toEqual({ width: 640, height: 480 });
  });

  it('walks JPEG segments to the SOF marker', () => {
    expect(readImageDimensions(jpegBytes(1080, 1920), 'image/jpeg')).toEqual({ width: 1080, height: 1920 });
  });

  it('reads every WEBP variant header', () => {
    expect(readImageDimensions(webpExtendedBytes(1200, 675), 'image/webp')).toEqual({ width: 1200, height: 675 });
    expect(readImageDimensions(webpLosslessBytes(300, 200), 'image/webp')).toEqual({ width: 300, height: 200 });
    expect(readImageDimensions(webpLossyBytes(320, 240), 'image/webp')).toEqual({ width: 320, height: 240 });
  });

  it('returns null for a truncated or bogus header instead of guessing', () => {
    expect(readImageDimensions(pngBytes().slice(0, 20), 'image/png')).toBeNull();
    expect(readImageDimensions(jpegBytes().slice(0, 30), 'image/jpeg')).toBeNull();
    expect(readImageDimensions(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg')).toBeNull();
    expect(readImageDimensions(webpExtendedBytes().slice(0, 24), 'image/webp')).toBeNull();
    expect(readImageDimensions(new Uint8Array(0), 'image/webp')).toBeNull();
  });

  it('enforces per-side limits and a bounded aspect ratio', () => {
    expect(isValidMediaDimensions(1, 1)).toBe(true);
    expect(isValidMediaDimensions(4096, 4096)).toBe(true);
    expect(isValidMediaDimensions(0, 100)).toBe(false);
    expect(isValidMediaDimensions(4097, 100)).toBe(false);
    expect(isValidMediaDimensions(-1, 100)).toBe(false);
    expect(isValidMediaDimensions(Number.NaN, 100)).toBe(false);
    // 20:1 is the documented ceiling; 21:1 is refused.
    expect(isValidMediaDimensions(4000, 200)).toBe(true);
    expect(isValidMediaDimensions(4200, 200)).toBe(false);
  });
});

describe('content-addressed file paths', () => {
  it('lays files out as <root>/<hash[0:2]>/<hash>.<ext>', async () => {
    const root = await tempRoot();
    const file = mediaFilePath(root, hash, 'image/png');
    expect(file).toBe(path.join(path.resolve(root), 'ab', `${hash}.png`));
    expect(file.startsWith(`${path.resolve(root)}${path.sep}`)).toBe(true);
    expect(mediaFilePath(root, hash, 'image/jpeg').endsWith(`.jpg`)).toBe(true);
    expect(mediaFilePath(root, hash, 'image/webp').endsWith(`.webp`)).toBe(true);
  });

  it('refuses traversal, absolute and unknown values instead of resolving them', async () => {
    const root = await tempRoot();
    for (const hostile of ['../etc/passwd', '/etc/passwd', '../../../../tmp/x', `${hash}/../../x`, 'A'.repeat(64)]) {
      expect(() => mediaFilePath(root, hostile, 'image/png')).toThrow(MediaFileError);
    }
    expect(() => mediaFilePath(root, hash, 'text/html')).toThrow(MediaFileError);
    expect(() => mediaFilePath(root, hash, '../../png')).toThrow(MediaFileError);
  });
});

describe('atomic file writes', () => {
  it('writes through a temp file and reads back exactly the same bytes', async () => {
    const root = await tempRoot();
    const bytes = pngBytes(64, 64, 'one');
    const written = await writeMediaFile(root, hash, 'image/png', bytes);
    expect(written.existed).toBe(false);
    expect(await readFile(written.path)).toEqual(Buffer.from(bytes));
    // Only the final file remains; the temp file was renamed away.
    expect(await readdir(path.dirname(written.path))).toEqual([`${hash}.png`]);
    expect(await hasMediaFile(root, hash, 'image/png')).toBe(true);
    expect(await readMediaFile(root, hash, 'image/png')).toEqual(bytes);
  });

  it('reports an existing file and is idempotent for identical bytes', async () => {
    const root = await tempRoot();
    const bytes = pngBytes(64, 64, 'same');
    await writeMediaFile(root, hash, 'image/png', bytes);
    const second = await writeMediaFile(root, hash, 'image/png', bytes);
    expect(second.existed).toBe(true);
    expect(await readdir(path.dirname(second.path))).toEqual([`${hash}.png`]);
  });

  it('removes a file and treats a missing file as absent', async () => {
    const root = await tempRoot();
    await writeMediaFile(root, hash, 'image/png', pngBytes());
    await removeMediaFile(root, hash, 'image/png');
    expect(await hasMediaFile(root, hash, 'image/png')).toBe(false);
    await expect(readMediaFile(root, hash, 'image/png')).rejects.toMatchObject({ code: 'not_found' });
    await removeMediaFile(root, hash, 'image/png'); // idempotent
  });

  it('fails with a store error when the root path is a regular file', async () => {
    const root = await tempRoot();
    const fileRoot = path.join(root, 'not-a-directory');
    await writeFile(fileRoot, 'x');
    await expect(writeMediaFile(fileRoot, hash, 'image/png', pngBytes())).rejects.toBeInstanceOf(Error);
    const statResult = await stat(fileRoot);
    expect(statResult.isFile()).toBe(true);
  });
});

function countingStream(chunk: Uint8Array, count: number) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= count) { controller.close(); return; }
      pulled += 1;
      controller.enqueue(chunk);
    },
  });
  return { stream, pulled: () => pulled };
}

describe('bounded body reader', () => {
  it('reads a body at or below the limit', async () => {
    const { stream } = countingStream(new Uint8Array(10), 3);
    expect((await readBoundedBody(stream, 30)).byteLength).toBe(30);
    expect((await readBoundedBody(null, 30)).byteLength).toBe(0);
  });

  it('stops pulling as soon as the limit is crossed and never buffers the whole body', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const { stream, pulled } = countingStream(chunk, 12);
    await expect(readBoundedBody(stream, 5 * 1024 * 1024)).rejects.toBeInstanceOf(MediaBodyTooLargeError);
    // 5 MiB limit over 1 MiB chunks: the 6th read is refused; the remaining 6 chunks are never read.
    expect(pulled()).toBe(6);
    expect(pulled()).toBeLessThan(12);
  });
});
