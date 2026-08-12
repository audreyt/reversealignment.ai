import { afterEach, describe, expect, test } from 'vite-plus/test';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { requireAccessIdentity, resetAccessJwksCacheForTests } from '../../worker/src/access';

const ISSUER = 'https://erc.cloudflareaccess.com';
const AUD = 'test-access-aud-tag';
const JWKS_PATH = '/cdn-cgi/access/certs';

async function mintKeys() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  jwk.kid = 'test-kid-1';
  return { privateKey, jwk: jwk as JWK & { kid: string } };
}

function envFor(jwksOrigin: string): Env {
  return {
    ACCESS_AUD: AUD,
    ACCESS_ISSUER: ISSUER,
    ACCESS_JWKS_URL: `${jwksOrigin}${JWKS_PATH}`,
    ALLOWED_ORIGINS: '',
  } as Env;
}

async function signToken(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  kid = 'test-kid-1'
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(ISSUER)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

describe('requireAccessIdentity', () => {
  afterEach(() => {
    resetAccessJwksCacheForTests();
  });

  test('fails closed when ACCESS_AUD is empty', async () => {
    const req = new Request('https://reversealignment.ai/join/', {
      headers: { 'Cf-Access-Jwt-Assertion': 'anything' },
    });
    const res = await requireAccessIdentity(req, {
      ACCESS_AUD: '',
      ACCESS_ISSUER: ISSUER,
      ACCESS_JWKS_URL: `${ISSUER}${JWKS_PATH}`,
    } as Env);
    expect(res).toBeInstanceOf(Response);
    if (res instanceof Response) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'access_not_configured' });
    }
  });

  test('rejects missing JWT', async () => {
    const req = new Request('https://reversealignment.ai/join/api');
    const res = await requireAccessIdentity(req, envFor(ISSUER));
    expect(res).toBeInstanceOf(Response);
    if (res instanceof Response) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'access_required' });
    }
  });

  test('accepts a valid signature with email and rejects wrong aud / expired / no email', async () => {
    const { privateKey, jwk } = await mintKeys();
    const jwksBody = JSON.stringify({ keys: [jwk] });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      if (url.includes(JWKS_PATH)) {
        return new Response(jwksBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input);
    }) as typeof fetch;

    try {
      const good = await signToken(privateKey, { email: 'Ada@Example.com' });
      const ok = await requireAccessIdentity(
        new Request('https://reversealignment.ai/join/api', {
          headers: { 'Cf-Access-Jwt-Assertion': good },
        }),
        envFor(ISSUER)
      );
      expect(ok).toEqual({ email: 'ada@example.com', emailDomain: 'example.com' });

      // Wrong audience
      const wrongAud = await new SignJWT({ email: 'ada@example.com' })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setIssuer(ISSUER)
        .setAudience('other-app')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      const badAud = await requireAccessIdentity(
        new Request('https://join.reversealignment.tw/join/', {
          headers: { 'Cf-Access-Jwt-Assertion': wrongAud },
        }),
        envFor(ISSUER)
      );
      expect(badAud).toBeInstanceOf(Response);
      if (badAud instanceof Response) {
        expect(badAud.status).toBe(401);
        expect(await badAud.json()).toEqual({ error: 'access_required' });
      }

      // Expired
      const expired = await new SignJWT({ email: 'ada@example.com' })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setIssuer(ISSUER)
        .setAudience(AUD)
        .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
        .sign(privateKey);
      const badExp = await requireAccessIdentity(
        new Request('https://join.reversealignment.tw/join/', {
          headers: { 'Cf-Access-Jwt-Assertion': expired },
        }),
        envFor(ISSUER)
      );
      expect(badExp).toBeInstanceOf(Response);
      if (badExp instanceof Response) expect(badExp.status).toBe(401);

      // Missing email claim
      const noEmail = await signToken(privateKey, { name: 'Ada' });
      const badEmail = await requireAccessIdentity(
        new Request('https://join.reversealignment.tw/join/', {
          headers: { 'Cf-Access-Jwt-Assertion': noEmail },
        }),
        envFor(ISSUER)
      );
      expect(badEmail).toBeInstanceOf(Response);
      if (badEmail instanceof Response) expect(badEmail.status).toBe(401);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('accepts any AUD in the comma-separated list and still rejects the rest', async () => {
    // A second Access app (one per hostname) mints its own AUD; pinning a single
    // value would 401 every join on whichever host was added second.
    const { privateKey, jwk } = await mintKeys();
    const jwksBody = JSON.stringify({ keys: [jwk] });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      if (url.includes(JWKS_PATH)) {
        return new Response(jwksBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input);
    }) as typeof fetch;

    const multiAudEnv = {
      ...envFor(ISSUER),
      ACCESS_AUD: ` apex-app-aud , ${AUD} `,
    } as Env;

    try {
      const secondApp = await requireAccessIdentity(
        new Request('https://reversealignment.ai/join/api', {
          headers: {
            'Cf-Access-Jwt-Assertion': await signToken(privateKey, { email: 'ada@example.com' }),
          },
        }),
        multiAudEnv
      );
      expect(secondApp).toEqual({ email: 'ada@example.com', emailDomain: 'example.com' });

      const firstApp = await new SignJWT({ email: 'ada@example.com' })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setIssuer(ISSUER)
        .setAudience('apex-app-aud')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      const okFirst = await requireAccessIdentity(
        new Request('https://reversealignment.ai/join/api', {
          headers: { 'Cf-Access-Jwt-Assertion': firstApp },
        }),
        multiAudEnv
      );
      expect(okFirst).toEqual({ email: 'ada@example.com', emailDomain: 'example.com' });

      // An AUD outside the list is still refused.
      const unlisted = await new SignJWT({ email: 'ada@example.com' })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setIssuer(ISSUER)
        .setAudience('unlisted-app')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      const refused = await requireAccessIdentity(
        new Request('https://reversealignment.ai/join/api', {
          headers: { 'Cf-Access-Jwt-Assertion': unlisted },
        }),
        multiAudEnv
      );
      expect(refused).toBeInstanceOf(Response);
      if (refused instanceof Response) expect(refused.status).toBe(401);

      // A list of only separators is as empty as an unset value.
      const blank = await requireAccessIdentity(
        new Request('https://reversealignment.ai/join/api', {
          headers: { 'Cf-Access-Jwt-Assertion': firstApp },
        }),
        { ...multiAudEnv, ACCESS_AUD: ' , ' } as Env
      );
      expect(blank).toBeInstanceOf(Response);
      if (blank instanceof Response) {
        expect(await blank.json()).toEqual({ error: 'access_not_configured' });
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
