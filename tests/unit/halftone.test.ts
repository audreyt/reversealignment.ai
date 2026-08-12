/**
 * tests/unit/halftone.test.ts
 *
 * Tests for the pure geometry / math exports from src/lib/halftone.ts.
 * No Canvas, no DOM, no browser APIs — all run in the Node environment.
 *
 * Observable contracts defended:
 *  - dotRadius: physics (area-coverage formula), boundary values, polarity
 *  - buildHistogram: bucket counts
 *  - percentileFromHistogram: edge cases (empty, boundary)
 *  - buildLUT: autocontrast stretch, gamma, contrast, brightness, clamp
 *  - sampleLuminance: bilinear interpolation corners/edges
 *  - computeCropRect: aspect-fit, zoom, focus, clamp
 *  - enumerateGridCells: minimum cell count, no duplicates, 0°/45° geometry
 *  - rgbToLuminance: BT.709 coefficients
 *  - rotatePoint: identity, 90°, 180°
 *  - PortraitProcessError: code and name preserved
 */

import { describe, expect, test } from 'vite-plus/test';
import {
  PortraitProcessError,
  buildHistogram,
  buildLUT,
  computeCropRect,
  dotRadius,
  enumerateGridCells,
  percentileFromHistogram,
  resolveWorkDimensions,
  rgbToLuminance,
  rotatePoint,
  sampleLuminance,
  validateCropAgainstSource,
  validateHalftoneOptions,
} from '../../src/lib/halftone';

// ─── dotRadius ────────────────────────────────────────────────────────────────

describe('dotRadius', () => {
  const PITCH = 4.4;

  test('white source (lum=255) → radius 0 (no ink)', () => {
    expect(dotRadius(255, PITCH)).toBe(0);
  });

  test('black source (lum=0) → maximum radius = pitch/√π', () => {
    const expected = PITCH / Math.sqrt(Math.PI);
    expect(dotRadius(0, PITCH)).toBeCloseTo(expected, 10);
  });

  test('black radius exceeds half-pitch — overlapping dots produce solid black', () => {
    // This is the key invariant: dark cells MUST be able to produce r > pitch/2
    const r = dotRadius(0, PITCH);
    expect(r).toBeGreaterThan(PITCH / 2);
  });

  test('mid-grey (lum=128) → intermediate radius', () => {
    const r = dotRadius(128, PITCH);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(dotRadius(0, PITCH));
  });

  test('radius increases monotonically as luminance decreases', () => {
    const lums = [255, 200, 128, 64, 0];
    const radii = lums.map((l) => dotRadius(l, PITCH));
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeGreaterThanOrEqual(radii[i - 1]!);
    }
  });

  test('area-coverage formula: r = pitch * sqrt(coverage / π)', () => {
    const lum = 50;
    const coverage = 1 - lum / 255;
    const expected = PITCH * Math.sqrt(coverage / Math.PI);
    expect(dotRadius(lum, PITCH)).toBeCloseTo(expected, 10);
  });

  test('pitch scales radius linearly', () => {
    const lum = 100;
    const r1 = dotRadius(lum, 4);
    const r2 = dotRadius(lum, 8);
    expect(r2 / r1).toBeCloseTo(2, 10);
  });
});

// ─── rgbToLuminance ──────────────────────────────────────────────────────────

describe('rgbToLuminance', () => {
  test('pure white → 255', () => {
    expect(rgbToLuminance(255, 255, 255)).toBeCloseTo(255, 5);
  });

  test('pure black → 0', () => {
    expect(rgbToLuminance(0, 0, 0)).toBe(0);
  });

  test('pure red uses BT.709 coefficient 0.2126', () => {
    expect(rgbToLuminance(255, 0, 0)).toBeCloseTo(0.2126 * 255, 5);
  });

  test('pure green uses BT.709 coefficient 0.7152', () => {
    expect(rgbToLuminance(0, 255, 0)).toBeCloseTo(0.7152 * 255, 5);
  });

  test('pure blue uses BT.709 coefficient 0.0722', () => {
    expect(rgbToLuminance(0, 0, 255)).toBeCloseTo(0.0722 * 255, 5);
  });

  test('coefficients sum to 1 (round-trip white)', () => {
    expect(0.2126 + 0.7152 + 0.0722).toBeCloseTo(1.0, 10);
  });
});

