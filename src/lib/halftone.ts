/**
 * Portrait halftone processor — browser-side, dependency-free.
 *
 * Public API: processPortrait(input, options?) → Promise<HalftoneResult>
 *
 * All image pixels remain local; no network access is performed.
 * The module exports pure geometry/math helpers for unit testing
 * independently of Canvas or browser APIs.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HalftoneOptions {
  /** Output width in pixels. Default 586. */
  targetWidth?: number;
  /** Output height in pixels. Default 589. */
  targetHeight?: number;
  /**
   * Halftone screen pitch (cell size) in output pixels.
   * pitch ≈ 4.42 reproduces the Tenzin/cohort treatment. Default 4.4.
   */
  pitch?: number;
  /** Halftone screen angle in degrees. Default 45. */
  angleDeg?: number;
  /**
   * Focal point X within the source image, 0–1 (left→right). Default 0.5.
   * Combined with zoom, determines the crop window.
   */
  focusX?: number;
  /**
   * Focal point Y within the source image, 0–1 (top→bottom). Default 0.5.
   */
  focusY?: number;
  /**
   * Zoom factor ≥ 1. 1 = fit the target aspect inside the source; 2 = 2× crop. Default 1.
   */
  zoom?: number;
  /**
   * Manual crop rectangle in source pixels. Overrides focus/zoom when provided.
   * { x, y, width, height } in source image pixel coordinates.
   */
  crop?: { x: number; y: number; width: number; height: number };
  /**
   * Stretch the 1st–99th percentile of luminance to 0–255 before screening.
   * Matches the cohort's tonal range. Default true.
   */
  autocontrast?: boolean;
  /**
   * Linear contrast multiplier applied after optional autocontrast, centred on
   * mid-grey. Default 1 (no adjustment).
   */
  contrast?: number;
  /**
   * Brightness offset added to every luminance sample after contrast. Default 0.
   */
  brightness?: number;
  /**
   * Gamma applied to normalised luminance (0–1) before screening. Default 1.
   */
  gamma?: number;
  /** Output encoding quality for WebP, 0–1. Default 0.89. */
  quality?: number;
  /**
   * Maximum decoded pixel count (width × height) accepted from the source.
   * Prevents gigapixel memory bombs. Default 40_000_000 (≈ 40 MP).
   */
  maxDecodedPixels?: number;
  /**
   * Maximum compressed input size in bytes accepted from File/Blob.
   * Default 50_000_000 (50 MB).
   */
  maxInputBytes?: number;
  /** AbortSignal to cancel an in-progress render. */
  signal?: AbortSignal;
}

export interface HalftoneResult {
  /** Encoded image blob (WebP or PNG fallback). */
  blob: Blob;
  /** Output width in pixels. */
  width: number;
  /** Output height in pixels. */
  height: number;
  /** Actual MIME type of blob — never falsely labelled. */
  mimeType: 'image/webp' | 'image/png';
  /** Compressed byte length. */
  bytes: number;
  /** Suggested download filename with correct extension. */
  filename: string;
  /** Wall-clock ms for the full processPortrait call. */
  durationMs: number;
}

export class PortraitProcessError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_MIME'
      | 'INVALID_OPTIONS'
      | 'TOO_LARGE'
      | 'ZERO_DIMENSIONS'
      | 'PIXEL_CAP'
      | 'ABORTED'
      | 'ENCODE_FAILED'
      | 'DECODE_FAILED'
  ) {
    super(message);
    this.name = 'PortraitProcessError';
  }
}

/** Options after defaults + validation (signal excluded). */
export interface ResolvedHalftoneOptions {
  targetWidth: number;
  targetHeight: number;
  pitch: number;
  angleDeg: number;
  focusX: number;
  focusY: number;
  zoom: number;
  crop?: { x: number; y: number; width: number; height: number };
  autocontrast: boolean;
  contrast: number;
  brightness: number;
  gamma: number;
  quality: number;
  maxDecodedPixels: number;
  maxInputBytes: number;
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null)
    return String(value);
  return Object.prototype.toString.call(value);
}

