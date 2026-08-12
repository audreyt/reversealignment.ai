import { describe, expect, test } from 'vite-plus/test';
import {
  CONTRIBUTIONS,
  classifyJoinIntent,
  normalizeContribution,
  parseJoinBody,
  SECTORS,
} from '../../worker/src/validate';
import { DIRECTORY_CONTRIBUTIONS } from '../../src/lib/join-intent';

describe('parseJoinBody', () => {
  test('accepts a well-formed payload without body email', () => {
    const result = parseJoinBody({
      fullName: 'Ada Lovelace',
      affiliation: 'Analytical Engine',
      sector: 'Research',
      contribution: 'Contribute expertise, writing, or research',
      links: 'https://example.com',
      statement: 'Hello',
      website: '',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.email).toBe('');
      expect(result.data.sector).toBe('Research');
      expect(result.data.fullName).toBe('Ada Lovelace');
      expect(result.data.contribution).toBe('Contribute expertise, writing, or research');
    }
  });

  test('rejects short name, bad sector and non-https links', () => {
    const result = parseJoinBody({
      fullName: 'A',
      sector: 'Nope',
      links: 'http://insecure.example',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.fullName).toBeTruthy();
      expect(result.errors.sector).toBeTruthy();
      expect(result.errors.links).toBeTruthy();
      expect(result.errors.email).toBeUndefined();
    }
  });

  test('ignores body email — Access supplies identity', () => {
    const result = parseJoinBody({
      fullName: 'Ada Lovelace',
      sector: 'Research',
      email: 'spoofed@evil.example',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.email).toBe('');
  });

  test('normalizes localized contribution labels onto English keys', () => {
    const result = parseJoinBody({
      fullName: 'Ada Lovelace',
      sector: 'Research',
      contribution: '隨時掌握聯盟動態',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.contribution).toBe('Stay informed as the coalition grows');
    }
  });

  test('sector catalog is stable', () => {
    expect(SECTORS).toContain('Civil Society');
    expect(SECTORS).toHaveLength(8);
  });
});

describe('join contribution intent', () => {
  test('keeps the English contribution catalog stable', () => {
    expect(CONTRIBUTIONS).toEqual([
      'Lend your name to the statement',
      'Bring a challenge into your own organization or sector',
      'Contribute expertise, writing, or research',
      'Help fund the work',
      'Stay informed as the coalition grows',
      'All of the above',
    ]);
    expect(DIRECTORY_CONTRIBUTIONS).toEqual([
      'Lend your name to the statement',
      'All of the above',
    ]);
  });

  test('classifies only endorsement choices as directory intent', () => {
    expect(classifyJoinIntent('Lend your name to the statement')).toBe('directory');
    expect(classifyJoinIntent('All of the above')).toBe('directory');
    expect(classifyJoinIntent('以上皆是')).toBe('directory');
    expect(classifyJoinIntent('Stay informed as the coalition grows')).toBe('updates');
    expect(classifyJoinIntent('隨時掌握聯盟動態')).toBe('updates');
    expect(classifyJoinIntent('Contribute expertise, writing, or research')).toBe('updates');
    expect(classifyJoinIntent('')).toBe('updates');
    expect(classifyJoinIntent('something unknown')).toBe('updates');
  });

  test('normalizes known aliases and leaves unknowns intact', () => {
    expect(normalizeContribution('  声明に名前を連ねる  ')).toBe('Lend your name to the statement');
    expect(normalizeContribution('All of the above')).toBe('All of the above');
    expect(normalizeContribution('custom free text')).toBe('custom free text');
  });
});
