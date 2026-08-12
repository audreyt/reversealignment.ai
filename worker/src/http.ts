// Env comes from wrangler-generated worker-configuration.d.ts (global interface Env).
// Optional secrets/bindings are augmented in worker/env.d.ts.

// Every origin that may post a join: the apex and www of each whole-domain
// locale deployment, plus the API host itself.
const DEFAULT_ORIGINS = [
  'https://join.reversealignment.tw',
  'https://reversealignment.ai',
  'https://www.reversealignment.ai',
  'https://reversealignment.tw',
  'https://www.reversealignment.tw',
  'https://reversealignment.jp',
  'https://www.reversealignment.jp',
];

export const MAX_JSON_BYTES = 32_768;
// Multipart join = text fields + optional portrait; hard cap above the portrait alone.
export const MAX_MULTIPART_BYTES = 200_000;
// Raw uploads are portraits only, so the transfer cap is the portrait cap.
export { MAX_PORTRAIT_BYTES as MAX_BINARY_BYTES } from '../../src/lib/portrait-limits';
import { MAX_PORTRAIT_BYTES as MAX_BINARY_BYTES } from '../../src/lib/portrait-limits';

export function allowedOrigins(env: Env): string[] {
  const raw = env.ALLOWED_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return raw && raw.length > 0 ? raw : DEFAULT_ORIGINS;
}

export function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin') || '';
  const allow = allowedOrigins(env);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Admin-Token, Cf-Access-Jwt-Assertion',
    'Access-Control-Max-Age': '86400',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin',
  };
  if (origin && allow.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function json(request: Request, env: Env, body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  const cors = corsHeaders(request, env);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function noContent(request: Request, env: Env): Response {
  const headers = new Headers(corsHeaders(request, env));
  headers.set('Referrer-Policy', 'no-referrer');
  return new Response(null, { status: 204, headers });
}

export class PayloadTooLargeError extends Error {
  constructor() {
    super('payload_too_large');
    this.name = 'PayloadTooLargeError';
  }
}

export class InvalidJsonError extends Error {
  constructor() {
    super('invalid_json');
    this.name = 'InvalidJsonError';
  }
}

/** Stream-capped JSON body reader (Content-Length precheck + byte cap). */
export async function readJson(request: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  const declared = request.headers.get('Content-Length');
  if (declared) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) throw new PayloadTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return {};

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  }

  if (total === 0) return {};
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged)) as unknown;
  } catch {
    throw new InvalidJsonError();
  }
}

/** Stream-capped raw body reader; same Content-Length precheck + cap semantics as readJson. */
export async function readBinary(
  request: Request,
  maxBytes = MAX_BINARY_BYTES
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get('Content-Length');
  if (declared) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) throw new PayloadTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Stream-cap multipart bytes before invoking the platform parser. Relying only
 * on Content-Length would let chunked requests allocate without the 200KB cap.
 */
export async function readMultipartFormData(
  request: Request,
  maxBytes = MAX_MULTIPART_BYTES
): Promise<FormData> {
  const contentType = request.headers.get('Content-Type') || '';
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType)) {
    throw new TypeError('invalid_multipart');
  }
  const bytes = await readBinary(request, maxBytes);
  return new Response(bytes, { headers: { 'Content-Type': contentType } }).formData();
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    ''
  );
}

export function isOriginAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // non-browser / same-site navigations
  // Always accept exact same-origin (local ports, custom domains).
  try {
    if (origin === new URL(request.url).origin) return true;
  } catch {
    /* ignore */
  }
  return allowedOrigins(env).includes(origin);
}
