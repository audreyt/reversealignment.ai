/**
 * Portrait transfer limits shared by the browser and the Worker.
 *
 * Both sides must agree: the browser refuses to offer a portrait it knows the
 * API will reject, and the Worker enforces the same ceiling on untrusted bytes.
 *
 * The ceiling is measured, not guessed. A 320×320 halftone at pitch 2.4 encodes
 * to ~54 KB for an ordinary photo, 68 KB for pure luminance noise (the densest
 * possible dot field), and 88 KB when a browser without canvas WebP falls back
 * to PNG. 160 KB leaves close to 2× headroom over that worst observed case
 * while keeping a staged blob small enough to sit in a D1 row for 30 minutes.
 */
export const MAX_PORTRAIT_BYTES = 160_000;

/** Reject implausible screens outright — the pipeline only ever emits 320². */
export const PORTRAIT_MIN_DIM = 64;
export const PORTRAIT_MAX_DIM = 1024;
