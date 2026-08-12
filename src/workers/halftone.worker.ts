/**
 * halftone.worker.ts — Portrait halftone Web Worker.
 *
 * Delegates entirely to processPortrait() so there is exactly one
 * implementation of the pipeline (validation, polarity, encoding).
 * AbortSignal is NOT cloneable across the worker boundary; the caller
 * aborts by calling worker.terminate() instead.
 *
 * Message protocol:
 *   IN:  WorkerRequest  (bytes transferred, not copied)
 *   OUT: WorkerResponse (blob is structured-cloneable — no ArrayBuffer round-trip needed)
 */

import {
  PortraitProcessError,
  processPortrait,
  type HalftoneOptions,
  type HalftoneResult,
} from '../lib/halftone';

/** signal is stripped — abort the worker via worker.terminate() instead. */
export type WorkerRequest = {
  id: string;
  bytes: ArrayBuffer;
  mimeType: string;
  /** Preserved so processPortrait can derive the output filename stem. */
  name?: string;
  options?: Omit<HalftoneOptions, 'signal'>;
};

export type WorkerResponse =
  | { id: string; ok: true; result: HalftoneResult }
  | { id: string; ok: false; error: { message: string; code: string } };

self.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
  const { id, bytes, mimeType, name, options } = event.data;

  // Reconstruct as File when a name is available so processPortrait derives
  // the output filename stem correctly; otherwise a plain Blob suffices.
  const input = name
    ? new File([bytes], name, { type: mimeType })
    : new Blob([bytes], { type: mimeType });

  try {
    const result = await processPortrait(input, options);
    // Blob is structured-cloneable; no manual ArrayBuffer conversion needed.
    (self as unknown as Worker).postMessage({ id, ok: true, result } satisfies WorkerResponse);
  } catch (err) {
    const response: WorkerResponse = {
      id,
      ok: false,
      error: {
        message: err instanceof Error ? err.message : String(err),
        code: err instanceof PortraitProcessError ? err.code : 'UNKNOWN',
      },
    };
    (self as unknown as Worker).postMessage(response);
  }
};
