// Limits live with the browser pipeline that produces these bytes, so the
// client and this validator can never disagree about what fits.
export {
  MAX_PORTRAIT_BYTES,
  PORTRAIT_MAX_DIM,
  PORTRAIT_MIN_DIM,
} from '../../src/lib/portrait-limits';
import {
  MAX_PORTRAIT_BYTES,
  PORTRAIT_MAX_DIM,
  PORTRAIT_MIN_DIM,
} from '../../src/lib/portrait-limits';

export type PortraitKind = 'image/webp' | 'image/png';

export type PortraitCheck =
  | { ok: true; mimeType: PortraitKind; width: number; height: number }
  | {
      ok: false;
      error:
        | 'portrait_empty'
        | 'portrait_too_large'
        | 'portrait_unsupported_type'
        | 'portrait_bad_dimensions';
    };

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * Sniff magic bytes + intrinsic dimensions. Never trusts a declared Content-Type.
 *
 * PNG layout (ISO/IEC 15948):
 *   bytes 0–7   signature 89 50 4E 47 0D 0A 1A 0A
 *   bytes 8–11  IHDR length (always 13)
 *   bytes 12–15 chunk type "IHDR"
 *   bytes 16–19 width  (big-endian u32)
 *   bytes 20–23 height (big-endian u32)
 *
 * WebP container (RFC 6386 / RIFF):
 *   bytes 0–3   "RIFF"
 *   bytes 4–7   file size (LE u32, ignored)
 *   bytes 8–11  "WEBP"
 *   bytes 12–15 fourCC chunk id
 *
 *   VP8  (lossy):
 *     bytes 16–19 chunk size (LE u32)
 *     frame header starts at 20; key-frame sync is 9D 01 2A at offset 23
 *     14-bit LE width  at bits of bytes 26–27 (mask 0x3fff)
 *     14-bit LE height at bits of bytes 28–29 (mask 0x3fff)
 *
 *   VP8L (lossless):
 *     bytes 16–19 chunk size
 *     byte 20     signature 0x2F
 *     bytes 21–24 packed 14-bit (width-1) | 14-bit (height-1) little-endian
 *
 *   VP8X (extended):
 *     bytes 16–19 chunk size (must be >= 10)
 *     bytes 20–23 flags + reserved
 *     bytes 24–26 canvas width-1  (24-bit LE)
 *     bytes 27–29 canvas height-1 (24-bit LE)
 */
export function inspectPortrait(bytes: Uint8Array): PortraitCheck {
  if (bytes.byteLength === 0) {
    return { ok: false, error: 'portrait_empty' };
  }
  if (bytes.byteLength > MAX_PORTRAIT_BYTES) {
    return { ok: false, error: 'portrait_too_large' };
  }

  const dims = readDimensions(bytes);
  if (!dims) {
    return { ok: false, error: 'portrait_unsupported_type' };
  }

  const { width, height, mimeType } = dims;
  if (
    width < PORTRAIT_MIN_DIM ||
    height < PORTRAIT_MIN_DIM ||
    width > PORTRAIT_MAX_DIM ||
    height > PORTRAIT_MAX_DIM
  ) {
    return { ok: false, error: 'portrait_bad_dimensions' };
  }

  return { ok: true, mimeType, width, height };
}

/** Content-addressed durable key: `portraits/${sha256hex}.webp|png`. */
export async function portraitKey(bytes: Uint8Array, mimeType: PortraitKind): Promise<string> {
  // Allocate a plain ArrayBuffer (not ArrayBufferLike/SharedArrayBuffer) for subtle.digest.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', ab);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const ext = mimeType === 'image/webp' ? 'webp' : 'png';
  return `portraits/${hex}.${ext}`;
}

/** True for exactly `portraits/<64 lowercase hex>.webp|png`. */
export function isPortraitKey(key: string): boolean {
  return /^portraits\/[0-9a-f]{64}\.(webp|png)$/.test(key);
}

/** Build the durable key from the `<sha>.<ext>` path segment used by GET /api/portrait/. */
export function portraitKeyFromPathSegment(segment: string): string | null {
  if (!/^[0-9a-f]{64}\.(webp|png)$/.test(segment)) return null;
  return `portraits/${segment}`;
}

function readDimensions(
  bytes: Uint8Array
): { width: number; height: number; mimeType: PortraitKind } | null {
  if (isPng(bytes)) {
    // Need signature (8) + length (4) + type (4) + width/height (8) = 24 bytes minimum.
    if (bytes.byteLength < 24) return null;
    // Confirm IHDR type at offset 12.
    if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
      return null;
    }
    const width = readU32BE(bytes, 16);
    const height = readU32BE(bytes, 20);
    if (width === 0 || height === 0) return null;
    return { width, height, mimeType: 'image/png' };
  }

  if (isWebp(bytes)) {
    // RIFF(12) + fourCC(4) minimum before chunk-specific payload.
    if (bytes.byteLength < 16) return null;
    const fourCC = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    if (fourCC === 'VP8 ') {
      // Lossy: need through height at offset 28–29 → 30 bytes.
      if (bytes.byteLength < 30) return null;
      // Key-frame start code 9D 01 2A sits at offset 23 (frame header begins at 20).
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
      const width = readU16LE(bytes, 26) & 0x3fff;
      const height = readU16LE(bytes, 28) & 0x3fff;
      if (width === 0 || height === 0) return null;
      return { width, height, mimeType: 'image/webp' };
    }
    if (fourCC === 'VP8L') {
      // Lossless: signature at 20, packed dims in 21–24 → need 25 bytes.
      if (bytes.byteLength < 25) return null;
      if (bytes[20] !== 0x2f) return null;
      const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { width, height, mimeType: 'image/webp' };
    }
    if (fourCC === 'VP8X') {
      // Extended: canvas width-1 at 24–26, height-1 at 27–29 → need 30 bytes.
      if (bytes.byteLength < 30) return null;
      const width = readU24LE(bytes, 24) + 1;
      const height = readU24LE(bytes, 27) + 1;
      if (width === 0 || height === 0) return null;
      return { width, height, mimeType: 'image/webp' };
    }
    return null;
  }

  return null;
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;
  for (let i = 0; i < PNG_SIG.length; i += 1) {
    if (bytes[i] !== PNG_SIG[i]) return false;
  }
  return true;
}

function isWebp(bytes: Uint8Array): boolean {
  // "RIFF" .... "WEBP"
  if (bytes.byteLength < 12) return false;
  const riff =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  if (!riff) return false;
  // RIFF size counts every byte after the size field itself. A short upload
  // still carries a valid header, and a content-addressed key would pin the
  // truncated object forever, so reject it here rather than store it.
  const declared = bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! * 0x1000000);
  return declared + 8 <= bytes.byteLength;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}
