import { describe, expect, test } from 'vite-plus/test';
import { adminTokenAccepted } from '../../worker/src/admin-auth';

describe('adminTokenAccepted', () => {
  test('accepts exact token and rejects missing/wrong without raw compare short-circuit API', async () => {
    const token = 'test-admin-token-value-32chars!!';
    await expect(adminTokenAccepted(token, token)).resolves.toBe(true);
    await expect(adminTokenAccepted(token, '')).resolves.toBe(false);
    await expect(adminTokenAccepted(token, 'nope')).resolves.toBe(false);
    await expect(adminTokenAccepted(token, token + 'x')).resolves.toBe(false);
    await expect(adminTokenAccepted('', token)).resolves.toBe(false);
  });
});
