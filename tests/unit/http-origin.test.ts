import { describe, expect, test } from 'vite-plus/test';
import { isOriginAllowed } from '../../worker/src/http';

describe('isOriginAllowed', () => {
  const env = {
    ALLOWED_ORIGINS: 'https://reversealignment.tw',
  } as Env;

  test('accepts missing Origin and exact same-origin', () => {
    const req = new Request('https://reversealignment.ai/join/api', {
      method: 'POST',
    });
    expect(isOriginAllowed(req, env)).toBe(true);

    const same = new Request('https://reversealignment.ai/join/api', {
      method: 'POST',
      headers: { Origin: 'https://reversealignment.tw' },
    });
    expect(isOriginAllowed(same, env)).toBe(true);
  });

  test('rejects unknown cross-origin', () => {
    const req = new Request('https://reversealignment.ai/join/api', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });
    expect(isOriginAllowed(req, env)).toBe(false);
  });

  test('allows configured cross-origin', () => {
    const req = new Request('https://reversealignment.ai/join/api', {
      method: 'POST',
      headers: { Origin: 'https://reversealignment.tw' },
    });
    expect(isOriginAllowed(req, env)).toBe(true);
  });
});
