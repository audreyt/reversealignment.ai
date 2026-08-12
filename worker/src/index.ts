import { requireAccessIdentity, type AccessIdentity } from './access';
import { adminTokenAccepted } from './admin-auth';
import { hashEmail, hashImportedEmail, hashIp, randomToken } from './crypto';
import {
  clientIp,
  corsHeaders,
  isOriginAllowed,
  json,
  noContent,
  PayloadTooLargeError,
  readJson,
  readMultipartFormData,
} from './http';
import {
  findMemberByEmailHashes,
  listPublishedMembers,
  parseListQuery,
  storeVerifiedMemberEmail,
} from './members';
import { moderateSubmission, recordModeration } from './moderation';
import { normalizeNameKey } from './names';
import {
  inspectPortrait,
  MAX_PORTRAIT_BYTES,
  portraitKey,
  portraitKeyFromPathSegment,
  type PortraitKind,
} from './portrait';
import { takeToken } from './rate-limit';
import { classifyJoinIntent, parseJoinBody, type JoinIntent, type JoinPayload } from './validate';

const JOIN_PENDING_MESSAGE =
  'Thanks — your profile will appear in the directory after moderation, never automatically.';
const JOIN_UPDATES_MESSAGE =
  'Thanks — you are on the updates list. This does not place a profile in the public directory.';
const JOIN_ALREADY_MESSAGE = 'Thanks — your submission is already recorded.';

const JOIN_API_PATH = '/join/api';

/** R2 binding may be absent in deploys that have not provisioned portraits. */
function portraitStore(env: Env): R2Bucket | undefined {
  return (env as { PORTRAITS?: R2Bucket }).PORTRAITS;
}

function asString(value: unknown, max = 80): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function requestHostname(url: URL): string {
  return url.hostname.toLowerCase();
}

/**
 * Exact www → apex hosts. A blanket `www.` strip would invent hostnames we do
 * not own, so the three live zones are listed outright.
 */
const WWW_APEX_BY_HOST: Record<string, string> = {
  'www.reversealignment.ai': 'reversealignment.ai',
  'www.reversealignment.tw': 'reversealignment.tw',
  'www.reversealignment.jp': 'reversealignment.jp',
};

/**
 * Hosts allowed to serve the Access-gated join POST — the apex of every
 * whole-domain locale deployment. www is absent because it never gets this far:
 * it redirects to the apex first, so one Access destination per zone covers the
 * join. join.reversealignment.tw and workers.dev are absent for the opposite
 * reason: the API host must never accept a join mutation.
 */
const DEFAULT_JOIN_API_HOSTS = [
  'reversealignment.ai',
  'reversealignment.tw',
  'reversealignment.jp',
];

