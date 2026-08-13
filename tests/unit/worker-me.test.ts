import { afterEach, describe, expect, test } from 'vite-plus/test';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { resetAccessJwksCacheForTests } from '../../worker/src/access';
import worker from '../../worker/src/index';

const ISSUER = 'https://erc.cloudflareaccess.com';
const AUD = 'test-access-aud-tag';
const JWKS_PATH = '/cdn-cgi/access/certs';
const PEPPER = 'unit-test-pepper-32-bytes-long!!';
const IMPORT_SALT = 'unit-test-import-salt-16+';
const ME_URL = 'https://reversealignment.ai/join/api/me';
// isPortraitKey accepts exactly `portraits/<64 lowercase hex>.webp|png`, so a
// shorter placeholder would be rejected and silently skip the R2 branch.
const PORTRAIT_A = `portraits/${'a'.repeat(64)}.webp`;
const PORTRAIT_SHARED = `portraits/${'b'.repeat(64)}.webp`;

type Row = {
  id: string;
  email_hash: string;
  full_name: string;
  name_key: string;
  affiliation: string;
  role: string;
  sector: string;
  contribution: string;
  links: string;
  statement: string;
  status: string;
  source: string;
  email: string;
  image_key: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

function rowFor(overrides: Partial<Row> = {}): Row {
  return {
    id: 'mbr_self',
    email_hash: '',
    full_name: 'Ada Lovelace',
    name_key: 'ada lovelace',
    affiliation: 'Analytical Engine',
    role: 'Analytical Engine',
    sector: 'Research',
    contribution: 'Lend your name to the statement',
    links: '',
    statement: '',
    status: 'published',
    source: 'community',
    email: 'ada@example.com',
    image_key: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    published_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

type Fake = {
  env: Env;
  rows: Row[];
  deleted: string[];
  r2Deleted: string[];
  r2Put: string[];
  events: string[];
};

/**
 * D1 stub dispatching on SQL text. Deliberately records the bound arguments so a
 * test can assert which row a query actually addressed, which is how the
 * identity-only resolution contract is proved.
 */
function fakeEnv(rows: Row[], opts: { withR2?: boolean; rateCount?: number } = {}): Fake {
  const deleted: string[] = [];
  const r2Deleted: string[] = [];
  const r2Put: string[] = [];
  const events: string[] = [];
  let rateCount = opts.rateCount ?? 1;

  const env = {
    AUTH_PEPPER: PEPPER,
    IMPORT_SALT,
    ACCESS_AUD: AUD,
    ACCESS_ISSUER: ISSUER,
    ACCESS_JWKS_URL: `${ISSUER}${JWKS_PATH}`,
    ALLOWED_ORIGINS: 'https://reversealignment.ai',
    JOIN_API_HOSTS: 'reversealignment.ai,reversealignment.tw,reversealignment.jp',
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async first<T>(): Promise<T | null> {
                if (sql.includes('FROM rate_limits')) {
                  return { count: rateCount } as unknown as T;
                }
                if (sql.includes('email_hash IN')) {
                  const hashes = args.slice(0, -1) as string[];
                  const hit = rows.find((row) => hashes.includes(row.email_hash));
                  return (hit as unknown as T) ?? null;
                }
                if (sql.includes("status = 'published'") && sql.includes('name_key = ?')) {
                  const [nameKey, excludeId] = args as [string, string];
                  const hit = rows.find(
                    (row) =>
                      row.status === 'published' && row.name_key === nameKey && row.id !== excludeId
                  );
                  return (hit ? ({ id: hit.id } as unknown as T) : null) ?? null;
                }
                if (sql.includes('WHERE image_key = ?')) {
                  const [key] = args as [string];
                  const hit = rows.find((row) => row.image_key === key);
                  return (hit ? ({ id: hit.id } as unknown as T) : null) ?? null;
                }
                if (sql.includes('FROM members WHERE id = ?')) {
                  const [id] = args as [string];
                  const hit = rows.find((row) => row.id === id);
                  return (hit as unknown as T) ?? null;
                }
                return null;
              },
              async run() {
                if (sql.includes('INSERT INTO rate_limits')) {
                  rateCount += 0;
                  return {};
                }
                if (sql.includes('INSERT INTO moderation_events')) {
                  events.push(String(args[6]));
                  return {};
                }
                if (sql.startsWith('DELETE FROM members')) {
                  const [id] = args as [string];
                  deleted.push(id);
                  const at = rows.findIndex((row) => row.id === id);
                  if (at >= 0) rows.splice(at, 1);
                  return {};
                }
                if (sql.includes('UPDATE members')) {
                  const [fullName, nameKey, affiliation, role, sector, imageKey, updatedAt, id] =
                    args as [string, string, string, string, string, string | null, string, string];
                  const hit = rows.find((row) => row.id === id);
                  if (hit) {
                    hit.full_name = fullName;
                    hit.name_key = nameKey;
                    hit.affiliation = affiliation;
                    hit.role = role;
                    hit.sector = sector;
                    hit.image_key = imageKey;
                    hit.updated_at = updatedAt;
                  }
                  return {};
                }
                return {};
              },
            };
          },
        };
      },
    },
  } as unknown as Env;

  if (opts.withR2 !== false) {
    (env as unknown as { PORTRAITS: unknown }).PORTRAITS = {
      async put(key: string) {
        r2Put.push(key);
        return {};
      },
      async delete(key: string) {
        r2Deleted.push(key);
      },
      async get() {
        return null;
      },
    };
  }

  return { env, rows, deleted, r2Deleted, r2Put, events };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let keys: { privateKey: CryptoKey; jwk: JWK & { kid: string } } | null = null;

