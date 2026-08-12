import { describe, expect, test } from 'vite-plus/test';
import { normalizeNameKey } from '../../worker/src/names';

describe('normalizeNameKey', () => {
  test('collapses case and whitespace', () => {
    expect(normalizeNameKey('  Ada   Lovelace ')).toBe('ada lovelace');
    expect(normalizeNameKey('ADA LOVELACE')).toBe('ada lovelace');
  });
});