function joinApiHosts(env: Env): string[] {
  const raw = (env.JOIN_API_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return raw.length > 0 ? raw : DEFAULT_JOIN_API_HOSTS;
}

function isJoinApiPath(pathname: string): boolean {
  return pathname === JOIN_API_PATH || pathname === `${JOIN_API_PATH}/`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handle(request, env, ctx);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', err: String(err) }));
      return json(request, env, { error: 'internal_error' }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const host = requestHostname(url);

  // www is never a destination of its own. Redirect to the apex before any API
  // or preflight handling so every path, query and method moves together; 308
  // is permanent and preserves the method, so an in-flight POST survives.
  // `typeof` rather than a truth test: a host named `__proto__` would otherwise
  // read straight through Object.prototype.
  const apex = WWW_APEX_BY_HOST[host];
  if (typeof apex === 'string') {
    url.hostname = apex;
    return Response.redirect(url.toString(), 308);
  }

  if (
    request.method === 'OPTIONS' &&
    (url.pathname.startsWith('/api/') || isJoinApiPath(url.pathname))
  ) {
    return noContent(request, env);
  }

  // Access-gated direct join — only on reversealignment.ai (not join host / workers.dev).
  if (isJoinApiPath(url.pathname)) {
    if (!joinApiHosts(env).includes(host)) {
      return json(request, env, { error: 'not_found' }, { status: 404 });
    }
    if (request.method !== 'POST') {
      return json(request, env, { error: 'method_not_allowed' }, { status: 405 });
    }
    if (!isOriginAllowed(request, env)) {
      return json(request, env, { error: 'origin_not_allowed' }, { status: 403 });
    }
    const identity = await requireAccessIdentity(request, env);
    if (identity instanceof Response) return identity;
    return handleJoinApi(request, env, ctx, identity);
  }

  // Legacy / wrong-host join paths never create members.
  if (
    url.pathname === '/join' ||
    url.pathname.startsWith('/join/') ||
    url.pathname === '/api/join' ||
    url.pathname.startsWith('/api/join/')
  ) {
    return json(request, env, { error: 'not_found' }, { status: 404 });
  }

  if (url.pathname.startsWith('/api/')) {
    if (request.method !== 'GET' && request.method !== 'POST') {
      return json(request, env, { error: 'method_not_allowed' }, { status: 405 });
    }
    if (request.method === 'POST' && !isOriginAllowed(request, env)) {
      return json(request, env, { error: 'origin_not_allowed' }, { status: 403 });
    }
  }

  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json(request, env, { ok: true, service: 'reversealignment-api' });
  }
  if (url.pathname === '/api/members' && request.method === 'GET') {
    const query = parseListQuery(url);
    const { total, members } = await listPublishedMembers(env, query);
    return json(request, env, { total, count: members.length, query, members });
  }
  {
    const portraitMatch = url.pathname.match(/^\/api\/portrait\/([^/]+)$/);
    if (portraitMatch && request.method === 'GET') {
      return handleGetPortrait(request, env, portraitMatch[1] || '');
    }
  }
  if (url.pathname === '/api/admin/queue' && request.method === 'GET') {
    return handleAdminQueue(request, env);
  }
  if (url.pathname === '/api/admin/members' && request.method === 'POST') {
    return handleAdminModerate(request, env);
  }

  return json(request, env, { error: 'not_found' }, { status: 404 });
}

async function handleJoinApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  identity: AccessIdentity
): Promise<Response> {
  const pepper = requirePepper(env);
  const importSalt = requireImportSalt(env);
  const ip = clientIp(request);
  const ipHash = await hashIp(ip, pepper);
  const emailHash = await hashEmail(identity.email, pepper);
  const importedEmailHash = await hashImportedEmail(identity.email, importSalt);

  const ipLimit = await takeToken(env, 'join_ip', ipHash || 'unknown', 8, 60 * 60);
  if (!ipLimit.ok) {
    return json(
      request,
      env,
      { error: 'rate_limited', retryAfter: ipLimit.retryAfter },
      { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfter) } }
    );
  }

  const emailLimit = await takeToken(env, 'join_email', emailHash, 5, 60 * 60);
  if (!emailLimit.ok) {
    return json(
      request,
      env,
      { error: 'rate_limited', retryAfter: emailLimit.retryAfter },
      { status: 429, headers: { 'Retry-After': String(emailLimit.retryAfter) } }
    );
  }

  let form: FormData;
  try {
    form = await readMultipartFormData(request);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return json(request, env, { error: 'payload_too_large' }, { status: 413 });
    }
    return json(request, env, { error: 'invalid_multipart' }, { status: 400 });
  }

  const fields: Record<string, unknown> = {};
  for (const key of [
    'fullName',
    'affiliation',
    'sector',
    'contribution',
    'links',
    'statement',
    'website',
    'company_website',
  ]) {
    const value = form.get(key);
    if (typeof value === 'string') fields[key] = value;
  }

  const parsed = parseJoinBody(fields);
  if (!parsed.ok) {
    return json(
      request,
      env,
      { error: 'validation_failed', fields: parsed.errors },
      { status: 400 }
    );
  }
  // Honeypot: authenticated decoy — no write. Mirror the status/message the real
  // path would return for this contribution so bots cannot oracle intent gating.
  if (parsed.data.website) {
    const intent = classifyJoinIntent(parsed.data.contribution);
    const status = intent === 'directory' ? 'pending_review' : 'updates_only';
    return json(request, env, {
      ok: true,
      status,
      message: status === 'pending_review' ? JOIN_PENDING_MESSAGE : JOIN_UPDATES_MESSAGE,
    });
  }

  let portraitBytes: Uint8Array | null = null;
  let portraitMime: PortraitKind | null = null;
  const portraitPart = form.get('portrait');
  if (portraitPart instanceof File && portraitPart.size > 0) {
    if (portraitPart.size > MAX_PORTRAIT_BYTES) {
      return json(request, env, { error: 'payload_too_large' }, { status: 413 });
    }
    const buf = new Uint8Array(await portraitPart.arrayBuffer());
    if (buf.byteLength > MAX_PORTRAIT_BYTES) {
      return json(request, env, { error: 'payload_too_large' }, { status: 413 });
    }
    const check = inspectPortrait(buf);
    if (!check.ok) {
      const status = check.error === 'portrait_unsupported_type' ? 415 : 400;
      return json(request, env, { error: check.error }, { status });
    }
    portraitBytes = buf;
    portraitMime = check.mimeType;
  }

  const existing = await findMemberByEmailHashes(env, emailHash, importedEmailHash);
  if (existing) {
    await storeVerifiedMemberEmail(env, existing.id, identity.email);
    return json(request, env, {
      ok: true,
      status: 'already_recorded',
      message: JOIN_ALREADY_MESSAGE,
      memberId: existing.id,
    });
  }

  const payload: JoinPayload = {
    ...parsed.data,
    email: identity.email,
  };
  const intent = classifyJoinIntent(payload.contribution);

  const result = await createPendingMember(env, ctx, {
    emailHash,
    importedEmailHash,
    emailDomain: identity.emailDomain,
    payload,
    intent,
    portraitBytes,
    portraitMime,
  });

  if (result.kind === 'already_recorded') {
    return json(request, env, {
      ok: true,
      status: 'already_recorded',
      message: JOIN_ALREADY_MESSAGE,
      memberId: result.memberId,
    });
  }

  const body: Record<string, unknown> = {
    ok: true,
    status: result.status,
    message: result.status === 'pending_review' ? JOIN_PENDING_MESSAGE : JOIN_UPDATES_MESSAGE,
    memberId: result.memberId,
  };
  if (portraitBytes) body.portraitStored = result.portraitStored;
  return json(request, env, body);
}

