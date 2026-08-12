import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vite-plus/test';
import {
  inspectPortrait,
  isPortraitKey,
  MAX_PORTRAIT_BYTES,
  portraitKey,
  portraitKeyFromPathSegment,
} from '../../worker/src/portrait';

/** Build a minimal PNG header. Parser only reads signature + IHDR; pad so length is realistic. */
function makePngHeader(width: number, height: number, padTo = 64): Uint8Array {
  const buf = new Uint8Array(Math.max(padTo, 33));
  // Signature
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR length = 13
  buf[8] = 0;
  buf[9] = 0;
  buf[10] = 0;
  buf[11] = 13;
  // "IHDR"
  buf.set([0x49, 0x48, 0x44, 0x52], 12);
  // width / height big-endian u32
  writeU32BE(buf, 16, width);
  writeU32BE(buf, 20, height);
  // bit depth / color type / compression / filter / interlace (placeholders)
  buf[24] = 8;
  buf[25] = 2;
  buf[26] = 0;
  buf[27] = 0;
  buf[28] = 0;
  // CRC placeholder (4 bytes) — not inspected
  return buf;
}

/** Lossy WebP (VP8) header with 14-bit LE dimensions after the 9D 01 2A sync. */
function makeVp8Header(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(40);
  writeAscii(buf, 0, 'RIFF');
  writeU32LE(buf, 4, 32);
  writeAscii(buf, 8, 'WEBP');
  writeAscii(buf, 12, 'VP8 ');
  writeU32LE(buf, 16, 20);
  // Frame tag (3 bytes) — key frame (bit0=0)
  buf[20] = 0x00;
  buf[21] = 0x00;
  buf[22] = 0x00;
  // Sync code
  buf[23] = 0x9d;
  buf[24] = 0x01;
  buf[25] = 0x2a;
  writeU16LE(buf, 26, width & 0x3fff);
  writeU16LE(buf, 28, height & 0x3fff);
  return buf;
}

/** Lossless WebP (VP8L): signature 0x2F then packed (w-1)|(h-1)<<14. */
function makeVp8lHeader(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(32);
  writeAscii(buf, 0, 'RIFF');
  writeU32LE(buf, 4, 24);
  writeAscii(buf, 8, 'WEBP');
  writeAscii(buf, 12, 'VP8L');
  writeU32LE(buf, 16, 12);
  buf[20] = 0x2f;
  const bits = (width - 1) | ((height - 1) << 14);
  buf[21] = bits & 0xff;
  buf[22] = (bits >>> 8) & 0xff;
  buf[23] = (bits >>> 16) & 0xff;
  buf[24] = (bits >>> 24) & 0xff;
  return buf;
}

/** Extended WebP (VP8X): 24-bit LE canvas width-1 / height-1 at offsets 24 and 27. */
function makeVp8xHeader(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(32);
  writeAscii(buf, 0, 'RIFF');
  writeU32LE(buf, 4, 24);
  writeAscii(buf, 8, 'WEBP');
  writeAscii(buf, 12, 'VP8X');
  writeU32LE(buf, 16, 10);
  // flags + reserved
  buf[20] = 0;
  buf[21] = 0;
  buf[22] = 0;
  buf[23] = 0;
  writeU24LE(buf, 24, width - 1);
  writeU24LE(buf, 27, height - 1);
  return buf;
}

function writeAscii(buf: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) buf[offset + i] = text.charCodeAt(i);
}

function writeU32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function writeU32LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

function writeU16LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
}

function writeU24LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
}

