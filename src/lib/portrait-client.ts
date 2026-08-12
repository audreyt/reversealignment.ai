/**
 * portrait-client.ts — shared browser-side driver for the halftone pipeline.
 *
 * One implementation of the execution policy for every surface that screens a
 * portrait (the join form and the portrait lab):
 *   1. Try the module Worker (halftone.worker.ts) so the main thread stays free.
 *   2. Fall back to main-thread processPortrait ONLY on transport failures
 *      (worker failed to load, threw, or sent an uncloneable message).
 *      Domain PortraitProcessError codes are surfaced, never retried — a
 *      rejected MIME type or a pixel-cap breach fails the same way twice.
 *
 * AbortSignal is not structured-cloneable, so worker cancellation is
 * terminate()-then-respawn; the main-thread path uses the signal directly.
 */

import {
  PortraitProcessError,
  processPortrait,
  type HalftoneOptions,
  type HalftoneResult,
} from './halftone';
import type { WorkerRequest, WorkerResponse } from '../workers/halftone.worker';

/** Codes that mean "this input will fail identically on the main thread". */
export const DOMAIN_ERROR_CODES: Record<string, true> = {
  INVALID_MIME: true,
  INVALID_OPTIONS: true,
  TOO_LARGE: true,
  ZERO_DIMENSIONS: true,
  PIXEL_CAP: true,
  ABORTED: true,
  ENCODE_FAILED: true,
  DECODE_FAILED: true,
};

export function isDomainProcessError(err: unknown): err is PortraitProcessError {
  return err instanceof PortraitProcessError && DOMAIN_ERROR_CODES[err.code] === true;
}

/**
 * Directory-avatar screen: a square crop at 320 px with the pitch scaled from
 * the 586 px cohort treatment (4.4 / 586 ≈ 0.0075 px of pitch per px of width),
 * so an avatar keeps the same dot density as the printed portraits.
 */
export const AVATAR_PORTRAIT_OPTIONS = {
  targetWidth: 320,
  targetHeight: 320,
  pitch: 2.4,
  quality: 0.86,
} as const satisfies HalftoneOptions;

/** Accepted source types for a portrait picker, as an input[accept] value. */
export const PORTRAIT_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';

export type PortraitRunOptions = Omit<HalftoneOptions, 'signal'>;

export interface PortraitRunner {
  /** False once the worker path has been ruled out for this page. */
  readonly workerAvailable: boolean;
  /** Whether the most recent run() executed in the worker. */
  readonly usedWorker: boolean;
  run(file: File, options: PortraitRunOptions, signal: AbortSignal): Promise<HalftoneResult>;
  /** Terminate the worker — call on pagehide. */
  dispose(): void;
}

/* c8 ignore start */
// Worker/DOM plumbing: exercised by tests/e2e/halftone-lab.e2e.ts and
// tests/e2e/join-form.e2e.ts in a real browser, unreachable from Node.

/**
 * Hand-rolled resolvers: Promise.withResolvers needs Safari/iOS 17.4+, and this
 * module ships to the same browsers as halftone.ts, whose canvas encode path
 * holds that identical baseline. Both files must agree or mobile photo uploads
 * break on older iOS.
 */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function createPortraitRunner(): PortraitRunner {
  let worker: Worker | null = spawn();
  let available = worker !== null;
  let lastUsedWorker = false;

  function spawn(): Worker | null {
    try {
      return new Worker(new URL('../workers/halftone.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      return null;
    }
  }

  function runViaWorker(
    file: File,
    options: PortraitRunOptions,
    signal: AbortSignal
  ): Promise<HalftoneResult> {
    const { promise, resolve, reject } = deferred<HalftoneResult>();
    if (!worker) {
      reject(new Error('Worker not available'));
      return promise;
    }

    const id = Math.random().toString(36).slice(2);
    const w = worker;
    let settled = false;

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      w.removeEventListener('messageerror', onMsgError);
    };

    const settleReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const settleResolve = (value: HalftoneResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    /** Transport failure: kill the worker, mark unavailable, reject plain Error. */
    const failTransport = (err: unknown) => {
      try {
        w.terminate();
      } catch {
        // ignore
      }
      available = false;
      worker = null;
      settleReject(err instanceof Error ? err : new Error(String(err)));
    };

    const onAbort = () => {
      try {
        w.terminate();
      } catch {
        // ignore
      }
      // Spawn a replacement so the *next* run still attempts the worker path.
      worker = spawn();
      available = worker !== null;
      settleReject(new PortraitProcessError('Processing aborted', 'ABORTED'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const onError = (_evt: ErrorEvent) => {
      failTransport(new Error('Worker failed to load or threw an uncaught error'));
    };

    const onMsgError = (_evt: MessageEvent) => {
      failTransport(new Error('Worker sent an uncloneable message'));
    };

    const onMessage = (evt: MessageEvent<WorkerResponse>) => {
      const msg = evt.data;
      if (msg.id !== id) return;
      if (msg.ok) {
        settleResolve(msg.result);
        return;
      }
      const code = msg.error.code;
      if (DOMAIN_ERROR_CODES[code] === true) {
        settleReject(
          new PortraitProcessError(msg.error.message, code as PortraitProcessError['code'])
        );
        return;
      }
      // Unknown worker failure → treat as transport-ish and allow retry.
      failTransport(new Error(msg.error.message || 'Worker reported failure'));
    };

    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError, { once: true });
    w.addEventListener('messageerror', onMsgError, { once: true });

    file
      .arrayBuffer()
      .then((bytes) => {
        if (signal.aborted) {
          settleReject(new PortraitProcessError('Processing aborted', 'ABORTED'));
          return;
        }
        if (settled) return;
        const req: WorkerRequest = {
          id,
          bytes,
          mimeType: file.type || 'image/png',
          name: file.name,
          options,
        };
        w.postMessage(req, [bytes]);
      })
      .catch((e: unknown) => {
        if (signal.aborted) {
          settleReject(new PortraitProcessError('Processing aborted', 'ABORTED'));
          return;
        }
        failTransport(e);
      });

    return promise;
  }

  return {
    get workerAvailable() {
      return available;
    },
    get usedWorker() {
      return lastUsedWorker;
    },
    async run(
      file: File,
      options: PortraitRunOptions,
      signal: AbortSignal
    ): Promise<HalftoneResult> {
      if (available) {
        try {
          const result = await runViaWorker(file, options, signal);
          lastUsedWorker = true;
          return result;
        } catch (workerErr) {
          // The worker judged the input on its merits — it fails identically on
          // the main thread, so surface it instead of burning a second render.
          if (isDomainProcessError(workerErr)) {
            lastUsedWorker = true;
            throw workerErr;
          }
          if (signal.aborted) {
            lastUsedWorker = true;
            throw new PortraitProcessError('Processing aborted', 'ABORTED');
          }
        }
      }
      const result = await processPortrait(file, { ...options, signal });
      lastUsedWorker = false;
      return result;
    },
    dispose() {
      if (!worker) return;
      try {
        worker.terminate();
      } catch {
        // ignore
      }
      worker = null;
      available = false;
    },
  };
}
/* c8 ignore stop */