/**
 * Resolve defaults and reject non-finite / out-of-range options before any
 * canvas or grid work. Pure — unit-testable in Node.
 */
export function validateHalftoneOptions(options?: HalftoneOptions): ResolvedHalftoneOptions {
  const o = options ?? {};
  const fail = (message: string): never => {
    throw new PortraitProcessError(message, 'INVALID_OPTIONS');
  };
  const num = (value: unknown, name: string, fallback: number): number => {
    if (value === undefined) return fallback;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return fail(`${name} must be a finite number (got ${formatUnknown(value)})`);
  };

  const targetWidth = num(o.targetWidth, 'targetWidth', 586);
  const targetHeight = num(o.targetHeight, 'targetHeight', 589);
  if (
    !Number.isInteger(targetWidth) ||
    !Number.isInteger(targetHeight) ||
    targetWidth < 1 ||
    targetHeight < 1 ||
    targetWidth > 8192 ||
    targetHeight > 8192
  ) {
    fail('targetWidth/targetHeight must be integers in [1, 8192]');
  }

  const pitch = num(o.pitch, 'pitch', 4.4);
  if (!(pitch > 0) || pitch > 256) fail('pitch must be in (0, 256]');

  const angleDeg = num(o.angleDeg, 'angleDeg', 45);
  if (angleDeg < -360 || angleDeg > 360) fail('angleDeg must be in [-360, 360]');

  const focusX = num(o.focusX, 'focusX', 0.5);
  const focusY = num(o.focusY, 'focusY', 0.5);
  if (focusX < 0 || focusX > 1 || focusY < 0 || focusY > 1) {
    fail('focusX/focusY must be in [0, 1]');
  }

  const zoom = num(o.zoom, 'zoom', 1);
  if (!(zoom >= 1) || zoom > 32) fail('zoom must be in [1, 32]');

  const contrast = num(o.contrast, 'contrast', 1);
  if (!(contrast > 0) || contrast > 8) fail('contrast must be in (0, 8]');

  const brightness = num(o.brightness, 'brightness', 0);
  if (brightness < -255 || brightness > 255) fail('brightness must be in [-255, 255]');

  const gamma = num(o.gamma, 'gamma', 1);
  if (!(gamma > 0) || gamma > 8) fail('gamma must be in (0, 8]');

  const quality = num(o.quality, 'quality', 0.89);
  if (quality < 0 || quality > 1) fail('quality must be in [0, 1]');

  const maxDecodedPixels = num(o.maxDecodedPixels, 'maxDecodedPixels', 40_000_000);
  if (!(maxDecodedPixels >= 1)) fail('maxDecodedPixels must be >= 1');

  const maxInputBytes = num(o.maxInputBytes, 'maxInputBytes', 50_000_000);
  if (!(maxInputBytes >= 1)) fail('maxInputBytes must be >= 1');

  let crop: ResolvedHalftoneOptions['crop'];
  if (o.crop !== undefined) {
    if (o.crop === null || typeof o.crop !== 'object') fail('crop must be an object');
    const cx = o.crop.x;
    const cy = o.crop.y;
    const cw = o.crop.width;
    const ch = o.crop.height;
    if (
      typeof cx !== 'number' ||
      !Number.isFinite(cx) ||
      typeof cy !== 'number' ||
      !Number.isFinite(cy) ||
      typeof cw !== 'number' ||
      !Number.isFinite(cw) ||
      typeof ch !== 'number' ||
      !Number.isFinite(ch)
    ) {
      fail('crop.x/y/width/height must be finite numbers');
    }
    if (!(cw > 0) || !(ch > 0)) fail('crop width/height must be > 0');
    if (cx < 0 || cy < 0) fail('crop x/y must be >= 0');
    crop = { x: cx, y: cy, width: cw, height: ch };
  }

  return {
    targetWidth,
    targetHeight,
    pitch,
    angleDeg,
    focusX,
    focusY,
    zoom,
    crop,
    autocontrast: o.autocontrast ?? true,
    contrast,
    brightness,
    gamma,
    quality,
    maxDecodedPixels,
    maxInputBytes,
  };
}

