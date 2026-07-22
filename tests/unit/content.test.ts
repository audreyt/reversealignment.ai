import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vite-plus/test';
import {
  assertDefaultLocalePresent,
  assetPath,
  catalogShapePaths,
  collectShapePaths,
  formFieldDomId,
  getContent,
  getDefaultLocale,
  getSite,
  isLocale,
  listAlternateLocales,
  listLocales,
  localeHomePath,
  localePathPrefix,
  toBcp47,
} from '../../src/lib/i18n';
import type { Locale } from '../../src/lib/types';

const PUBLIC = resolve(import.meta.dirname, '../../public');

describe('content catalog', () => {
  test('default locale is English and listed', () => {
    expect(getDefaultLocale()).toBe('en');
    expect(listLocales()).toContain('en');
    expect(isLocale('en')).toBe(true);
    expect(isLocale('nope')).toBe(false);
  });

  test('site metadata is present', () => {
    const site = getSite();
    expect(site.name).toBe('Reverse Alignment');
    expect(site.url).toContain('reversealignment.ai');
  });

  test('brand mark segments are explicit content fields', () => {
    const copy = getContent('en');
    expect(copy.brand.mark).toBe('Reverse');
    expect(copy.brand.rest).toBe('Alignment');
  });

  test('all visible hero CTAs live in content', () => {
    const copy = getContent('en');
    expect(copy.hero.primaryCta.label.length).toBeGreaterThan(0);
    expect(copy.hero.secondaryCta.label.length).toBeGreaterThan(0);
    expect(copy.hero.primaryCta.href.length).toBeGreaterThan(0);
    expect(copy.hero.secondaryCta.href.length).toBeGreaterThan(0);
  });

  test('typo fix Fast-grants is present (not FAST-RANTS)', () => {
    const copy = getContent('en');
    expect(copy.grants.title.toLowerCase()).toContain('fast-grants');
    expect(copy.grants.title.toLowerCase()).not.toContain('fast-rants');
    const footerLabels = copy.footer.columns.flatMap((column) =>
      column.links.map((link) => link.label.toLowerCase())
    );
    expect(footerLabels.some((label) => label.includes('fast-grants'))).toBe(true);
    expect(footerLabels.some((label) => label.includes('fast-rants'))).toBe(false);
  });

  test('forms have honest mailto POST text/plain fallback', () => {
    const copy = getContent('en');
    for (const form of [copy.grants.notifyForm, copy.join.form]) {
      expect(form.action.length).toBeGreaterThan(0);
      expect(form.action).toMatch(/^mailto:/i);
      expect(form.action).not.toBe('#');
      expect(form.action).not.toBe('https://www.reversealignment.ai/');
      expect(form.action).not.toBe('/');
      expect((form.method || '').toLowerCase()).toBe('post');
      expect((form.enctype || '').toLowerCase()).toBe('text/plain');
      expect(form.mailClientNote?.toLowerCase()).toMatch(/mail client|email client/);
      expect(form.mailClientNote?.toLowerCase()).not.toMatch(
        /received|we.?ll be in touch|thanks for joining/
      );
      for (const field of form.fields) {
        expect(field.name.length).toBeGreaterThan(0);
        expect(field.name).toMatch(/[A-Za-z]/);
        expect(field.name).not.toMatch(/^[a-z]+[A-Z]/); // avoid opaque camelCase body keys
        const domId = formFieldDomId(form.id, field);
        expect(domId).toMatch(new RegExp(`^${form.id}-[a-z][a-z0-9-]*$`));
        expect(domId).not.toMatch(/\s/);
      }
    }
  });

  test('story has no unused guideBody field', () => {
    const copy = getContent('en') as { story: Record<string, unknown> };
    expect(copy.story).not.toHaveProperty('guideBody');
    expect(typeof copy.story.guideTerm).toBe('string');
    expect(typeof copy.story.guideRest).toBe('string');
  });

  test('notFound copy is localized in content', () => {
    const copy = getContent('en');
    expect(copy.notFound.heading.length).toBeGreaterThan(0);
    expect(copy.notFound.backLabel.length).toBeGreaterThan(0);
  });

  test('twelve challenges and coalition people are structured', () => {
    const copy = getContent('en');
    expect(copy.building.challenges).toHaveLength(12);
    // Live grid order: 001-003, 004/005/006 LTR, then 007-012
    expect(copy.building.challenges.map((c) => c.number)).toEqual([
      '001',
      '002',
      '003',
      '004',
      '005',
      '006',
      '007',
      '008',
      '009',
      '010',
      '011',
      '012',
    ]);
    expect(copy.building.challenges.map((c) => c.title)).toEqual([
      'Identity',
      'Privacy',
      'Provenance',
      'Data value',
      'Agentic collaboration',
      'Communal sensemaking',
      'Democracy',
      'Law and liberties',
      'Workplace',
      'Research',
      'Education',
      'Labor transition',
    ]);
    const people = copy.coalition.people.filter((t) => t.kind === 'person');
    const ctas = copy.coalition.people.filter((t) => t.kind === 'cta');
    expect(people.length).toBeGreaterThanOrEqual(20);
    expect(ctas.length).toBeGreaterThanOrEqual(1);
    const samuelIdx = copy.coalition.people.findIndex(
      (t) => t.kind === 'person' && t.name === 'Samuel Roland'
    );
    expect(samuelIdx).toBeGreaterThanOrEqual(0);
    expect(copy.coalition.people[samuelIdx + 1]).toMatchObject({
      kind: 'cta',
      href: '#join',
    });
    for (const challenge of copy.building.challenges) {
      expect(challenge.number).toMatch(/^\d{3}$/);
      expect(challenge.title.length).toBeGreaterThan(0);
      expect(challenge.body.length).toBeGreaterThan(0);
      expect(challenge.image.length).toBeGreaterThan(0);
    }
  });

  test('locale home paths: default at root, alternates prefixed', () => {
    expect(localeHomePath('en')).toBe('/');
    for (const locale of listAlternateLocales()) {
      expect(localeHomePath(locale)).toBe(`/${locale}/`);
    }
  });
});

