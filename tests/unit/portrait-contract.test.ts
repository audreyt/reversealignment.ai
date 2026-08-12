import { describe, expect, test } from 'vite-plus/test';
import { JOIN_API_PATH, JOIN_PATH } from '../../src/lib/api';
import {
  MAX_PORTRAIT_BYTES,
  PORTRAIT_MAX_DIM,
  PORTRAIT_MIN_DIM,
} from '../../src/lib/portrait-limits';
import {
  AVATAR_PORTRAIT_OPTIONS,
  DOMAIN_ERROR_CODES,
  PORTRAIT_ACCEPT,
  isDomainProcessError,
} from '../../src/lib/portrait-client';
import { PortraitProcessError } from '../../src/lib/halftone';
import * as workerPortrait from '../../worker/src/portrait';

describe('join app paths', () => {
  test('keeps the join page and its submit route on one same-origin path', () => {
    // The form posts page-relative, so the page path and API path must agree or
    // every submit lands on a 404 the browser reports as a network failure.
    expect(JOIN_PATH).toBe('/join/');
    expect(JOIN_API_PATH).toBe('/join/api');
    expect(JOIN_API_PATH.startsWith(JOIN_PATH)).toBe(true);
  });
});

describe('portrait limits', () => {
  // The browser refuses portraits the Worker would reject; a silent drift here
  // would surface as a 413 only after the visitor already submitted.
  test('the Worker validator enforces exactly the limits the browser applies', () => {
    expect(workerPortrait.MAX_PORTRAIT_BYTES).toBe(MAX_PORTRAIT_BYTES);
    expect(workerPortrait.PORTRAIT_MIN_DIM).toBe(PORTRAIT_MIN_DIM);
    expect(workerPortrait.PORTRAIT_MAX_DIM).toBe(PORTRAIT_MAX_DIM);
  });

  test('leaves headroom over the measured worst-case screen', () => {
    // 88_427 bytes is the largest observed output: 320×320 noise via the PNG
    // fallback path. Anything at or below that must fit with room to spare.
    expect(MAX_PORTRAIT_BYTES).toBeGreaterThan(88_427);
    expect(PORTRAIT_MIN_DIM).toBeLessThan(AVATAR_PORTRAIT_OPTIONS.targetWidth);
    expect(PORTRAIT_MAX_DIM).toBeGreaterThan(AVATAR_PORTRAIT_OPTIONS.targetHeight);
  });
});

describe('avatar screen options', () => {
  test('emits a square screen with the cohort dot density', () => {
    expect(AVATAR_PORTRAIT_OPTIONS.targetWidth).toBe(AVATAR_PORTRAIT_OPTIONS.targetHeight);
    // Pitch tracks the 586 px cohort treatment (4.4 px pitch) within 5 %.
    const cohortRatio = 4.4 / 586;
    const ratio = AVATAR_PORTRAIT_OPTIONS.pitch / AVATAR_PORTRAIT_OPTIONS.targetWidth;
    expect(Math.abs(ratio - cohortRatio) / cohortRatio).toBeLessThan(0.05);
    expect(AVATAR_PORTRAIT_OPTIONS.quality).toBeGreaterThan(0);
    expect(AVATAR_PORTRAIT_OPTIONS.quality).toBeLessThanOrEqual(1);
  });

  test('accepts only still-image types the pipeline can decode', () => {
    const accepted = PORTRAIT_ACCEPT.split(',');
    expect(accepted).toContain('image/jpeg');
    expect(accepted).toContain('image/png');
    expect(accepted).toContain('image/webp');
    expect(accepted.every((type) => type.startsWith('image/'))).toBe(true);
  });
});

describe('worker-vs-main-thread retry policy', () => {
  test('every processPortrait failure mode is treated as final', () => {
    for (const code of [
      'INVALID_MIME',
      'INVALID_OPTIONS',
      'TOO_LARGE',
      'ZERO_DIMENSIONS',
      'PIXEL_CAP',
      'ABORTED',
      'ENCODE_FAILED',
      'DECODE_FAILED',
    ] as const) {
      expect(DOMAIN_ERROR_CODES[code], code).toBe(true);
      expect(isDomainProcessError(new PortraitProcessError('x', code)), code).toBe(true);
    }
  });

  test('transport failures stay retryable on the main thread', () => {
    expect(isDomainProcessError(new Error('Worker failed to load'))).toBe(false);
    expect(isDomainProcessError(null)).toBe(false);
    expect(isDomainProcessError({ code: 'INVALID_MIME' })).toBe(false);
    // An unknown code from a future worker build must not be treated as final.
    expect(
      isDomainProcessError(new PortraitProcessError('x', 'UNKNOWN' as PortraitProcessError['code']))
    ).toBe(false);
  });
});