/** Reject a manual crop that extends outside the decoded source bounds. */
export function validateCropAgainstSource(
  crop: { x: number; y: number; width: number; height: number },
  srcW: number,
  srcH: number
): void {
  if (
    crop.x + crop.width > srcW + 1e-6 ||
    crop.y + crop.height > srcH + 1e-6 ||
    crop.x < -1e-6 ||
    crop.y < -1e-6
  ) {
    throw new PortraitProcessError(
      `crop ${crop.width}×${crop.height}@(${crop.x},${crop.y}) exceeds source ${srcW}×${srcH}`,
      'INVALID_OPTIONS'
    );
  }
}

/**
 * Bound continuous-tone working resolution.
 * Fits the source crop into a box of ~maxScale× target dimensions without upscaling.
 * Prevents allocating full-resolution ImageData/Float32 maps up to the decoded pixel cap.
 */
export function resolveWorkDimensions(
  cropW: number,
  cropH: number,
  targetW: number,
  targetH: number,
  maxScale = 2
): { width: number; height: number } {
  if (!(cropW > 0) || !(cropH > 0) || !(targetW > 0) || !(targetH > 0) || !(maxScale > 0)) {
    throw new PortraitProcessError('Invalid work-dimension inputs', 'INVALID_OPTIONS');
  }
  const maxW = Math.max(1, Math.round(targetW * maxScale));
  const maxH = Math.max(1, Math.round(targetH * maxScale));
  const scale = Math.min(1, maxW / cropW, maxH / cropH);
  return {
    width: Math.max(1, Math.round(cropW * scale)),
    height: Math.max(1, Math.round(cropH * scale)),
  };
}

// ─── Pure geometry / math helpers (unit-testable in Node) ────────────────────

/** BT.709 luminance from linear-light RGB (0–255 each). */
export function rgbToLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Halftone dot radius for a given cell.
 *
 * Derived from area coverage so that the ink area fraction equals the
 * luminance-based coverage fraction.  Dark cells (coverage → 1) produce
 * r > pitch/2, giving the intended overlapping dots that reproduce deep blacks.
 *
 *   coverage = 1 − lum/255          (0 = white, 1 = black)
 *   area = pitch² × coverage        (ink area per cell)
 *   r = sqrt(area / π) = pitch × sqrt(coverage / π)
 *
 * @param lum       Luminance in [0, 255].
 * @param pitch     Cell size in output pixels.
 * @returns         Circle radius in output pixels (may exceed pitch/2 for dark
 *                  cells; that is intentional — overlapping dots = solid black).
 */
export function dotRadius(lum: number, pitch: number): number {
  const coverage = 1 - lum / 255;
  if (coverage <= 0) return 0;
  return pitch * Math.sqrt(coverage / Math.PI);
}

/**
 * Rotate a point (px, py) around the origin by angleDeg degrees.
 * Returns [rx, ry].
 */
export function rotatePoint(px: number, py: number, angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [px * cos - py * sin, px * sin + py * cos];
}

/**
 * Build a 256-bucket luminance histogram from a raw pixel buffer.
 * @param pixels  Uint8ClampedArray of RGBA pixel data.
 * @returns       Uint32Array of length 256.
 */
export function buildHistogram(pixels: Uint8ClampedArray): Uint32Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i += 4) {
    const lum = rgbToLuminance(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
    hist[Math.round(lum) & 0xff]! += 1;
  }
  return hist;
}

/**
 * Find the luminance value at a given percentile (0–1) using a histogram.
 * Used for the autocontrast 1 %–99 % clip.
 */
export function percentileFromHistogram(hist: Uint32Array, percentile: number): number {
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i]!;
  const target = percentile * total;
  let cumulative = 0;
  for (let i = 0; i < 256; i++) {
    cumulative += hist[i]!;
    if (cumulative >= target) return i;
  }
  return 255;
}

/**
 * Build a 256-entry lookup table that maps input luminance to contrast-
 * and gamma-corrected output luminance.
 *
 * @param lo         Low clip value from autocontrast (default 0).
 * @param hi         High clip value from autocontrast (default 255).
 * @param contrast   Linear contrast multiplier centred on 128. Default 1.
 * @param brightness Additive brightness offset. Default 0.
 * @param gamma      Gamma exponent applied to normalised luminance. Default 1.
 */