async function accessToken(email: string): Promise<string> {
  if (!keys) {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk = (await exportJWK(publicKey)) as JWK & { kid: string };
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    jwk.kid = 'test-kid-1';
    keys = { privateKey, jwk };
  }
  const original = globalThis.fetch;
  const body = JSON.stringify({ keys: [keys.jwk] });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    if (url.includes(JWKS_PATH)) {
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return original(input);
  }) as typeof fetch;
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid-1' })
    .setIssuer(ISSUER)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey);
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

async function call(
  env: Env,
  method: string,
  token: string,
  init: RequestInit = {},
  url = ME_URL
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Cf-Access-Jwt-Assertion', token);
  headers.set('Origin', 'https://reversealignment.ai');
  return worker.fetch(new Request(url, { ...init, method, headers }), env, ctx);
}

describe('GET|PATCH|DELETE /join/api/me', () => {
  afterEach(() => {
    resetAccessJwksCacheForTests();
  });

  test('resolves the caller row only from the Access identity, never from the body', async () => {
    const token = await accessToken('ada@example.com');
    const mine = rowFor({ id: 'mbr_mine', email_hash: await hmacHex(PEPPER, 'ada@example.com') });
    const victim = rowFor({
      id: 'mbr_victim',
      email_hash: await hmacHex(PEPPER, 'grace@example.com'),
      full_name: 'Grace Hopper',
      name_key: 'grace hopper',
    });
    const fake = fakeEnv([mine, victim]);

    // A body naming someone else's id must not redirect the write.
    const res = await call(fake.env, 'PATCH', token, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'mbr_victim',
        email: 'grace@example.com',
        fullName: 'Renamed By Attacker',
        affiliation: 'Nowhere',
        sector: 'Research',
      }),
    });

    expect(res.status).toBe(200);
    expect(mine.full_name).toBe('Renamed By Attacker');
    expect(victim.full_name).toBe('Grace Hopper');

    const del = await call(fake.env, 'DELETE', token, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'mbr_victim' }),
    });
    expect(del.status).toBe(200);
    expect(fake.deleted).toEqual(['mbr_mine']);
  });

  test('GET returns the caller entry including their own stored address', async () => {
    const token = await accessToken('ada@example.com');
    const row = rowFor({
      email_hash: await hmacHex(PEPPER, 'ada@example.com'),
      image_key: PORTRAIT_A,
    });
    const res = await call(fakeEnv([row]).env, 'GET', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; member: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.member.fullName).toBe('Ada Lovelace');
    expect(body.member.email).toBe('ada@example.com');
    expect(body.member.portraitUrl).toBe(`/api/portrait/${'a'.repeat(64)}.webp`);
  });

  test('GET is 404 when the identity owns no row', async () => {
    const token = await accessToken('nobody@example.com');
    const row = rowFor({ email_hash: await hmacHex(PEPPER, 'ada@example.com') });
    const res = await call(fakeEnv([row]).env, 'GET', token);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  test('PATCH rejects an unknown sector and a too-short name', async () => {
    const token = await accessToken('ada@example.com');
    const row = rowFor({ email_hash: await hmacHex(PEPPER, 'ada@example.com') });
    const res = await call(fakeEnv([row]).env, 'PATCH', token, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'A', affiliation: '', sector: 'Nonsense' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fields: Record<string, string> };
    expect(body.error).toBe('validation_failed');
    expect(Object.keys(body.fields).sort()).toEqual(['fullName', 'sector']);
    expect(row.full_name).toBe('Ada Lovelace');
  });

  test('PATCH cannot change contribution or status, and re-derives role', async () => {
    const token = await accessToken('ada@example.com');
    const row = rowFor({
      email_hash: await hmacHex(PEPPER, 'ada@example.com'),
      status: 'updates_only',
      contribution: 'Stay informed as the coalition grows',
    });
    const fake = fakeEnv([row]);
    const res = await call(fake.env, 'PATCH', token, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Ada Lovelace',
        affiliation: 'Bletchley Park',
        sector: 'Technology',
        contribution: 'Lend your name to the statement',
        status: 'published',
      }),
    });

    expect(res.status).toBe(200);
    expect(row.contribution).toBe('Stay informed as the coalition grows');
    expect(row.status).toBe('updates_only');
    expect(row.role).toBe('Bletchley Park');
    expect(row.sector).toBe('Technology');
    expect(fake.events).toEqual(['self_service']);
  });

  test('PATCH derives role from sector when affiliation is cleared', async () => {
    const token = await accessToken('ada@example.com');
    const row = rowFor({ email_hash: await hmacHex(PEPPER, 'ada@example.com') });
    const res = await call(fakeEnv([row]).env, 'PATCH', token, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Ada Lovelace', affiliation: '', sector: 'Research' }),
    });
    expect(res.status).toBe(200);
    expect(row.role).toBe('Research');
  });

  test('PATCH renaming onto a published name_key is refused with 409', async () => {
    const token = await accessToken('ada@example.com');
    const mine = rowFor({ id: 'mbr_mine', email_hash: await hmacHex(PEPPER, 'ada@example.com') });
    const taken = rowFor({
      id: 'mbr_taken',
      email_hash: 'seed:grace',
      full_name: 'Grace Hopper',
      name_key: 'grace hopper',
      status: 'published',
    });
    const res = await call(fakeEnv([mine, taken]).env, 'PATCH', token, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Grace Hopper',
        affiliation: 'Navy',
        sector: 'Research',
      }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'name_collision' });
    expect(mine.full_name).toBe('Ada Lovelace');
  });

  test('DELETE removes the row and its unshared portrait object', async () => {
    const token = await accessToken('ada@example.com');
    const row = rowFor({
      email_hash: await hmacHex(PEPPER, 'ada@example.com'),
      image_key: PORTRAIT_A,
    });
    const fake = fakeEnv([row]);
    const res = await call(fake.env, 'DELETE', token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: true, portraitDeleted: true });
    expect(fake.deleted).toEqual(['mbr_self']);
    expect(fake.r2Deleted).toEqual([PORTRAIT_A]);
  });

  test('DELETE keeps a portrait object another member still shares', async () => {
    const token = await accessToken('ada@example.com');
    const mine = rowFor({
      id: 'mbr_mine',
      email_hash: await hmacHex(PEPPER, 'ada@example.com'),
      image_key: PORTRAIT_SHARED,
    });
    const other = rowFor({
      id: 'mbr_other',
      email_hash: 'seed:other',
      image_key: PORTRAIT_SHARED,
    });
    const fake = fakeEnv([mine, other]);
    const res = await call(fake.env, 'DELETE', token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: true, portraitDeleted: false });
    expect(fake.r2Deleted).toEqual([]);
    expect(other.image_key).toBe(PORTRAIT_SHARED);
  });

  test('DELETE never touches a canonical asset key', async () => {
    const token = await accessToken('ada@example.com');
    const row = rowFor({
      email_hash: await hmacHex(PEPPER, 'ada@example.com'),
      image_key: 'person-audrey-tang',
      source: 'canonical',
    });
    const fake = fakeEnv([row]);
    const res = await call(fake.env, 'DELETE', token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: true, portraitDeleted: false });
    expect(fake.r2Deleted).toEqual([]);
  });

  test('the join host and any unlisted host cannot reach the endpoint', async () => {
    const token = await accessToken('ada@example.com');
    const row = rowFor({ email_hash: await hmacHex(PEPPER, 'ada@example.com') });
    const res = await call(
      fakeEnv([row]).env,
      'GET',
      token,
      {},
      'https://join.reversealignment.tw/join/api/me'
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  test('POST is refused with 405 rather than falling through to the join 404', async () => {
    const token = await accessToken('ada@example.com');
    const row = rowFor({ email_hash: await hmacHex(PEPPER, 'ada@example.com') });
    const res = await call(fakeEnv([row]).env, 'POST', token, {
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'method_not_allowed' });
  });

  test('a write over the hourly limit is rate limited', async () => {
    const token = await accessToken('ada@example.com');
    const row = rowFor({ email_hash: await hmacHex(PEPPER, 'ada@example.com') });
    const res = await call(fakeEnv([row], { rateCount: 11 }).env, 'DELETE', token);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  test('an unauthenticated request never reaches the row', async () => {
    const row = rowFor({ email_hash: await hmacHex(PEPPER, 'ada@example.com') });
    const fake = fakeEnv([row]);
    const res = await worker.fetch(
      new Request(ME_URL, { method: 'DELETE', headers: { Origin: 'https://reversealignment.ai' } }),
      fake.env,
      ctx
    );
    expect(res.status).toBe(401);
    expect(fake.deleted).toEqual([]);
  });
});