describe('inspectPortrait', () => {
  test('accepts a minimal PNG header at 320×320', () => {
    // Truncated-but-valid-header buffer: parser only needs signature + IHDR dims.
    const bytes = makePngHeader(320, 320);
    const result = inspectPortrait(bytes);
    expect(result).toEqual({
      ok: true,
      mimeType: 'image/png',
      width: 320,
      height: 320,
    });
  });

  test('accepts lossy VP8, lossless VP8L, and extended VP8X WebP headers', () => {
    expect(inspectPortrait(makeVp8Header(200, 180))).toEqual({
      ok: true,
      mimeType: 'image/webp',
      width: 200,
      height: 180,
    });
    expect(inspectPortrait(makeVp8lHeader(128, 256))).toEqual({
      ok: true,
      mimeType: 'image/webp',
      width: 128,
      height: 256,
    });
    expect(inspectPortrait(makeVp8xHeader(400, 300))).toEqual({
      ok: true,
      mimeType: 'image/webp',
      width: 400,
      height: 300,
    });
  });

  test('rejects empty and oversized buffers', () => {
    expect(inspectPortrait(new Uint8Array(0))).toEqual({
      ok: false,
      error: 'portrait_empty',
    });
    const oversized = new Uint8Array(MAX_PORTRAIT_BYTES + 1);
    oversized.set(makePngHeader(64, 64).subarray(0, 24));
    expect(inspectPortrait(oversized)).toEqual({
      ok: false,
      error: 'portrait_too_large',
    });
  });

  test('rejects JPEG and GIF magic bytes', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(inspectPortrait(jpeg)).toEqual({
      ok: false,
      error: 'portrait_unsupported_type',
    });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
    expect(inspectPortrait(gif)).toEqual({
      ok: false,
      error: 'portrait_unsupported_type',
    });
  });

  test('rejects truncated PNG and WebP headers', () => {
    const shortPng = makePngHeader(64, 64).subarray(0, 20);
    expect(inspectPortrait(shortPng)).toEqual({
      ok: false,
      error: 'portrait_unsupported_type',
    });
    const shortWebp = makeVp8Header(64, 64).subarray(0, 20);
    expect(inspectPortrait(shortWebp)).toEqual({
      ok: false,
      error: 'portrait_unsupported_type',
    });
  });

  test('rejects dimensions below 64 and above 1024 on both axes', () => {
    expect(inspectPortrait(makePngHeader(63, 64))).toEqual({
      ok: false,
      error: 'portrait_bad_dimensions',
    });
    expect(inspectPortrait(makePngHeader(64, 63))).toEqual({
      ok: false,
      error: 'portrait_bad_dimensions',
    });
    expect(inspectPortrait(makeVp8xHeader(1025, 64))).toEqual({
      ok: false,
      error: 'portrait_bad_dimensions',
    });
    expect(inspectPortrait(makeVp8lHeader(64, 1025))).toEqual({
      ok: false,
      error: 'portrait_bad_dimensions',
    });
  });

  test('accepts exact boundary sizes 64 and 1024', () => {
    expect(inspectPortrait(makePngHeader(64, 64))).toMatchObject({
      ok: true,
      width: 64,
      height: 64,
    });
    expect(inspectPortrait(makeVp8Header(1024, 1024))).toMatchObject({
      ok: true,
      width: 1024,
      height: 1024,
    });
    expect(inspectPortrait(makeVp8xHeader(64, 1024))).toMatchObject({
      ok: true,
      width: 64,
      height: 1024,
    });
  });
});

describe('portraitKey', () => {
  test('is stable SHA-256 with correct extension and differs by bytes', async () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 6]);
    const expectedHex = createHash('sha256').update(a).digest('hex');

    const keyWebp = await portraitKey(a, 'image/webp');
    expect(keyWebp).toBe(`portraits/${expectedHex}.webp`);

    const keyPng = await portraitKey(a, 'image/png');
    expect(keyPng).toBe(`portraits/${expectedHex}.png`);

    const keyB = await portraitKey(b, 'image/webp');
    expect(keyB).not.toBe(keyWebp);
    expect(keyB.startsWith('portraits/')).toBe(true);
    expect(keyB.endsWith('.webp')).toBe(true);
  });
});

describe('isPortraitKey / portraitKeyFromPathSegment', () => {
  const hex = 'a'.repeat(64);
  const good = `portraits/${hex}.webp`;
  const goodPng = `portraits/${hex}.png`;

  test('accepts the exact shape', () => {
    expect(isPortraitKey(good)).toBe(true);
    expect(isPortraitKey(goodPng)).toBe(true);
    expect(portraitKeyFromPathSegment(`${hex}.webp`)).toBe(good);
    expect(portraitKeyFromPathSegment(`${hex}.png`)).toBe(goodPng);
  });

  test('rejects uppercase hex, wrong length, traversal, nested slashes, wrong ext, empty', () => {
    expect(isPortraitKey(`portraits/${'A'.repeat(64)}.webp`)).toBe(false);
    expect(isPortraitKey(`portraits/${'a'.repeat(63)}.webp`)).toBe(false);
    expect(isPortraitKey(`portraits/${'a'.repeat(65)}.webp`)).toBe(false);
    expect(isPortraitKey(`portraits/../${hex}.webp`)).toBe(false);
    expect(isPortraitKey(`portraits/foo/${hex}.webp`)).toBe(false);
    expect(isPortraitKey(`portraits/${hex}.jpg`)).toBe(false);
    expect(isPortraitKey('')).toBe(false);

    expect(portraitKeyFromPathSegment(`${'A'.repeat(64)}.webp`)).toBeNull();
    expect(portraitKeyFromPathSegment(`${'a'.repeat(63)}.webp`)).toBeNull();
    expect(portraitKeyFromPathSegment(`../${hex}.webp`)).toBeNull();
    expect(portraitKeyFromPathSegment(`foo/${hex}.webp`)).toBeNull();
    expect(portraitKeyFromPathSegment(`${hex}.gif`)).toBeNull();
    expect(portraitKeyFromPathSegment('')).toBeNull();
  });
});