export function buildLUT(
  lo: number,
  hi: number,
  contrast: number,
  brightness: number,
  gamma: number
): Uint8ClampedArray {
  const range = Math.max(hi - lo, 1);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    // 1. Autocontrast stretch
    let v = ((i - lo) / range) * 255;
    // 2. Contrast (centred on 128)
    v = (v - 128) * contrast + 128;
    // 3. Brightness
    v += brightness;
    // 4. Gamma on normalised value
    const normalised = Math.max(0, Math.min(1, v / 255));
    v = Math.pow(normalised, gamma) * 255;
    lut[i] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return lut;
}

/**
 * Bilinearly sample the luminance at fractional (sx, sy) in source pixel data.
 *
 * @param lum      Pre-computed luminance map (Float32Array, length w×h).
 * @param w        Source width.
 * @param h        Source height.
 * @param sx       Source X (may be fractional).
 * @param sy       Source Y (may be fractional).
 */
export function sampleLuminance(
  lum: Float32Array,
  w: number,
  h: number,
  sx: number,
  sy: number
): number {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = sx - x0;
  const fy = sy - y0;
  const x0c = Math.max(0, Math.min(w - 1, x0));
  const y0c = Math.max(0, Math.min(h - 1, y0));
  const tl = lum[y0c * w + x0c]!;
  const tr = lum[y0c * w + x1]!;
  const bl = lum[y1 * w + x0c]!;
  const br = lum[y1 * w + x1]!;
  return tl * (1 - fx) * (1 - fy) + tr * fx * (1 - fy) + bl * (1 - fx) * fy + br * fx * fy;
}

/**
 * Compute the source crop rectangle (in source image pixels) that frames the
 * target aspect ratio at the requested zoom level around the focus point.
 *
 * @param srcW      Source image width (pixels).
 * @param srcH      Source image height (pixels).
 * @param tgtW      Target canvas width (pixels).
 * @param tgtH      Target canvas height (pixels).
 * @param focusX    Normalised horizontal focus point, 0–1 (default 0.5).
 * @param focusY    Normalised vertical focus point, 0–1 (default 0.5).
 * @param zoom      Zoom ≥ 1 (default 1).
 * @returns         { x, y, width, height } in source pixel coordinates,
 *                  clamped to the source bounds.
 */
export function computeCropRect(
  srcW: number,
  srcH: number,
  tgtW: number,
  tgtH: number,
  focusX: number,
  focusY: number,
  zoom: number
): { x: number; y: number; width: number; height: number } {
  const tgtAspect = tgtW / tgtH;
  const srcAspect = srcW / srcH;

  // Base crop that fills target aspect inside source (contain, then crop to fill)
  let cropW: number;
  let cropH: number;
  if (srcAspect > tgtAspect) {
    // Source is wider: crop width to match aspect
    cropH = srcH;
    cropW = srcH * tgtAspect;
  } else {
    // Source is taller: crop height
    cropW = srcW;
    cropH = srcW / tgtAspect;
  }

  // Apply zoom (narrows the crop window)
  cropW = cropW / zoom;
  cropH = cropH / zoom;

  // Centre around focus point
  const cx = focusX * srcW;
  const cy = focusY * srcH;
  let x = cx - cropW / 2;
  let y = cy - cropH / 2;

  // Clamp to source bounds
  x = Math.max(0, Math.min(srcW - cropW, x));
  y = Math.max(0, Math.min(srcH - cropH, y));
  cropW = Math.min(cropW, srcW);
  cropH = Math.min(cropH, srcH);

  return { x, y, width: cropW, height: cropH };
}

/**
 * Enumerate the halftone grid cells whose centres fall within the canvas
 * bounding box (extended by maxRadius to capture partial-overlap dots).
 *
 * The screen is defined by a regular grid with spacing `pitch` rotated by
 * `angleDeg` degrees.  For each cell the function returns its centre in
 * canvas pixel space.
 *
 * @param canvasW    Output canvas width.
 * @param canvasH    Output canvas height.
 * @param pitch      Grid spacing in output pixels.
 * @param angleDeg   Screen rotation angle in degrees.
 * @param maxRadius  Maximum possible dot radius (used to extend the search
 *                   margin so edge dots are not clipped).
 * @returns          Array of [cx, cy] canvas-space centre coordinates.
 */