// ─── rotatePoint ─────────────────────────────────────────────────────────────

describe('rotatePoint', () => {
  test('0° is identity', () => {
    const [rx, ry] = rotatePoint(3, 4, 0);
    expect(rx).toBeCloseTo(3, 10);
    expect(ry).toBeCloseTo(4, 10);
  });

  test('90° rotates (1,0) to (0,1)', () => {
    const [rx, ry] = rotatePoint(1, 0, 90);
    expect(rx).toBeCloseTo(0, 10);
    expect(ry).toBeCloseTo(1, 10);
  });

  test('180° negates both components', () => {
    const [rx, ry] = rotatePoint(3, 4, 180);
    expect(rx).toBeCloseTo(-3, 10);
    expect(ry).toBeCloseTo(-4, 10);
  });

  test('45° of (1,0) lands at (cos45, sin45)', () => {
    const [rx, ry] = rotatePoint(1, 0, 45);
    const s = Math.sqrt(2) / 2;
    expect(rx).toBeCloseTo(s, 10);
    expect(ry).toBeCloseTo(s, 10);
  });
});

// ─── buildHistogram ──────────────────────────────────────────────────────────

describe('buildHistogram', () => {
  test('single pure-white pixel → bucket 255 = 1', () => {
    const pixels = new Uint8ClampedArray([255, 255, 255, 255]);
    const hist = buildHistogram(pixels);
    expect(hist[255]).toBe(1);
    expect(hist.reduce((a, b) => a + b, 0)).toBe(1);
  });

  test('single pure-black pixel → bucket 0 = 1', () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 255]);
    const hist = buildHistogram(pixels);
    expect(hist[0]).toBe(1);
  });

  test('returns Uint32Array of length 256', () => {
    const pixels = new Uint8ClampedArray(4);
    expect(buildHistogram(pixels)).toHaveLength(256);
    expect(buildHistogram(pixels)).toBeInstanceOf(Uint32Array);
  });

  test('two pixels land in correct buckets', () => {
    // R=100,G=0,B=0 → lum ≈ round(0.2126*100)=21; R=0,G=0,B=0 → 0
    const pixels = new Uint8ClampedArray([100, 0, 0, 255, 0, 0, 0, 255]);
    const hist = buildHistogram(pixels);
    expect(hist[0]).toBe(1);
    // lum of (100,0,0) = 0.2126*100 = 21.26 → round to 21
    expect(hist[21]).toBe(1);
  });
});

// ─── percentileFromHistogram ──────────────────────────────────────────────────

describe('percentileFromHistogram', () => {
  test('50th percentile of all-zeros histogram → 0', () => {
    const hist = new Uint32Array(256);
    // Must have at least one entry to not divide by zero
    hist[0] = 1;
    expect(percentileFromHistogram(hist, 0.5)).toBe(0);
  });

  test('100th percentile → 255 when bucket 255 has count', () => {
    const hist = new Uint32Array(256);
    hist[255] = 1;
    expect(percentileFromHistogram(hist, 1.0)).toBe(255);
  });

  test('uniform distribution: 1% ≤ 2, 99% ≥ 252', () => {
    const hist = new Uint32Array(256);
    for (let i = 0; i < 256; i++) hist[i] = 1;
    expect(percentileFromHistogram(hist, 0.01)).toBeLessThanOrEqual(3);
    expect(percentileFromHistogram(hist, 0.99)).toBeGreaterThanOrEqual(252);
  });

  test('bimodal: 50% at 0, 50% at 255 → 1% = 0, 99% = 255', () => {
    const hist = new Uint32Array(256);
    hist[0] = 100;
    hist[255] = 100;
    expect(percentileFromHistogram(hist, 0.01)).toBe(0);
    expect(percentileFromHistogram(hist, 0.99)).toBe(255);
  });

  test('fallthrough return 255 when percentile > 1 pushes target beyond total', () => {
    // The fallthrough `return 255` (line 178) fires only when cumulative never reaches
    // target across all 256 buckets. With percentile in [0,1] and total > 0 this can't
    // happen in normal use, but percentile slightly > 1 pushes target = 1.0001 * total
    // above the maximum possible cumulative (= total), exercising the branch.
    const hist = new Uint32Array(256);
    hist[0] = 1; // total = 1; target = 1.0001 > 1 → loop exhausted → return 255
    expect(percentileFromHistogram(hist, 1.0001)).toBe(255);
  });
});