describe('catalog parity', () => {
  test('array length is encoded so dropped list items fail parity', () => {
    const full = collectShapePaths({
      items: [
        { id: 'a', tags: ['x', 'y'] },
        { id: 'b', tags: ['x', 'y'] },
      ],
    });
    const dropped = collectShapePaths({
      items: [{ id: 'a', tags: ['x', 'y'] }],
    });
    // Length tokens differ when an item is dropped.
    expect(full).toContain('items[2]');
    expect(dropped).toContain('items[1]');
    expect(full).not.toContain('items[1]');
    expect(dropped).not.toContain('items[2]');
    expect(full).not.toEqual(dropped);
    // Second element paths exist only on the full catalog.
    expect(full).toContain('items[1].id');
    expect(dropped).not.toContain('items[1].id');
    // Nested array lengths are also encoded.
    expect(full).toContain('items[0].tags[2]');
    expect(dropped).toContain('items[0].tags[2]');
  });

  test('every locale matches default shape paths and asset keys', () => {
    const defaultLocale = getDefaultLocale();
    const baseline = catalogShapePaths(defaultLocale);
    const baselineAssets = Object.keys(getContent(defaultLocale).assets).sort();

    for (const locale of listLocales()) {
      const shape = catalogShapePaths(locale);
      expect(shape, `shape parity for ${locale}`).toEqual(baseline);

      const assets = Object.keys(getContent(locale).assets).sort();
      expect(assets, `asset key parity for ${locale}`).toEqual(baselineAssets);

      // Every asset file must exist for every locale mapping.
      for (const [key, path] of Object.entries(getContent(locale).assets)) {
        const rel = path.replace(/^\//, '');
        expect(existsSync(resolve(PUBLIC, rel)), `${locale}:${key} -> ${path}`).toBe(true);
      }
    }
  });
});

describe('i18n helpers coverage', () => {
  test('assertDefaultLocalePresent throws when default missing', () => {
    expect(() => assertDefaultLocalePresent(['fr'], 'en')).toThrow(/missing from content catalog/);
    expect(() => assertDefaultLocalePresent(['en'], 'en')).not.toThrow();
  });

  test('getContent throws for unknown locale cast', () => {
    expect(() => getContent('zz' as Locale)).toThrow(/Missing content for locale/);
  });

  test('locale path helpers handle default and alternate codes', () => {
    expect(localePathPrefix('en')).toBe('');
    expect(localeHomePath('en')).toBe('/');
    expect(localePathPrefix('zh' as Locale)).toBe('/zh');
    expect(localeHomePath('zh' as Locale)).toBe('/zh/');
    expect(toBcp47('en')).toBe('en');
  });

  test('collectShapePaths covers empty prefix leaves and empty arrays', () => {
    expect(collectShapePaths(null)).toEqual([]);
    expect(collectShapePaths('leaf')).toEqual([]);
    expect(collectShapePaths('leaf', 'x')).toEqual(['x']);
    expect(collectShapePaths([])).toEqual(['[0]']);
    expect(collectShapePaths([], 'items')).toEqual(['items[0]']);
    expect(collectShapePaths([{ a: 1 }, { a: 2 }])).toEqual(
      expect.arrayContaining(['[2]', '[0].a', '[1].a'])
    );
  });

  test('listAlternateLocales is empty while only English exists', () => {
    expect(listAlternateLocales()).toEqual([]);
    expect(listLocales()).toEqual(['en']);
  });

  test('formFieldDomId slugifies human names and keeps explicit ids', () => {
    expect(formFieldDomId('join-form', { name: 'Full Name' })).toBe('join-form-full-name');
    expect(formFieldDomId('join-form', { name: "I'd also like to contribute by..." })).toBe(
      'join-form-id-also-like-to-contribute-by'
    );
    expect(formFieldDomId('join-form', { name: 'I’d also like to contribute by...' })).toBe(
      'join-form-id-also-like-to-contribute-by'
    );
    expect(formFieldDomId('notify', { name: 'First Name', id: 'first-name' })).toBe(
      'notify-first-name'
    );
    expect(formFieldDomId('f', { name: '123 start' })).toBe('f-f-123-start');
    expect(() => formFieldDomId('f', { name: '!!!' })).toThrow(/non-empty id/);
  });
});

describe('asset mappings', () => {
  test('every mapped asset file exists under public/', () => {
    const copy = getContent('en');
    const missing: string[] = [];
    for (const [key, path] of Object.entries(copy.assets)) {
      const rel = path.replace(/^\//, '');
      if (!existsSync(resolve(PUBLIC, rel))) missing.push(`${key} -> ${path}`);
    }
    expect(missing).toEqual([]);
  });

  test('coalition portraits stay paired with the correct people', () => {
    const expectedHashes: Record<string, string> = {
      'person-glen-weyl': '9a0edeb77ce9365b7618030e0a06550e251c17adc5ecda3547e868b5d4f4e7c4',
      'person-audrey-tang': '8fc39ad9e3c85ed4fc056fcc0d1f72311c4a2397014529ca42d43a1b0bedd9d4',
      'person-jake-hirsch-allen':
        'cdbf0d910f142ecc4529f389c96839d09616a84531da2c720bc22298dc66b112',
      'person-vilas-dhar': '189b5fcfb76393fd829438523cf44cd350d9f5ff9bb393d3beec83238c7a8dcf',
      'person-melissa-valentine':
        '5fbe7cca815aa6a99f72589394777a7b8da44c3e0ea086eac413f7ff3102f9a6',
      'person-david-patterson': 'efb2324675958b035ed02de6d17baa76ee9ecc3b096ae3f06635b2c8de7728fd',
      'person-tiona-zuzul': '2c585980e6df2aed70275e2a6f6f390715ca0dcd067c623b644e702ff1e1aed6',
      'person-jess-scully': 'e16a458b4d8799bb438dabbf2b1ff9968f38411c2b9453af70bdf360ba500dfd',
      'person-dean-ball': '811bb1378c92c7065758d6ec095d369ee3e455754d755ce8d64c1dfdf5b43a2f',
      'person-romain-vakilitabar':
        'c7cdbf9ca514553786724d963ceca399d5a16fdf10293b20cb1816891d45f3ed',
      'person-andrew-sorota': '61a787ba8ca3a7976534c203c49e715ee3bd667e11087dd11481c7d5a7bef137',
      'person-samuel-roland': 'ab09360dba4f2a1e35d726a9c25f1dc1d33805422240751a757d45f7cb1d5d32',
      'person-chris-white': 'a8512f1ef1f93d0e525172609798d950cd9d5199163b45e78f19239da0482213',
      'person-tomicah-tillemann':
        'aa75b5fff44a1403dd4384ebc0cf585c9a301c819dbaf7b6a8ecb576a494e5bb',
      'person-galen-hines-pierce':
        '96883423ec4b7d4cbda00de0c98f197f5ca6a6def951188af825ad012ddc772b',
      'person-ben-buchanan': 'cf07b20d940100caeaecd90ef491c3e7bc45c1c8069503176664e1cc848b9572',
      'person-james-evans': '0f5d361812b379b1fc43b7fc8d26e91a5862a6f4b1e3e945657f90fa27614adf',
      'person-david-deming': 'ad721eacb9772d615fe6559e6234ecd337165618f943d7e1e38448b16847d4e4',
      'person-ken-suzuki': 'bde2cd76c50a71c6c7b6ccebc68b99f104c13602608338de94f4e6556bc5b83d',
      'person-blaise-aguera': 'd17c2792ec14e1b346f0527bcd47c749e7ae400527751e0b07f9935b78526c44',
      'person-danielle-allen': '23d6b5a5d4556b2acdfcfe30930500503f5f3e9fcd5fbc2ee9428c4fb622b0a2',
      'person-divya-siddarth': '8cd46ae82587ac17432a6887ee2467221e0c093164641f8098e652af21f386b0',
      'person-tim-oreilly': '43ef93b88ae0906b688c2fc819a00ebe4e23fdbc2f846f04513520465fc5c502',
      'person-zoe-weinberg': '18a84b6ecaea9c1ce7ddbcf73e716352330bd9ac7e2436a05d5bf969a0b6a3fa',
    };
    const copy = getContent('en');

    for (const person of copy.coalition.people) {
      if (person.kind !== 'person') continue;
      const expectedHash = expectedHashes[person.image];
      expect(expectedHash, `${person.name} has a verified portrait`).toBeTruthy();
      const path = copy.assets[person.image];
      const bytes = readFileSync(resolve(PUBLIC, path.replace(/^\//, '')));
      const actualHash = createHash('sha256').update(bytes).digest('hex');
      expect(actualHash, person.name).toBe(expectedHash);
    }
  });

  test('assetPath throws for unknown keys', () => {
    expect(() => assetPath('definitely-missing-key-xyz')).toThrow(/Missing asset mapping/);
  });

  test('required visual keys resolve', () => {
    const keys = [
      'hero-diagram',
      'intro-collage',
      'intro-texture',
      'history-strip',
      'failures-panel',
      'failures-texture',
      'building-bg',
      'claim-bg',
      'claim-texture',
      'papers-bg',
      'coalition-texture',
      'join-bg',
      'closing-bg',
      'icon-dot-1',
      'icon-dot-2',
      'icon-dot-3',
    ];
    for (const key of keys) {
      const path = assetPath(key);
      expect(path.startsWith('/assets/')).toBe(true);
      expect(existsSync(resolve(PUBLIC, path.replace(/^\//, '')))).toBe(true);
    }
  });
});