export function enumerateGridCells(
  canvasW: number,
  canvasH: number,
  pitch: number,
  angleDeg: number,
  maxRadius: number
): Array<[number, number]> {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Inverse rotation (rotate canvas corners into grid space)
  const cosN = Math.cos(-rad);
  const sinN = Math.sin(-rad);

  const margin = maxRadius + pitch;
  const corners = [
    [-margin, -margin],
    [canvasW + margin, -margin],
    [canvasW + margin, canvasH + margin],
    [-margin, canvasH + margin],
  ];

  // Rotate all corners into grid space to find grid index bounds
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (const [cx, cy] of corners) {
    const u = cx! * cosN - cy! * sinN;
    const v = cx! * sinN + cy! * cosN;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  const iMin = Math.floor(minU / pitch);
  const iMax = Math.ceil(maxU / pitch);
  const jMin = Math.floor(minV / pitch);
  const jMax = Math.ceil(maxV / pitch);

  const cells: Array<[number, number]> = [];
  for (let i = iMin; i <= iMax; i++) {
    for (let j = jMin; j <= jMax; j++) {
      // Grid centre in grid space → canvas space via forward rotation
      const gu = i * pitch;
      const gv = j * pitch;
      const cx = gu * cos - gv * sin;
      const cy = gu * sin + gv * cos;
      // Accept cells whose centres are within the canvas + margin
      if (cx >= -margin && cx <= canvasW + margin && cy >= -margin && cy <= canvasH + margin) {
        cells.push([cx, cy]);
      }
    }
  }
  return cells;
}

// ─── Browser-only implementation ─────────────────────────────────────────────
// MIME helpers and all canvas/blob code — unavailable in Node test environment

/* c8 ignore start */

const ACCEPTED_TYPES: Record<string, true> = {
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true,
  'image/gif': true,
  'image/avif': true,
  'image/bmp': true,
  'image/tiff': true,
};

function sniffMime(blob: Blob): string {
  const t = blob.type.split(';')[0]!.trim().toLowerCase();
  if (t && t !== 'application/octet-stream') return t;
  if (!(blob instanceof File)) return '';
  const ext = blob.name.split('.').pop()?.toLowerCase() ?? '';
  const EXT_MAP: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    bmp: 'image/bmp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
  };
  return EXT_MAP[ext] ?? '';
}

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  return el;
}

function getContext2d(
  canvas: OffscreenCanvas | HTMLCanvasElement
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new PortraitProcessError('Could not get 2d context', 'DECODE_FAILED');
  return ctx;
}

async function encodeCanvas(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  quality: number
): Promise<{ blob: Blob; mimeType: 'image/webp' | 'image/png' }> {
  if (canvas instanceof OffscreenCanvas) {
    // Try WebP first; OffscreenCanvas.convertToBlob supports it in all modern browsers
    try {
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
      // Some browsers return an image/png blob even when asked for webp
      if (blob.type === 'image/webp') return { blob, mimeType: 'image/webp' };
    } catch {
      // fall through to PNG
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { blob, mimeType: 'image/png' };
  }
  // HTMLCanvasElement path — manual Promise for Safari/iOS < 17.4 (no Promise.withResolvers)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b && b.type === 'image/webp') {
          resolve({ blob: b, mimeType: 'image/webp' });
          return;
        }
        // PNG fallback — toBlob is callback-only so we nest here
        canvas.toBlob((pb) => {
          if (!pb) {
            reject(new PortraitProcessError('Encode failed', 'ENCODE_FAILED'));
            return;
          }
          resolve({ blob: pb, mimeType: 'image/png' });
        }, 'image/png');
      },
      'image/webp',
      quality
    );
  });
}

