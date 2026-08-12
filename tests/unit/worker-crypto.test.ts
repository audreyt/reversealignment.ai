import { describe, expect, test } from 'vite-plus/test';
import {
  hashEmail,
  hashImportedEmail,
  hmacHex,
  randomToken,
  sha256Hex,
  timingSafeEqualHex,
} from '../../worker/src/crypto';

describe('worker crypto', () => {
  test('sha256 and hmac are deterministic', async () => {
    await expect(sha256Hex('abc')).resolves.toBe(await sha256Hex('abc'));
    await expect(hmacHex('pepper', 'msg')).resolves.toBe(await hmacHex('pepper', 'msg'));
    await expect(hashEmail('Ada@Example.com', 'pepper')).resolves.toBe(
      await hashEmail('ada@example.com', 'pepper')
    );
  });

  test('import email hashes stay pepper-free and require a salt', async () => {
    const salt = 'import-salt-for-unit-tests';
    const digest = await sha256Hex(`${salt}\nada@example.com`);
    await expect(hashImportedEmail('Ada@Example.com', salt)).resolves.toBe(`import:${digest}`);
    await expect(hashImportedEmail('ada@example.com', salt)).resolves.toBe(`import:${digest}`);
    await expect(hashImportedEmail('Ada@Example.com', salt)).resolves.not.toBe(
      await hashEmail('Ada@Example.com', 'pepper')
    );
    await expect(hashImportedEmail('Ada@Example.com', salt)).resolves.not.toBe(
      await hashImportedEmail('Ada@Example.com', `${salt}-other`)
    );
  });

  test('timingSafeEqualHex rejects length mismatch and differing values', () => {
    expect(timingSafeEqualHex('aa', 'aa')).toBe(true);
    expect(timingSafeEqualHex('aa', 'ab')).toBe(false);
    expect(timingSafeEqualHex('aa', 'a')).toBe(false);
  });

  test('tokens have expected shape', () => {
    expect(randomToken(8)).toMatch(/^[0-9a-f]{16}$/);
  });
});
