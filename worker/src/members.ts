import { isPortraitKey } from './portrait';
import { isSector } from './validate';

export type PublicMember = {
  id: string;
  fullName: string;
  role: string;
  affiliation: string;
  sector: string;
  source: 'canonical' | 'community';
  imageKey: string | null;
  avatar: 'photo' | 'monogram';
  portraitUrl: string | null;
  sortIndex: number;
  publishedAt: string | null;
};

type MemberRow = {
  id: string;
  full_name: string;
  role: string;
  affiliation: string;
  sector: string;
  source: 'canonical' | 'community';
  image_key: string | null;
  sort_index: number;
  published_at: string | null;
};

export type ListQuery = {
  q: string;
  sector: string;
  source: string;
  sort: string;
  limit: number;
  offset: number;
};

function finiteInt(value: string | null, fallback: number, min: number, max: number): number {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function parseListQuery(url: URL): ListQuery {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
  const sector = (url.searchParams.get('sector') || '').trim();
  const source = (url.searchParams.get('source') || '').trim();
  const sort = (url.searchParams.get('sort') || 'canonical').trim();
  const limit = finiteInt(url.searchParams.get('limit'), 60, 1, 100);
  const offset = finiteInt(url.searchParams.get('offset'), 0, 0, 100_000);
  return { q, sector, source, sort, limit, offset };
}

function orderClause(sort: string): string {
  switch (sort) {
    case 'name':
      return 'full_name COLLATE NOCASE ASC, sort_index ASC';
    case 'name-desc':
      return 'full_name COLLATE NOCASE DESC, sort_index ASC';
    case 'sector':
      return 'sector ASC, full_name COLLATE NOCASE ASC';
    case 'recent':
      return 'COALESCE(published_at, created_at) DESC, sort_index ASC';
    case 'canonical':
    default:
      return "CASE source WHEN 'canonical' THEN 0 ELSE 1 END ASC, sort_index ASC, full_name COLLATE NOCASE ASC";
  }
}

export async function listPublishedMembers(
  env: Env,
  query: ListQuery
): Promise<{ total: number; members: PublicMember[] }> {
  const where: string[] = [`status = 'published'`];
  const binds: unknown[] = [];

  if (query.q) {
    where.push(
      `(full_name LIKE ? ESCAPE '\\' OR role LIKE ? ESCAPE '\\' OR affiliation LIKE ? ESCAPE '\\')`
    );
    const like = `%${escapeLike(query.q)}%`;
    binds.push(like, like, like);
  }
  if (query.sector && isSector(query.sector)) {
    where.push(`sector = ?`);
    binds.push(query.sector);
  }
  if (query.source === 'canonical' || query.source === 'community') {
    where.push(`source = ?`);
    binds.push(query.source);
  }

  const whereSql = where.join(' AND ');
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM members WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ c: number }>();

  const rows = await env.DB.prepare(
    `SELECT id, full_name, role, affiliation, sector, source, image_key, sort_index, published_at
     FROM members
     WHERE ${whereSql}
     ORDER BY ${orderClause(query.sort)}
     LIMIT ? OFFSET ?`
  )
    .bind(...binds, query.limit, query.offset)
    .all<MemberRow>();

  return { total: totalRow?.c ?? 0, members: (rows.results || []).map(toPublic) };
}

function toPublic(row: MemberRow): PublicMember {
  const source = row.source === 'community' ? 'community' : 'canonical';
  const imageKey = row.image_key || null;
  const portraitUrl =
    imageKey && isPortraitKey(imageKey)
      ? `/api/portrait/${imageKey.slice('portraits/'.length)}`
      : null;
  return {
    id: row.id,
    fullName: row.full_name,
    role: row.role,
    affiliation: row.affiliation,
    sector: row.sector,
    source,
    // Expose whenever set — publication is already gated by human moderation.
    imageKey,
    avatar: imageKey ? 'photo' : 'monogram',
    portraitUrl,
    sortIndex: row.sort_index,
    publishedAt: row.published_at,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function findMemberByEmailHashes(
  env: Env,
  primaryHash: string,
  importedHash?: string
): Promise<{ id: string; status: string; full_name: string } | null> {
  const hashes = [primaryHash];
  if (importedHash && importedHash !== primaryHash) hashes.push(importedHash);
  // Prefer the production HMAC row when both somehow exist.
  const placeholders = hashes.map(() => '?').join(', ');
  return env.DB.prepare(
    `SELECT id, status, full_name, email_hash
     FROM members
     WHERE email_hash IN (${placeholders})
     ORDER BY CASE email_hash WHEN ? THEN 0 ELSE 1 END
     LIMIT 1`
  )
    .bind(...hashes, primaryHash)
    .first<{ id: string; status: string; full_name: string }>();
}

/**
 * Persist an Access-verified address without ever replacing an address already
 * recorded for the member. This self-heals privacy-preserving imported rows when
 * their owner next authenticates through the join flow.
 */
export async function storeVerifiedMemberEmail(
  env: Env,
  memberId: string,
  email: string
): Promise<void> {
  const normalized = email.normalize('NFC').trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1) {
    throw new Error('Invalid Access-verified email');
  }
  await env.DB.prepare(
    `UPDATE members
     SET email = ?, email_domain = ?, updated_at = ?
     WHERE id = ? AND email = ''`
  )
    .bind(normalized, normalized.slice(at + 1), new Date().toISOString(), memberId)
    .run();
}