/**
 * Render the halftone screen onto a canvas.
 *
 * @param ctx       Canvas 2D context already filled with white paper.
 * @param lumMap    Luminance map of the continuous-tone work image (Float32Array, w×h).
 * @param srcW      Width of lumMap in pixels.
 * @param srcH      Height of lumMap in pixels.
 * @param outW      Output canvas width.
 * @param outH      Output canvas height.
 * @param pitch     Halftone screen pitch in output pixels.
 * @param angleDeg  Screen angle in degrees.
 * @param lut       256-entry tone mapping lookup table.
 */
function renderHalftone(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  lumMap: Float32Array,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  pitch: number,
  angleDeg: number,
  lut: Uint8ClampedArray
): void {
  // Maximum possible radius: full-black cell (lum→0, coverage=1, r = pitch/√π)
  // Dots are black ink on white paper — dark source → large black dot.
  const maxR = pitch / Math.sqrt(Math.PI);
  const cells = enumerateGridCells(outW, outH, pitch, angleDeg, maxR);

  ctx.fillStyle = '#000000'; // black ink dots on white paper
  ctx.beginPath();

  for (const [cx, cy] of cells) {
    // Map canvas pixel → work-image pixel via uniform scaling
    const sx = (cx / outW) * srcW;
    const sy = (cy / outH) * srcH;
    const rawLum = sampleLuminance(lumMap, srcW, srcH, sx, sy);
    const mappedLum = lut[Math.max(0, Math.min(255, Math.round(rawLum)))]!;
    const r = dotRadius(mappedLum, pitch);
    if (r < 0.5) continue; // sub-pixel dot → skip
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }

  ctx.fill();
}

// ─── Main public API ──────────────────────────────────────────────────────────

/**
 * Process a portrait image into a monochrome 45° AM round-dot halftone.
 *
 * All processing is local — photo bytes never leave the device.
 *
 * Pipeline:
 *   validate options → decode (EXIF-aware) → crop continuous-tone source into a
 *   bounded work canvas (~2× target) → histogram/LUT → luminance map → screen at
 *   output resolution → encode WebP (PNG fallback).
 *
 * @param input    File or Blob containing the source image.
 * @param options  Processing parameters (all optional; defaults match Tenzin/cohort).
 * @returns        Resolved with HalftoneResult on success.
 * @throws         PortraitProcessError on validation failure, abort, or encode error.
 */
