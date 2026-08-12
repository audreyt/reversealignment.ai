import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { json } from './http';

export type AccessIdentity = {
  email: string;
  emailDomain: string;
};

const jwksByUrl = new Map<string, JWTVerifyGetKey>();

function remoteJwks(jwksUrl: string): JWTVerifyGetKey {
  let jwks = jwksByUrl.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    jwksByUrl.set(jwksUrl, jwks);
  }
  return jwks;
}

/**
 * Fail-closed Access gate for every /join request.
 * Always verifies Cf-Access-Jwt-Assertion against remote JWKS (aud/iss/exp + email).
 * Empty ACCESS_AUD (or issuer/JWKS URL) refuses every request.
 *
 * ACCESS_AUD is a comma-separated list so one Worker can sit behind more than one
 * Access application — a separate app per hostname mints a different AUD, and a
 * single-value check would 401 every join on the host that was added second.
 */
export async function requireAccessIdentity(
  request: Request,
  env: Env
): Promise<AccessIdentity | Response> {
  const audiences = (env.ACCESS_AUD || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const issuer = (env.ACCESS_ISSUER || '').trim();
  const jwksUrl = (env.ACCESS_JWKS_URL || '').trim();
  if (audiences.length === 0 || !issuer || !jwksUrl) {
    return json(request, env, { error: 'access_not_configured' }, { status: 401 });
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion')?.trim() || '';
  if (!token) {
    return json(request, env, { error: 'access_required' }, { status: 401 });
  }

  try {
    const { payload } = await jwtVerify(token, remoteJwks(jwksUrl), {
      issuer,
      audience: audiences,
    });
    const email = emailFromPayload(payload);
    if (!email || !email.includes('@')) {
      return json(request, env, { error: 'access_required' }, { status: 401 });
    }
    const emailDomain = email.slice(email.lastIndexOf('@') + 1);
    if (!emailDomain) {
      return json(request, env, { error: 'access_required' }, { status: 401 });
    }
    return { email, emailDomain };
  } catch {
    return json(request, env, { error: 'access_required' }, { status: 401 });
  }
}

function emailFromPayload(payload: JWTPayload): string {
  const raw = payload.email;
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFC').trim().toLowerCase();
}

/** Test helper: clear cached JWKS fetchers between unit cases. */
export function resetAccessJwksCacheForTests(): void {
  jwksByUrl.clear();
}
