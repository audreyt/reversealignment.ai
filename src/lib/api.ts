/**
 * Join app path constants.
 *
 * Every whole-domain locale deployment serves its own join form at `/join/`,
 * where Cloudflare Access gates `/join/*` while the brochure stays public. The
 * origin therefore comes from the locale, not from a constant — use
 * `absoluteSiteUrl(JOIN_PATH, locale)`. Brochure-only locales keep a CTA to a
 * live locale's join URL in `content.json`.
 */

/** Canonical path for the Access join app (trailing slash required). */
export const JOIN_PATH = '/join/';

/**
 * Submit path, relative to the join page itself.
 *
 * Root-absolute runtime URLs are rewritten by scripts/relativize-dist-assets.ts
 * against the build root, so a root-absolute value would break the zh-TW host's
 * `/en/join/` preview copy. A page-relative value resolves to `/join/api` on
 * every live deployment and to `/en/join/api` in that preview tree.
 */
export const JOIN_API_RELATIVE_PATH = 'api';

/** Absolute Worker route the relative path resolves to on a live deployment. */
export const JOIN_API_PATH = `${JOIN_PATH}${JOIN_API_RELATIVE_PATH}`;

/**
 * Accept only an unredirected JSON response from the join API.
 *
 * Cloudflare Access can turn an expired-session POST into a followed HTML
 * login page. Treating that page's 200 as success would erase the form even
 * though the Worker never received it.
 */
export function isJoinApiResponse(response: Pick<Response, 'headers' | 'redirected'>): boolean {
  return (
    !response.redirected &&
    (response.headers.get('content-type') || '').toLowerCase().includes('application/json')
  );
}

/** Public members API origin (CORS allowlisted for reversealignment.ai/.tw). */
export const PRODUCTION_MEMBERS_API_ORIGIN = 'https://join.reversealignment.tw';

/** Default page size for /api/members (server max is 100). */
export const MEMBERS_PAGE_LIMIT = 100;

export type MembersListResponse = {
  total: number;
  count: number;
  members: Array<Record<string, unknown>>;
};

/**
 * Fetch every published member from the Worker, paging past the 100-row cap.
 * Returns null on network/HTTP failure so callers can keep the SSR founding
 * roster sourced from content.json.
 */
export async function fetchAllPublishedMembers(
  apiOrigin: string = PRODUCTION_MEMBERS_API_ORIGIN,
  init?: RequestInit
): Promise<MembersListResponse | null> {
  const origin = apiOrigin.replace(/\/+$/, '');
  const headers = new Headers(init?.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const members: Array<Record<string, unknown>> = [];
  let total = Number.POSITIVE_INFINITY;
  let offset = 0;

  while (offset < total) {
    const url = `${origin}/api/members?limit=${MEMBERS_PAGE_LIMIT}&offset=${offset}&sort=canonical`;
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        method: 'GET',
        headers,
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;

    let body: MembersListResponse;
    try {
      body = (await response.json()) as MembersListResponse;
    } catch {
      return null;
    }
    if (!body || !Array.isArray(body.members)) return null;

    total = Number.isFinite(body.total) ? Number(body.total) : body.members.length;
    members.push(...body.members);
    if (body.members.length === 0) break;
    offset += body.members.length;
    if (body.members.length < MEMBERS_PAGE_LIMIT) break;
  }

  return { total: members.length, count: members.length, members };
}