export async function processPortrait(
  input: Blob | File,
  options?: HalftoneOptions
): Promise<HalftoneResult> {
  const t0 = performance.now();

  // ── Options: defaults + hard validation before any canvas/grid work ────────
  const resolved = validateHalftoneOptions(options);
  const {
    targetWidth,
    targetHeight,
    pitch,
    angleDeg,
    focusX,
    focusY,
    zoom,
    autocontrast,
    contrast,
    brightness,
    gamma,
    quality,
    maxDecodedPixels,
    maxInputBytes,
  } = resolved;
  const signal = options?.signal;

  const throwIfAborted = () => {
    if (signal?.aborted) throw new PortraitProcessError('Processing aborted', 'ABORTED');
  };

  throwIfAborted();

  if (input.size > maxInputBytes) {
    throw new PortraitProcessError(
      `Input file exceeds ${maxInputBytes} byte limit (got ${input.size})`,
      'TOO_LARGE'
    );
  }

  const mimeType = sniffMime(input);
  if (!ACCEPTED_TYPES[mimeType]) {
    throw new PortraitProcessError(
      `Unsupported image type: "${mimeType || '(unknown)'}". ` +
        `Accepted: ${Object.keys(ACCEPTED_TYPES).join(', ')}`,
      'INVALID_MIME'
    );
  }

  // ── Decode ─────────────────────────────────────────────────────────────────
  throwIfAborted();

  let bitmap: ImageBitmap | null = null;
  try {
    try {
      bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' });
    } catch (err) {
      throw new PortraitProcessError(
        `Failed to decode image: ${err instanceof Error ? err.message : String(err)}`,
        'DECODE_FAILED'
      );
    }

    throwIfAborted();

    const srcW = bitmap.width;
    const srcH = bitmap.height;

    if (srcW === 0 || srcH === 0) {
      throw new PortraitProcessError('Decoded image has zero dimensions', 'ZERO_DIMENSIONS');
    }

    if (srcW * srcH > maxDecodedPixels) {
      throw new PortraitProcessError(
        `Decoded pixel count ${srcW * srcH} exceeds cap of ${maxDecodedPixels}`,
        'PIXEL_CAP'
      );
    }

    // ── Crop framing in source coordinates (faithful; no resize-before-crop) ─
    const cropRect =
      resolved.crop ?? computeCropRect(srcW, srcH, targetWidth, targetHeight, focusX, focusY, zoom);
    if (resolved.crop) validateCropAgainstSource(resolved.crop, srcW, srcH);

    // Bound continuous-tone working memory: draw the source crop directly into
    // a work canvas ≤ ~2× target dims (preserving crop→output aspect mapping).
    // Histogram / luminance / screening sample this work image — never a full
    // 40 MP crop canvas + ImageData + Float32 map.
    const workDims = resolveWorkDimensions(
      cropRect.width,
      cropRect.height,
      targetWidth,
      targetHeight,
      2
    );

    const workCanvas = makeCanvas(workDims.width, workDims.height);
    const workCtx = getContext2d(workCanvas);
    workCtx.drawImage(
      bitmap,
      cropRect.x,
      cropRect.y,
      cropRect.width,
      cropRect.height,
      0,
      0,
      workCanvas.width,
      workCanvas.height
    );

    // Source decode is no longer needed once the continuous-tone work image exists.
    bitmap.close();
    bitmap = null;

    throwIfAborted();

    const workW = workCanvas.width;
    const workH = workCanvas.height;
    const workPixels = workCtx.getImageData(0, 0, workW, workH).data;

    // ── Tone mapping LUT (from continuous-tone work image) ───────────────────
    let lumLo = 0;
    let lumHi = 255;
    if (autocontrast) {
      const hist = buildHistogram(workPixels);
      lumLo = percentileFromHistogram(hist, 0.01);
      lumHi = percentileFromHistogram(hist, 0.99);
    }
    const lut = buildLUT(lumLo, lumHi, contrast, brightness, gamma);

    throwIfAborted();

    // ── Luminance map at work resolution ─────────────────────────────────────
    const lumMap = new Float32Array(workW * workH);
    for (let i = 0; i < workW * workH; i++) {
      lumMap[i] = rgbToLuminance(
        workPixels[i * 4]!,
        workPixels[i * 4 + 1]!,
        workPixels[i * 4 + 2]!
      );
    }

    // ── Screen at output resolution (never re-screen a derivative) ───────────
    throwIfAborted();

    const outCanvas = makeCanvas(targetWidth, targetHeight);
    const outCtx = getContext2d(outCanvas);
    // White paper background — dots are black ink, so light source areas show paper
    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, targetWidth, targetHeight);

    renderHalftone(outCtx, lumMap, workW, workH, targetWidth, targetHeight, pitch, angleDeg, lut);

    throwIfAborted();

    // ── Encode ───────────────────────────────────────────────────────────────
    let encoded: { blob: Blob; mimeType: 'image/webp' | 'image/png' };
    try {
      encoded = await encodeCanvas(outCanvas, quality);
    } catch (err) {
      if (err instanceof PortraitProcessError) throw err;
      throw new PortraitProcessError(
        `Encoding failed: ${err instanceof Error ? err.message : String(err)}`,
        'ENCODE_FAILED'
      );
    }

    throwIfAborted();

    const ext = encoded.mimeType === 'image/webp' ? 'webp' : 'png';
    const stem =
      input instanceof File ? input.name.replace(/\.[^.]+$/, '') : `portrait-${Date.now()}`;
    const filename = `${stem}-halftone.${ext}`;

    return {
      blob: encoded.blob,
      width: targetWidth,
      height: targetHeight,
      mimeType: encoded.mimeType,
      bytes: encoded.blob.size,
      filename,
      durationMs: performance.now() - t0,
    };
  } finally {
    // Close ImageBitmap on every exit path: abort, draw failure, validation, success.
    if (bitmap) {
      try {
        bitmap.close();
      } catch {
        // ignore double-close
      }
    }
  }
}

/* c8 ignore stop */
