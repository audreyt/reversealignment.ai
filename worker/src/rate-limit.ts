/** Fixed-window counter in D1. Returns false when the subject is over the limit. */
export async function takeToken(
  env: Env,
  bucket: string,
  subjectHash: string,
  limit: number,
  windowSeconds: number
): Promise<{ ok: true; remaining: number } | { ok: false; retryAfter: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);

  await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, subject_hash, window_start, count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(bucket, subject_hash, window_start)
     DO UPDATE SET count = count + 1`
  )
    .bind(bucket, subjectHash, windowStart)
    .run();

  const row = await env.DB.prepare(
    `SELECT count FROM rate_limits WHERE bucket = ? AND subject_hash = ? AND window_start = ?`
  )
    .bind(bucket, subjectHash, windowStart)
    .first<{ count: number }>();

  const count = row?.count ?? 1;
  if (count > limit) {
    return { ok: false, retryAfter: windowStart + windowSeconds - now };
  }
  return { ok: true, remaining: Math.max(0, limit - count) };
}
