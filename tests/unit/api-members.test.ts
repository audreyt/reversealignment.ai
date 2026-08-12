import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import {
  isJoinApiResponse,
  MEMBERS_PAGE_LIMIT,
  fetchAllPublishedMembers,
  PRODUCTION_MEMBERS_API_ORIGIN,
} from '../../src/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isJoinApiResponse', () => {
  test('accepts only unredirected JSON responses', () => {
    const jsonHeaders = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });

    expect(isJoinApiResponse({ redirected: false, headers: jsonHeaders })).toBe(true);
    expect(isJoinApiResponse({ redirected: true, headers: jsonHeaders })).toBe(false);
    expect(
      isJoinApiResponse({
        redirected: false,
        headers: new Headers({ 'Content-Type': 'text/html' }),
      })
    ).toBe(false);
    expect(isJoinApiResponse({ redirected: false, headers: new Headers() })).toBe(false);
  });
});

describe('fetchAllPublishedMembers', () => {
  test('pages past the server limit and strips trailing slashes from the origin', async () => {
    const pages = [
      {
        total: 101,
        count: MEMBERS_PAGE_LIMIT,
        members: Array.from({ length: MEMBERS_PAGE_LIMIT }, (_, index) => ({ id: `a${index}` })),
      },
      {
        total: 101,
        count: 1,
        members: [{ id: 'last' }],
      },
    ];
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof Request ? input.url : input.href;
        expect(url.startsWith(`${PRODUCTION_MEMBERS_API_ORIGIN}/api/members?`)).toBe(true);
        const body = pages[calls]!;
        calls += 1;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );

    const result = await fetchAllPublishedMembers(`${PRODUCTION_MEMBERS_API_ORIGIN}/`);
    expect(result).toEqual({
      total: 101,
      count: 101,
      members: [...pages[0]!.members, ...pages[1]!.members],
    });
    expect(calls).toBe(2);
  });

  test('preserves every legal HeadersInit form and caller overrides', async () => {
    const seen: Headers[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Headers(init?.headers));
        return Response.json({ total: 0, count: 0, members: [] });
      })
    );

    const variants: HeadersInit[] = [
      new Headers({
        Accept: 'application/vnd.reversealignment+json',
        'X-Probe': 'kept',
      }),
      [
        ['Accept', 'application/vnd.reversealignment+json'],
        ['X-Probe', 'kept'],
      ],
      {
        Accept: 'application/vnd.reversealignment+json',
        'X-Probe': 'kept',
      },
    ];

    for (const headers of variants) {
      await expect(fetchAllPublishedMembers('https://example.test', { headers })).resolves.toEqual({
        total: 0,
        count: 0,
        members: [],
      });
    }

    expect(seen).toHaveLength(variants.length);
    for (const headers of seen) {
      expect(headers.get('Accept')).toBe('application/vnd.reversealignment+json');
      expect(headers.get('X-Probe')).toBe('kept');
    }
  });

  test('returns null on network, HTTP, and malformed JSON failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    expect(await fetchAllPublishedMembers('https://example.test')).toBe(null);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 }))
    );
    expect(await fetchAllPublishedMembers('https://example.test')).toBe(null);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{', { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
    );
    expect(await fetchAllPublishedMembers('https://example.test')).toBe(null);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ total: 1, members: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );
    expect(await fetchAllPublishedMembers('https://example.test')).toBe(null);
  });

  test('stops when a page is empty or shorter than the limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ total: 2, count: 2, members: [{ id: 'a' }, { id: 'b' }] }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          )
      )
    );
    await expect(fetchAllPublishedMembers('https://example.test')).resolves.toEqual({
      total: 2,
      count: 2,
      members: [{ id: 'a' }, { id: 'b' }],
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ total: 5, count: 0, members: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );
    await expect(fetchAllPublishedMembers('https://example.test')).resolves.toEqual({
      total: 0,
      count: 0,
      members: [],
    });
  });

  test('falls back to page length when total is not finite', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ total: 'nope', count: 1, members: [{ id: 'only' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );
    await expect(fetchAllPublishedMembers('https://example.test')).resolves.toEqual({
      total: 1,
      count: 1,
      members: [{ id: 'only' }],
    });
  });
});
