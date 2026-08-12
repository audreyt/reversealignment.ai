const textEncoder = new TextEncoder();

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashEmail(email: string, pepper: string): Promise<string> {
  return hmacHex(pepper, email.trim().toLowerCase());
}

/**
 * Compatibility key for members imported before the join flow existed.
 *
 * Those rows live only in D1 and carry `import:` email hashes derived from the
 * secret `IMPORT_SALT` the Worker holds, so a returning member is recognized
 * without the repo ever holding an email digest.
 * Shape: `import:sha256(salt + "\n" + normalizedEmail)`.
 */
export async function hashImportedEmail(email: string, salt: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const material = `${salt.trim()}\n${normalized}`;
  return `import:${await sha256Hex(material)}`;
}

export async function hashIp(ip: string, pepper: string): Promise<string> {
  if (!ip) return '';
  return hmacHex(pepper, `ip:${ip}`);
}
