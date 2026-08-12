#!/usr/bin/env node
/**
 * Mint RS256 Access JWTs + a local JWKS HTTP endpoint for smoke/live harnesses.
 *
 *   node scripts/access-jwt-fixture.mjs bootstrap --dir DIR --port N --aud AUD --issuer ISS --email E
 *     → writes jwks.json, private.jwk, token.jwt, meta.json, env.sh; serves JWKS; prints JSON meta
 *   node scripts/access-jwt-fixture.mjs sign --aud AUD --issuer ISS --email E --key-file PATH
 *     → prints a JWT on stdout
 */
import { createServer } from 'node:http';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose';

const args = process.argv.slice(2);
const cmd = args[0] || 'help';

function flag(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1] || fallback;
}

async function mintPair() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  jwk.kid = 'local-test-kid';
  const priv = await exportJWK(privateKey);
  priv.alg = 'RS256';
  priv.use = 'sig';
  priv.kid = 'local-test-kid';
  return { privateKey, jwk, priv };
}

async function loadPrivate(keyFile) {
  if (process.env.JWKS_PRIVATE_JWK) {
    return importJWK(JSON.parse(process.env.JWKS_PRIVATE_JWK), 'RS256');
  }
  if (keyFile) {
    return importJWK(JSON.parse(readFileSync(keyFile, 'utf8')), 'RS256');
  }
  throw new Error('need JWKS_PRIVATE_JWK or --key-file');
}

if (cmd === 'bootstrap') {
  const dir = resolve(flag('dir', '.'));
  const port = Number(flag('port', '0'));
  const aud = flag('aud', 'local-access-aud');
  const issuer = flag('issuer', 'https://erc.cloudflareaccess.com');
  const email = flag('email', 'lifecycle-probe@example.com');
  const expSeconds = Number(flag('exp-seconds', '3600'));
  mkdirSync(dir, { recursive: true });

  const { privateKey, jwk, priv } = await mintPair();
  const jwksBody = JSON.stringify({ keys: [jwk] });
  writeFileSync(resolve(dir, 'jwks.json'), jwksBody);
  writeFileSync(resolve(dir, 'private.jwk'), JSON.stringify(priv));

  const server = createServer((req, res) => {
    if (req.url?.startsWith('/cdn-cgi/access/certs')) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(jwksBody);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((resolveListen) => {
    server.listen(port, '127.0.0.1', resolveListen);
  });
  const addr = server.address();
  const bound = typeof addr === 'object' && addr ? addr.port : port;
  const jwksUrl = `http://127.0.0.1:${bound}/cdn-cgi/access/certs`;

  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'local-test-kid' })
    .setIssuer(issuer)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(`${expSeconds}s`)
    .sign(privateKey);
  writeFileSync(resolve(dir, 'token.jwt'), token);

  const meta = { aud, issuer, jwksUrl, token, email, port: bound, dir };
  writeFileSync(resolve(dir, 'meta.json'), JSON.stringify(meta) + '\n');
  writeFileSync(
    resolve(dir, 'env.sh'),
    [
      `export ACCESS_AUD=${JSON.stringify(aud)}`,
      `export ACCESS_ISSUER=${JSON.stringify(issuer)}`,
      `export ACCESS_JWKS_URL=${JSON.stringify(jwksUrl)}`,
      `export ACCESS_TEST_JWT=${JSON.stringify(token)}`,
      `export ACCESS_TEST_EMAIL=${JSON.stringify(email)}`,
      `export ACCESS_JWKS_PORT=${bound}`,
    ].join('\n') + '\n'
  );
  process.stdout.write(JSON.stringify(meta) + '\n');

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} else if (cmd === 'sign') {
  const aud = flag('aud', 'local-access-aud');
  const issuer = flag('issuer', 'https://erc.cloudflareaccess.com');
  const email = flag('email', 'user@example.com');
  const expSeconds = Number(flag('exp-seconds', '3600'));
  const keyFile = flag('key-file', '');
  const key = await loadPrivate(keyFile);
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'local-test-kid' })
    .setIssuer(issuer)
    .setAudience(aud)
    .setIssuedAt(now)
    .setExpirationTime(now + expSeconds)
    .sign(key);
  process.stdout.write(token + '\n');
} else {
  process.stderr.write(
    'usage: access-jwt-fixture.mjs bootstrap --dir DIR --port N --aud AUD --issuer ISS --email E\n'
  );
  process.exit(2);
}