// ─── buildLUT ────────────────────────────────────────────────────────────────

describe('buildLUT', () => {
  test('identity (no autocontrast, contrast=1, brightness=0, gamma=1)', () => {
    const lut = buildLUT(0, 255, 1, 0, 1);
    expect(lut).toHaveLength(256);
    expect(lut).toBeInstanceOf(Uint8ClampedArray);
    // Should be close to identity; floating-point rounding may shift ±1
    for (let i = 0; i < 256; i++) {
      expect(Math.abs(lut[i]! - i)).toBeLessThanOrEqual(1);
    }
  });

  test('autocontrast stretch: lo=50, hi=200 → input 50→≈0, input 200→≈255', () => {
    const lut = buildLUT(50, 200, 1, 0, 1);
    expect(lut[50]).toBeCloseTo(0, 0);
    expect(lut[200]).toBeCloseTo(255, 0);
  });

  test('output is Uint8ClampedArray clamped to [0,255]', () => {
    const lut = buildLUT(0, 255, 10, 100, 1); // extreme contrast+brightness
    for (const v of lut) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  test('gamma=2 darkens mid-tones', () => {
    const lutLinear = buildLUT(0, 255, 1, 0, 1);
    const lutGamma2 = buildLUT(0, 255, 1, 0, 2);
    // At input=128, gamma=2 should give a lower output than linear
    expect(lutGamma2[128]!).toBeLessThan(lutLinear[128]!);
  });

  test('contrast > 1 steepens the curve', () => {
    const lutFlat = buildLUT(0, 255, 1, 0, 1);
    const lutContrast = buildLUT(0, 255, 1.5, 0, 1);
    // Below 128 should be darker, above should be brighter
    expect(lutContrast[64]!).toBeLessThanOrEqual(lutFlat[64]!);
    expect(lutContrast[200]!).toBeGreaterThanOrEqual(lutFlat[200]!);
  });
});

// ─── sampleLuminance ─────────────────────────────────────────────────────────

describe('sampleLuminance', () => {
  // 2×2 gradient: TL=0, TR=100, BL=200, BR=255
  const lum = new Float32Array([0, 100, 200, 255]);
  const W = 2;
  const H = 2;

  test('exact top-left corner → 0', () => {
    expect(sampleLuminance(lum, W, H, 0, 0)).toBeCloseTo(0, 10);
  });

  test('exact top-right corner → 100', () => {
    expect(sampleLuminance(lum, W, H, 1, 0)).toBeCloseTo(100, 10);
  });

  test('exact bottom-left → 200', () => {
    expect(sampleLuminance(lum, W, H, 0, 1)).toBeCloseTo(200, 10);
  });

  test('exact bottom-right → 255', () => {
    expect(sampleLuminance(lum, W, H, 1, 1)).toBeCloseTo(255, 10);
  });

  test('bilinear center (0.5, 0.5) → mean of all four', () => {
    const mean = (0 + 100 + 200 + 255) / 4;
    expect(sampleLuminance(lum, W, H, 0.5, 0.5)).toBeCloseTo(mean, 5);
  });

  test('out-of-bounds clamps to nearest edge', () => {
    // Negative coords clamp to 0,0
    expect(sampleLuminance(lum, W, H, -1, -1)).toBeCloseTo(0, 5);
    // Coords beyond bounds clamp to last pixel
    expect(sampleLuminance(lum, W, H, 10, 10)).toBeCloseTo(255, 5);
  });
});

// ─── computeCropRect ─────────────────────────────────────────────────────────

describe('computeCropRect', () => {
  test('square source, square target, zoom=1, centre → full square', () => {
    const r = computeCropRect(100, 100, 100, 100, 0.5, 0.5, 1);
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.width).toBeCloseTo(100, 5);
    expect(r.height).toBeCloseTo(100, 5);
  });

  test('wide source (200×100), square target (100×100) → crops width, height=100', () => {
    const r = computeCropRect(200, 100, 100, 100, 0.5, 0.5, 1);
    expect(r.height).toBeCloseTo(100, 5);
    expect(r.width).toBeCloseTo(100, 5);
    // Centre focus: x should be ~50
    expect(r.x).toBeCloseTo(50, 5);
  });

  test('tall source (100×200), square target → crops height, width=100', () => {
    const r = computeCropRect(100, 200, 100, 100, 0.5, 0.5, 1);
    expect(r.width).toBeCloseTo(100, 5);
    expect(r.height).toBeCloseTo(100, 5);
    expect(r.y).toBeCloseTo(50, 5);
  });

  test('zoom=2 halves the crop window', () => {
    const r1 = computeCropRect(200, 200, 100, 100, 0.5, 0.5, 1);
    const r2 = computeCropRect(200, 200, 100, 100, 0.5, 0.5, 2);
    expect(r2.width).toBeCloseTo(r1.width / 2, 5);
    expect(r2.height).toBeCloseTo(r1.height / 2, 5);
  });

  test('focus top-left (0,0) pushes crop to origin', () => {
    const r = computeCropRect(200, 200, 100, 100, 0, 0, 1);
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  test('crop never exceeds source bounds', () => {
    const r = computeCropRect(100, 100, 100, 100, 0.99, 0.99, 1);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(100 + 0.001);
    expect(r.y + r.height).toBeLessThanOrEqual(100 + 0.001);
  });

  test('output aspect ratio matches target aspect', () => {
    // Target 586×589: aspect ≈ 0.9949
    const r = computeCropRect(1000, 800, 586, 589, 0.5, 0.5, 1);
    expect(r.width / r.height).toBeCloseTo(586 / 589, 3);
  });
});

// ─── enumerateGridCells ───────────────────────────────────────────────────────

describe('enumerateGridCells', () => {
  test('produces at least canvas-area / cell-area cells', () => {
    const W = 100;
    const H = 100;
    const pitch = 5;
    const cells = enumerateGridCells(W, H, pitch, 0, pitch / Math.sqrt(Math.PI));
    // A 100×100 canvas at pitch=5 has at least (100/5)² = 400 cells
    expect(cells.length).toBeGreaterThanOrEqual(400);
  });

  test('no duplicate cell centres (within floating-point tolerance)', () => {
    const cells = enumerateGridCells(50, 50, 5, 45, 3);
    const keys = cells.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('0° angle produces a grid aligned to canvas axes', () => {
    const pitch = 10;
    const cells = enumerateGridCells(30, 30, pitch, 0, 0);
    // All cell centres should be multiples of pitch
    for (const [cx, cy] of cells) {
      expect(cx % pitch).toBeCloseTo(0, 6);
      expect(cy % pitch).toBeCloseTo(0, 6);
    }
  });

  test('45° angle still covers the full canvas (no missing corners)', () => {
    const W = 200;
    const H = 200;
    const pitch = 4.4;
    const maxR = pitch / Math.sqrt(Math.PI);
    const cells = enumerateGridCells(W, H, pitch, 45, maxR);
    // Every canvas pixel has at least one cell centre within pitch distance
    // — verify by checking all four corners have a nearby cell
    const corners: [number, number][] = [
      [0, 0],
      [W - 1, 0],
      [0, H - 1],
      [W - 1, H - 1],
    ];
    for (const [cx, cy] of corners) {
      const minDist = Math.min(...cells.map(([x, y]) => Math.hypot(x - cx, y - cy)));
      expect(minDist).toBeLessThanOrEqual(pitch * Math.sqrt(2));
    }
  });

  test('larger pitch produces fewer cells', () => {
    const c1 = enumerateGridCells(100, 100, 4, 45, 2);
    const c2 = enumerateGridCells(100, 100, 8, 45, 4);
    expect(c1.length).toBeGreaterThan(c2.length);
  });

  test('all returned cells include both x and y coordinates', () => {
    const cells = enumerateGridCells(50, 50, 5, 45, 3);
    for (const cell of cells) {
      expect(cell).toHaveLength(2);
      expect(typeof cell[0]).toBe('number');
      expect(typeof cell[1]).toBe('number');
    }
  });
});

// ─── PortraitProcessError ─────────────────────────────────────────────────────

describe('PortraitProcessError', () => {
  test('preserves error code and name', () => {
    const err = new PortraitProcessError('too big', 'TOO_LARGE');
    expect(err.code).toBe('TOO_LARGE');
    expect(err.name).toBe('PortraitProcessError');
    expect(err.message).toBe('too big');
    expect(err).toBeInstanceOf(Error);
  });

  test('all valid codes round-trip correctly', () => {
    const codes = [
      'INVALID_MIME',
      'INVALID_OPTIONS',
      'TOO_LARGE',
      'ZERO_DIMENSIONS',
      'PIXEL_CAP',
      'ABORTED',
      'ENCODE_FAILED',
      'DECODE_FAILED',
    ] as const;
    for (const code of codes) {
      expect(new PortraitProcessError('x', code).code).toBe(code);
    }
  });

  test('is instanceof Error', () => {
    expect(new PortraitProcessError('x', 'ABORTED')).toBeInstanceOf(Error);
  });
});

// ─── validateHalftoneOptions ──────────────────────────────────────────────────

describe('validateHalftoneOptions', () => {
  test('returns defaults for empty options', () => {
    const r = validateHalftoneOptions();
    expect(r.targetWidth).toBe(586);
    expect(r.targetHeight).toBe(589);
    expect(r.pitch).toBe(4.4);
    expect(r.angleDeg).toBe(45);
    expect(r.quality).toBe(0.89);
    expect(r.autocontrast).toBe(true);
  });

  test('rejects pitch=0 with INVALID_OPTIONS', () => {
    expect(() => validateHalftoneOptions({ pitch: 0 })).toThrow(PortraitProcessError);
    try {
      validateHalftoneOptions({ pitch: 0 });
    } catch (e) {
      expect((e as PortraitProcessError).code).toBe('INVALID_OPTIONS');
    }
  });

  test('rejects NaN / non-finite target dimensions', () => {
    expect(() => validateHalftoneOptions({ targetWidth: NaN })).toThrow(/INVALID_OPTIONS|finite/i);
    expect(() => validateHalftoneOptions({ targetHeight: Number.POSITIVE_INFINITY })).toThrow(
      PortraitProcessError
    );
  });

  test('rejects negative / zero targets and extreme values', () => {
    expect(() => validateHalftoneOptions({ targetWidth: 0 })).toThrow(PortraitProcessError);
    expect(() => validateHalftoneOptions({ targetWidth: -10 })).toThrow(PortraitProcessError);
    expect(() => validateHalftoneOptions({ targetWidth: 20_000 })).toThrow(PortraitProcessError);
  });

  test('rejects invalid focus, zoom, contrast, gamma, quality', () => {
    expect(() => validateHalftoneOptions({ focusX: 1.5 })).toThrow(PortraitProcessError);
    expect(() => validateHalftoneOptions({ zoom: 0.5 })).toThrow(PortraitProcessError);
    expect(() => validateHalftoneOptions({ contrast: 0 })).toThrow(PortraitProcessError);
    expect(() => validateHalftoneOptions({ gamma: -1 })).toThrow(PortraitProcessError);
    expect(() => validateHalftoneOptions({ quality: 1.5 })).toThrow(PortraitProcessError);
  });

  test('rejects invalid crop dimensions', () => {
    expect(() => validateHalftoneOptions({ crop: { x: 0, y: 0, width: 0, height: 10 } })).toThrow(
      PortraitProcessError
    );
    expect(() => validateHalftoneOptions({ crop: { x: -1, y: 0, width: 10, height: 10 } })).toThrow(
      PortraitProcessError
    );
  });

  test('accepts a valid manual crop', () => {
    const r = validateHalftoneOptions({
      crop: { x: 1, y: 2, width: 10, height: 20 },
    });
    expect(r.crop).toEqual({ x: 1, y: 2, width: 10, height: 20 });
  });

  test('rejects non-numeric option values including objects', () => {
    expect(() => validateHalftoneOptions({ pitch: { x: 1 } as unknown as number })).toThrow(
      PortraitProcessError
    );
    expect(() =>
      validateHalftoneOptions({
        crop: { x: Number.NaN, y: 0, width: 10, height: 10 },
      })
    ).toThrow(PortraitProcessError);
    expect(() => validateHalftoneOptions({ crop: null as unknown as undefined })).toThrow(
      PortraitProcessError
    );
  });

  test('rejects out-of-range angle, brightness, and limits', () => {
    expect(() => validateHalftoneOptions({ angleDeg: 400 })).toThrow(PortraitProcessError);
    expect(() => validateHalftoneOptions({ brightness: 300 })).toThrow(PortraitProcessError);
    expect(() => validateHalftoneOptions({ maxDecodedPixels: 0 })).toThrow(PortraitProcessError);
    expect(() => validateHalftoneOptions({ maxInputBytes: 0 })).toThrow(PortraitProcessError);
    expect(() => validateHalftoneOptions({ pitch: 300 })).toThrow(PortraitProcessError);
    expect(() => validateHalftoneOptions({ zoom: 40 })).toThrow(PortraitProcessError);
    expect(() => validateHalftoneOptions({ pitch: 'x' as unknown as number })).toThrow(
      PortraitProcessError
    );
  });
});

describe('validateCropAgainstSource', () => {
  test('accepts crop fully inside source', () => {
    expect(() =>
      validateCropAgainstSource({ x: 10, y: 10, width: 100, height: 100 }, 200, 200)
    ).not.toThrow();
  });

  test('rejects crop extending past decoded bounds with INVALID_OPTIONS', () => {
    let code = '';
    try {
      validateCropAgainstSource({ x: 150, y: 0, width: 100, height: 50 }, 200, 200);
    } catch (e) {
      expect(e).toBeInstanceOf(PortraitProcessError);
      code = (e as PortraitProcessError).code;
    }
    expect(code).toBe('INVALID_OPTIONS');
  });
});

describe('resolveWorkDimensions', () => {
  test('does not upscale small crops', () => {
    const d = resolveWorkDimensions(100, 100, 586, 589, 2);
    expect(d.width).toBe(100);
    expect(d.height).toBe(100);
  });

  test('bounds large camera-like crop to ~2× target', () => {
    // 4000×4000 crop against 586×589 → work ≤ ~1172×1178
    const d = resolveWorkDimensions(4000, 4000, 586, 589, 2);
    expect(d.width).toBeLessThanOrEqual(Math.round(586 * 2));
    expect(d.height).toBeLessThanOrEqual(Math.round(589 * 2));
    expect(d.width).toBeGreaterThan(500);
    expect(d.height).toBeGreaterThan(500);
    // Aspect preserved
    expect(d.width / d.height).toBeCloseTo(1, 2);
  });

  test('40MP-class crop is far below decoded pixel cap in work memory', () => {
    const d = resolveWorkDimensions(8000, 5000, 586, 589, 2);
    const workPixels = d.width * d.height;
    expect(workPixels).toBeLessThan(586 * 2 * 589 * 2 + 10);
    expect(workPixels).toBeLessThan(3_000_000);
  });

  test('rejects non-positive inputs', () => {
    expect(() => resolveWorkDimensions(0, 100, 586, 589, 2)).toThrow(PortraitProcessError);
    expect(() => resolveWorkDimensions(100, 100, 586, 589, 0)).toThrow(PortraitProcessError);
  });
});
