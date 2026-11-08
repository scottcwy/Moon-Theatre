/**
 * Byte fixtures for the media pipeline. They are NOT complete images: the server never decodes a
 * body, it only sniffs the signature and reads the dimension header, so a valid header plus a
 * distinct salt is exactly what the contract needs. `salt` changes the bytes (and therefore the
 * content hash) without changing the parsed dimensions.
 */

function u32be(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function u16be(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 8) & 0xff;
  target[offset + 1] = value & 0xff;
}

function u16le(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function u24le(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
}

function withSalt(head: Uint8Array, salt: string): Uint8Array {
  const tail = new TextEncoder().encode(salt);
  const out = new Uint8Array(head.length + tail.length);
  out.set(head, 0);
  out.set(tail, head.length);
  return out;
}

/** PNG signature + IHDR width/height. */
export function pngBytes(width = 640, height = 480, salt = ''): Uint8Array {
  const head = new Uint8Array(33);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  u32be(head, 8, 13);
  head.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  u32be(head, 16, width);
  u32be(head, 20, height);
  head[24] = 8; // bit depth
  head[25] = 2; // colour type
  return withSalt(head, salt);
}

/** JPEG SOI + APP0 + SOF0 + EOI; the parser must walk the markers, not trust a fixed offset. */
export function jpegBytes(width = 800, height = 600, salt = ''): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof: number[] = [0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03];
  sof.push(0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01);
  const head = new Uint8Array(2 + app0.length + sof.length + 2);
  head[0] = 0xff;
  head[1] = 0xd8;
  head.set(app0, 2);
  const sofOffset = 2 + app0.length;
  head.set(sof, sofOffset);
  u16be(head, sofOffset + 5, height);
  u16be(head, sofOffset + 7, width);
  head[head.length - 2] = 0xff;
  head[head.length - 1] = 0xd9;
  return withSalt(head, salt);
}

function riff(chunkType: string, payload: Uint8Array, salt: string): Uint8Array {
  const tail = new TextEncoder().encode(salt);
  const size = 4 + 8 + payload.length + tail.length;
  const out = new Uint8Array(20 + payload.length + tail.length);
  out.set(new TextEncoder().encode('RIFF'), 0);
  u32beLess(out, 4, size);
  out.set(new TextEncoder().encode('WEBP'), 8);
  out.set(new TextEncoder().encode(chunkType), 12);
  u32beLess(out, 16, payload.length);
  out.set(payload, 20);
  out.set(tail, 20 + payload.length);
  return out;
}

function u32beLess(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

/** WEBP extended lossless header (`VP8X`): canvas width/height minus one, little-endian 24-bit. */
export function webpExtendedBytes(width = 1200, height = 675, salt = ''): Uint8Array {
  const payload = new Uint8Array(10);
  payload[0] = 0x00; // flags: no animation, no alpha
  u24le(payload, 4, width - 1);
  u24le(payload, 7, height - 1);
  return riff('VP8X', payload, salt);
}

/** WEBP lossless (`VP8L`): 0x2F signature then 14-bit (width-1) and 14-bit (height-1). */
export function webpLosslessBytes(width = 300, height = 300, salt = ''): Uint8Array {
  const payload = new Uint8Array(5);
  payload[0] = 0x2f;
  const packed = (width - 1) | ((height - 1) << 14);
  payload[1] = packed & 0xff;
  payload[2] = (packed >>> 8) & 0xff;
  payload[3] = (packed >>> 16) & 0xff;
  payload[4] = (packed >>> 24) & 0xff;
  return riff('VP8L', payload, salt);
}

/** WEBP lossy (`VP8 `): 3-byte frame tag, start code, then 14-bit width/height. */
export function webpLossyBytes(width = 320, height = 240, salt = ''): Uint8Array {
  const payload = new Uint8Array(10);
  payload[0] = 0x30;
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  u16le(payload, 6, width);
  u16le(payload, 8, height);
  return riff('VP8 ', payload, salt);
}

export const gifBytes = (): Uint8Array => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
export const pdfBytes = (): Uint8Array => new TextEncoder().encode('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');
export const textBytes = (value = 'not an image'): Uint8Array => new TextEncoder().encode(value);
