import { describe, expect, test } from 'vite-plus/test';
import { avatarDataUri, avatarFromName, monogramInitials } from '../../src/lib/avatar';

describe('monogram avatars', () => {
  test('initials prefer first and last name', () => {
    expect(monogramInitials('Ada Lovelace')).toBe('AL');
    expect(monogramInitials('Eric Glen Weyl')).toBe('EW');
    expect(monogramInitials('Madonna')).toBe('MA');
    expect(monogramInitials('   ')).toBe('?');
    expect(avatarFromName('').initials).toBe('?');
    expect(monogramInitials('林')).toBe('林');
  });

  test('same name yields stable palette and data URI', () => {
    const a = avatarFromName('Ada Lovelace');
    const b = avatarFromName('Ada Lovelace');
    expect(a).toEqual(b);
    const uri = avatarDataUri('Ada Lovelace');
    expect(uri.startsWith('data:image/svg+xml')).toBe(true);
    expect(uri).toContain('AL');
    expect(uri).not.toContain('<script');
    // single-letter path uses larger font-size branch
    const single = avatarDataUri('X');
    expect(decodeURIComponent(single)).toContain('font-size="110"');
  });

  test('different names diverge without using email', () => {
    const a = avatarFromName('Ada Lovelace');
    const b = avatarFromName('Grace Hopper');
    expect(a.initials).not.toBe(b.initials);
    expect(avatarDataUri('user@example.com')).not.toContain('@');
    // Multi-token names keep special first/last characters for escapeXml.
    const scary = decodeURIComponent(avatarDataUri('& <'));
    expect(scary).toContain('&amp;');
    expect(scary).toContain('&lt;');
    const quotes = decodeURIComponent(avatarDataUri('" \''));
    expect(quotes).toContain('&quot;');
    expect(quotes).toContain('&apos;');
  });
});