type CreatePendingResult =
  | {
      kind: 'created';
      memberId: string;
      portraitStored: boolean;
      status: 'pending_review' | 'updates_only';
    }
  | { kind: 'already_recorded'; memberId: string };

async function createPendingMember(
  env: Env,
  ctx: ExecutionContext,
  opts: {
    emailHash: string;
    importedEmailHash: string;
    emailDomain: string;
    payload: JoinPayload;
    intent: JoinIntent;
    portraitBytes: Uint8Array | null;
    portraitMime: PortraitKind | null;
  }
): Promise<CreatePendingResult> {
  // Directory intents still fail closed through moderation. Updates-only rows are
  // retained for outreach, never queued for public publication.
  const moderation =
    opts.intent === 'directory'
      ? await moderateSubmission(env, opts.payload)
      : {
          recommendation: 'allow' as const,
          decision: 'queued_review' as const,
          score: 0,
          reasons: ['updates_only_no_directory'],
          model: 'intent',
        };
  const memberStatus = opts.intent === 'directory' ? 'pending_review' : 'updates_only';
  const memberId = `mbr_${randomToken(16)}`;
  const nameKey = normalizeNameKey(opts.payload.fullName);
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO members (
        id, email_hash, email, email_domain, full_name, name_key, affiliation, role, sector,
        contribution, links, statement, image_key, source, status, sort_index,
        moderation_score, moderation_notes, moderation_model, moderation_recommendation,
        created_at, updated_at, published_at, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'community', ?, 1000,
        ?, ?, ?, ?, ?, ?, NULL, ?)`
    )
      .bind(
        memberId,
        opts.emailHash,
        opts.payload.email,
        opts.emailDomain,
        opts.payload.fullName,
        nameKey,
        opts.payload.affiliation,
        opts.payload.affiliation || opts.payload.sector,
        opts.payload.sector,
        opts.payload.contribution,
        opts.payload.links,
        opts.payload.statement,
        memberStatus,
        moderation.score,
        moderation.reasons.join('; ').slice(0, 500),
        moderation.model,
        moderation.recommendation,
        now,
        now,
        now
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique|constraint/i.test(msg)) {
      const again = await findMemberByEmailHashes(env, opts.emailHash, opts.importedEmailHash);
      if (again) {
        await storeVerifiedMemberEmail(env, again.id, opts.payload.email);
      }
      return {
        kind: 'already_recorded',
        memberId: again?.id || memberId,
      };
    }
    throw err;
  }

  ctx.waitUntil(recordModeration(env, { memberId, result: moderation }));

  let portraitStored = false;
  if (opts.portraitBytes && opts.portraitBytes.byteLength > 0 && opts.portraitMime) {
    try {
      const store = portraitStore(env);
      if (store) {
        const key = await portraitKey(opts.portraitBytes, opts.portraitMime);
        await store.put(key, opts.portraitBytes, {
          httpMetadata: {
            contentType: opts.portraitMime,
            cacheControl: 'public, max-age=31536000, immutable',
          },
        });
        await env.DB.prepare(`UPDATE members SET image_key = ?, updated_at = ? WHERE id = ?`)
          .bind(key, now, memberId)
          .run();
        portraitStored = true;
      } else {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'portrait_storage_unavailable',
            memberId,
          })
        );
      }
    } catch {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'portrait_put_failed',
          memberId,
        })
      );
    }
  }

  return { kind: 'created', memberId, portraitStored, status: memberStatus };
}

async function handleGetPortrait(request: Request, env: Env, segment: string): Promise<Response> {
  const key = portraitKeyFromPathSegment(segment);
  if (!key) {
    return json(request, env, { error: 'not_found' }, { status: 404 });
  }

  const store = portraitStore(env);
  if (!store) {
    return json(request, env, { error: 'not_found' }, { status: 404 });
  }

  const obj = await store.get(key);
  if (!obj) {
    return json(request, env, { error: 'not_found' }, { status: 404 });
  }

  const ext = segment.endsWith('.webp') ? 'webp' : 'png';
  const contentType =
    obj.httpMetadata?.contentType || (ext === 'webp' ? 'image/webp' : 'image/png');

  const headers = new Headers(corsHeaders(request, env));
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');

  return new Response(obj.body, { status: 200, headers });
}

async function requireAdmin(request: Request, env: Env): Promise<Response | null> {
  const token = env.ADMIN_TOKEN;
  if (!token) {
    return json(
      request,
      env,
      {
        error: 'admin_disabled',
        message:
          'Set ADMIN_TOKEN secret to enable the HTTP moderation API, or use wrangler D1 commands (see README).',
      },
      { status: 503 }
    );
  }
  const header =
    request.headers.get('X-Admin-Token') ||
    request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ||
    '';
  if (!(await adminTokenAccepted(token, header))) {
    return json(request, env, { error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

async function handleAdminQueue(request: Request, env: Env): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const rows = await env.DB.prepare(
    `SELECT id, email, full_name, affiliation, sector, status, contribution, links, statement,
            moderation_score, moderation_notes, moderation_model, moderation_recommendation,
            created_at, verified_at
     FROM members
     WHERE status = 'pending_review'
     ORDER BY created_at ASC
     LIMIT 100`
  ).all();
  return json(request, env, { count: rows.results?.length ?? 0, members: rows.results ?? [] });
}

async function handleAdminModerate(request: Request, env: Env): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await readJson(request);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return json(request, env, { error: 'payload_too_large' }, { status: 413 });
    }
    return json(request, env, { error: 'invalid_json' }, { status: 400 });
  }

  const rec = (body || {}) as Record<string, unknown>;
  const id = asString(rec.id, 80);
  const action = asString(rec.action, 40).toLowerCase();
  if (!id || (action !== 'publish' && action !== 'reject' && action !== 'suspend')) {
    return json(request, env, { error: 'invalid_action' }, { status: 400 });
  }

  const row = await env.DB.prepare(
    `SELECT id, status, source, full_name, name_key FROM members WHERE id = ?`
  )
    .bind(id)
    .first<{ id: string; status: string; source: string; full_name: string; name_key: string }>();
  if (!row) return json(request, env, { error: 'not_found' }, { status: 404 });
  // Canonical rows may be suspended for emergency hide; only suspend + republish allowed.
  if (row.source === 'canonical') {
    if (action === 'reject') {
      return json(request, env, { error: 'canonical_protected' }, { status: 400 });
    }
    if (action === 'publish' && row.status !== 'suspended') {
      return json(request, env, { error: 'canonical_protected' }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  if (action === 'publish') {
    if (
      row.status !== 'pending_review' &&
      row.status !== 'rejected' &&
      row.status !== 'suspended'
    ) {
      return json(request, env, { error: 'not_publishable' }, { status: 400 });
    }
    const nameKey = row.name_key || normalizeNameKey(row.full_name);
    const clash = await env.DB.prepare(
      `SELECT id FROM members
       WHERE status = 'published' AND name_key = ? AND id != ?
       LIMIT 1`
    )
      .bind(nameKey, id)
      .first();
    if (clash) {
      return json(request, env, { error: 'name_collision' }, { status: 409 });
    }
    try {
      await env.DB.prepare(
        `UPDATE members
         SET status = 'published', name_key = ?, published_at = COALESCE(published_at, ?),
             updated_at = ?, moderation_notes = TRIM(moderation_notes || ' | admin_publish')
         WHERE id = ?`
      )
        .bind(nameKey, now, now, id)
        .run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unique|constraint/i.test(msg)) {
        return json(request, env, { error: 'name_collision' }, { status: 409 });
      }
      throw err;
    }
  } else if (action === 'reject') {
    await env.DB.prepare(
      `UPDATE members SET status = 'rejected', updated_at = ?,
       moderation_notes = TRIM(moderation_notes || ' | admin_reject')
       WHERE id = ?`
    )
      .bind(now, id)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE members SET status = 'suspended', updated_at = ?,
       moderation_notes = TRIM(moderation_notes || ' | admin_suspend')
       WHERE id = ?`
    )
      .bind(now, id)
      .run();
  }

  await recordModeration(env, {
    memberId: id,
    result: {
      recommendation: action === 'publish' ? 'allow' : 'reject_suggested',
      decision: 'queued_review',
      score: action === 'publish' ? 0 : 1,
      reasons: [`admin_${action}`],
      model: 'admin',
    },
  });

  return json(request, env, { ok: true, id, action });
}

function requirePepper(env: Env): string {
  if (env.AUTH_PEPPER && env.AUTH_PEPPER.length >= 16) return env.AUTH_PEPPER;
  throw new Error('AUTH_PEPPER missing');
}

function requireImportSalt(env: Env): string {
  if (env.IMPORT_SALT && env.IMPORT_SALT.length >= 16) return env.IMPORT_SALT;
  throw new Error('IMPORT_SALT missing');
}
