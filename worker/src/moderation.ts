import type { JoinPayload } from './validate';
import { randomToken } from './crypto';

export type ModerationResult = {
  /** Human-facing recommendation only — never auto-rejects. */
  recommendation: 'allow' | 'review' | 'reject_suggested';
  decision: 'queued_review' | 'error';
  score: number;
  reasons: string[];
  model: string;
};

const BLOCKLIST =
  /\b(viagra|crypto\s*casino|onlyfans|porn|seo\s*backlink|buy\s*followers|nigerian\s*prince)\b/i;

/**
 * Fail-closed moderation recommendations for directory-capable joins:
 * - heuristic may suggest reject
 * - optional Workers AI classification
 * - any AI/tool failure → queued_review with decision=error
 * Never returns a publish action; the join handler inserts pending_review only
 * for directory intents and keeps updates-only rows out of that queue.
 */
export async function moderateSubmission(
  env: Env,
  payload: JoinPayload
): Promise<ModerationResult> {
  const blob = `${payload.fullName}\n${payload.affiliation}\n${payload.statement}\n${payload.links}\n${payload.contribution}`;
  if (BLOCKLIST.test(blob) || /(https?:\/\/){3,}/i.test(blob)) {
    return {
      recommendation: 'reject_suggested',
      decision: 'queued_review',
      score: 0.95,
      reasons: ['heuristic_blocklist'],
      model: 'heuristic',
    };
  }

  if (!env.AI) {
    return {
      recommendation: 'review',
      decision: 'queued_review',
      score: 0.5,
      reasons: ['ai_unavailable_fail_closed'],
      model: 'none',
    };
  }

  try {
    const result = await env.AI.run('@cf/meta/llama-guard-3-8b', {
      messages: [
        {
          role: 'user',
          content:
            'Classify coalition directory join text. Reply JSON only: {"safe":boolean,"score":0-1,"reasons":string[]}. Flag spam, scams, sexual content, harassment, impersonation.',
        },
        { role: 'user', content: blob.slice(0, 2000) },
      ],
      max_tokens: 200,
    });

    const text = extractText(result);
    const parsed = extractJson(text);
    if (!parsed) {
      return {
        recommendation: 'review',
        decision: 'error',
        score: 0.5,
        reasons: ['ai_parse_error'],
        model: '@cf/meta/llama-guard-3-8b',
      };
    }
    const safe = Boolean(parsed.safe);
    const score = typeof parsed.score === 'number' ? parsed.score : safe ? 0.2 : 0.8;
    const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 8) : [];
    if (!safe || score >= 0.8) {
      return {
        recommendation: 'reject_suggested',
        decision: 'queued_review',
        score,
        reasons: reasons.length ? reasons : ['ai_unsafe'],
        model: '@cf/meta/llama-guard-3-8b',
      };
    }
    return {
      recommendation: 'allow',
      decision: 'queued_review',
      score,
      reasons: reasons.length ? reasons : ['ai_ok_queued'],
      model: '@cf/meta/llama-guard-3-8b',
    };
  } catch {
    return {
      recommendation: 'review',
      decision: 'error',
      score: 0.5,
      reasons: ['ai_error_fail_closed'],
      model: '@cf/meta/llama-guard-3-8b',
    };
  }
}

export async function recordModeration(
  env: Env,
  opts: {
    memberId?: string | null;
    challengeId?: string | null;
    result: ModerationResult;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO moderation_events (id, member_id, challenge_id, decision, score, reasons_json, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      `mod_${randomToken(12)}`,
      opts.memberId ?? null,
      opts.challengeId ?? null,
      `${opts.result.decision}:${opts.result.recommendation}`,
      opts.result.score,
      JSON.stringify(opts.result.reasons),
      opts.result.model,
      now
    )
    .run();
}

function extractText(result: Record<string, unknown>): string {
  if (typeof result.response === 'string') return result.response;
  if (typeof result.result === 'string') return result.result;
  if (Array.isArray(result.reasons)) return JSON.stringify(result);
  return JSON.stringify(result);
}

function extractJson(text: string): { safe?: boolean; score?: number; reasons?: unknown } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as {
      safe?: boolean;
      score?: number;
      reasons?: unknown;
    };
  } catch {
    return null;
  }
}
