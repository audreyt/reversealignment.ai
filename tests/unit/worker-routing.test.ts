import { describe, expect, test } from 'vite-plus/test';
import worker from '../../worker/src/index';

/**
 * Host + path routing for the Access-gated join API.
 *
 * `wrangler dev` builds `request.url` from the bound address, so neither a
 * spoofed `Host:` header nor connecting through `localhost` can exercise the
 * JOIN_API_HOSTS gate over HTTP. Drive the real fetch handler instead: every
 * case below returns before any binding is touched, so no D1/R2 stub is needed.
 */
const env = {
  ACCESS_AUD: 'test-aud',
  ACCESS_ISSUER: 'https://erc.cloudflareaccess.com',
  ACCESS_JWKS_URL: 'https://erc.cloudflareaccess.com/cdn-cgi/access/certs',
  ALLOWED_ORIGINS: 'https://reversealignment.ai',
} as unknown as Env;

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

const post = (url: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(url, { method: 'POST', headers }), env, ctx);

const send = (url: string, method = 'GET') => worker.fetch(new Request(url, { method }), env, ctx);

/**
 * www is not a second home for the site: it redirects to the apex before any
 * API or preflight logic runs, so the three apex /join/ destinations are the
 * only ones Cloudflare Access has to cover.
 */
describe('www redirects to apex', () => {
  test.each([
    ['English', 'www.reversealignment.ai', 'reversealignment.ai'],
    ['zh-TW', 'www.reversealignment.tw', 'reversealignment.tw'],
    ['Japanese', 'www.reversealignment.jp', 'reversealignment.jp'],
  ])('%s www lands on its own apex, never another locale', async (_label, www, apex) => {
    const res = await send(`https://${www}/join/`);
    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe(`https://${apex}/join/`);
  });

  test('moves the whole URL: scheme, path and query all survive the hop', async () => {
    const res = await send('https://www.reversealignment.tw/join/?ref=talk&utm_source=a+b');
    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe(
      'https://reversealignment.tw/join/?ref=talk&utm_source=a+b'
    );
  });

  test('covers the whole zone, not only the join path', async () => {
    const res = await send('https://www.reversealignment.jp/');
    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe('https://reversealignment.jp/');
  });

  test.each(['GET', 'HEAD', 'POST', 'OPTIONS', 'PUT'])(
    'redirects %s, and 308 keeps the method intact',
    async (method) => {
      // 301/302 would let a browser replay a join submit as GET and drop the
      // body; only 308 carries the POST through. OPTIONS proves the redirect
      // runs ahead of the preflight branch, which used to answer 204 here.
      const res = await send('https://www.reversealignment.ai/join/api', method);
      expect(res.status).toBe(308);
      expect(res.headers.get('Location')).toBe('https://reversealignment.ai/join/api');
    }
  );

  test('a stale www POST is redirected, not host-gated and not challenged', async () => {
    const res = await post('https://www.reversealignment.ai/join/api', {
      Origin: 'https://www.reversealignment.ai',
      'Cf-Access-Jwt-Assertion': 'not.a.jwt',
    });
    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe('https://reversealignment.ai/join/api');
  });

  test.each([
    ['the apex itself', 'https://reversealignment.ai/join/'],
    ['a lookalike suffix host', 'https://www.reversealignment.ai.evil.example/join/'],
    ['the API custom domain', 'https://join.reversealignment.tw/join/'],
  ])('leaves %s alone — only the three exact www hosts move', async (_label, url) => {
    const res = await send(url);
    expect(res.status).toBe(404);
    expect(res.headers.get('Location')).toBeNull();
  });
});

describe('join API host gate', () => {
  test.each([
    ['English', 'https://reversealignment.ai/join/api'],
    ['zh-TW', 'https://reversealignment.tw/join/api'],
    ['Japanese', 'https://reversealignment.jp/join/api'],
  ])('serves the join POST on the %s apex', async (_label, url) => {
    // No JWT, so the furthest an allowed host can get is the Access challenge —
    // which is exactly what distinguishes "routed here" from "wrong host".
    const res = await post(url);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'access_required' });
  });

  test.each([
    ['API custom domain', 'https://join.reversealignment.tw/join/api'],
    ['workers.dev', 'https://reversealignment-api.audreyt.workers.dev/join/api'],
    ['Pages alias', 'https://reversealignment-ai.pages.dev/join/api'],
  ])('refuses the join POST on %s', async (_label, url) => {
    const res = await post(url);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  test('a wrong host is refused before the Access check, never after', async () => {
    // Ordering matters: a 401 here would leak that the path exists on that host.
    const res = await post('https://join.reversealignment.tw/join/api', {
      'Cf-Access-Jwt-Assertion': 'not.a.jwt',
    });
    expect(res.status).toBe(404);
  });

  test('falls back to every live locale host when JOIN_API_HOSTS is unset', async () => {
    const bare = { ...env, JOIN_API_HOSTS: '' } as unknown as Env;
    for (const host of ['reversealignment.ai', 'reversealignment.tw', 'reversealignment.jp']) {
      const allowed = await worker.fetch(
        new Request(`https://${host}/join/api`, { method: 'POST' }),
        bare,
        ctx
      );
      expect(allowed.status, host).toBe(401);
    }

    const refused = await worker.fetch(
      new Request('https://join.reversealignment.tw/join/api', { method: 'POST' }),
      bare,
      ctx
    );
    expect(refused.status).toBe(404);
  });

  test('an explicit allowlist narrows the default set', async () => {
    // A configured list replaces the defaults outright, so a live production host
    // that is left out must stop accepting joins.
    const narrowed = { ...env, JOIN_API_HOSTS: 'reversealignment.ai' } as unknown as Env;
    const kept = await worker.fetch(
      new Request('https://reversealignment.ai/join/api', { method: 'POST' }),
      narrowed,
      ctx
    );
    expect(kept.status).toBe(401);

    const dropped = await worker.fetch(
      new Request('https://reversealignment.jp/join/api', { method: 'POST' }),
      narrowed,
      ctx
    );
    expect(dropped.status).toBe(404);
  });

  test('honours a configured multi-host allowlist', async () => {
    const local = { ...env, JOIN_API_HOSTS: 'reversealignment.ai, 127.0.0.1 ' } as unknown as Env;
    const res = await worker.fetch(
      new Request('http://127.0.0.1:8787/join/api', { method: 'POST' }),
      local,
      ctx
    );
    expect(res.status).toBe(401);
  });
});

describe('retired join routes', () => {
  test.each([
    'https://reversealignment.ai/en/join/api',
    'https://reversealignment.ai/api/join',
    'https://reversealignment.tw/api/join/verify',
    'https://reversealignment.tw/api/join/portrait',
    'https://join.reversealignment.tw/api/join',
  ])('%s is gone, not merely unauthenticated', async (url) => {
    const res = await post(url, { 'Cf-Access-Jwt-Assertion': 'not.a.jwt' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('join API method + origin', () => {
  test('rejects a non-POST method on the allowed host', async () => {
    const res = await worker.fetch(new Request('https://reversealignment.ai/join/api'), env, ctx);
    expect(res.status).toBe(405);
  });

  test('rejects a cross-origin submit before the Access check', async () => {
    const res = await post('https://reversealignment.ai/join/api', {
      Origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'origin_not_allowed' });
  });

  test('answers preflight for the join path', async () => {
    const res = await worker.fetch(
      new Request('https://reversealignment.ai/join/api', {
        method: 'OPTIONS',
        headers: { Origin: 'https://reversealignment.ai' },
      }),
      env,
      ctx
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://reversealignment.ai');
  });
});
