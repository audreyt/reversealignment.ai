/**
 * Augments the wrangler-generated Env with the secrets and optional bindings that
 * `wrangler types` cannot see.
 *
 * Secrets are only visible to the generator through an untracked local `.dev.vars`,
 * so a machine without that file used to regenerate `worker-configuration.d.ts`
 * without AUTH_PEPPER or ADMIN_TOKEN and broke the build. Declare them here instead:
 * this file is committed, so the type surface no longer depends on a gitignored one.
 * Every one is optional because production sets them with `wrangler secret put` and
 * the code must fail closed when they are missing, never assume they are present.
 */
interface Env {
  /** HMAC pepper for email hashes, ≥16 chars: wrangler secret put AUTH_PEPPER */
  AUTH_PEPPER?: string;
  /** Salt recognizing members imported before the join flow: wrangler secret put IMPORT_SALT */
  IMPORT_SALT?: string;
  /** Bearer token for the admin moderation API: wrangler secret put ADMIN_TOKEN */
  ADMIN_TOKEN?: string;
  /**
   * Comma-separated Access application AUD(s) gating /join/* on every deployment.
   * Empty string fails closed — every join API request returns 401.
   */
  ACCESS_AUD?: string;
  /** Issuer URL, default https://erc.cloudflareaccess.com */
  ACCESS_ISSUER?: string;
  /** JWKS URL, default https://erc.cloudflareaccess.com/cdn-cgi/access/certs */
  ACCESS_JWKS_URL?: string;
  /**
   * Comma-separated hostnames allowed to serve POST /join/api.
   * Defaults to the apex + www of every live locale deployment.
   * join.reversealignment.tw and workers.dev are always excluded.
   */
  JOIN_API_HOSTS?: string;
  AI?: {
    run: (model: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
}
