import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vite-plus/test';
import {
  assertDefaultLocalePresent,
  assetPath,
  catalogInvariants,
  catalogShapePaths,
  collectInvariantPaths,
  collectShapePaths,
  getContent,
  getDefaultLocale,
  getSite,
  hreflangAlternates,
  isLocale,
  listLocales,
  relativeRootPath,
  toBcp47,
  toOgLocale,
} from '../../src/lib/i18n';
import type { Locale } from '../../src/lib/types';

const PUBLIC = resolve(import.meta.dirname, '../../public');

describe('content catalog', () => {
  test('default locale is Traditional Chinese; en remains for parity only', () => {
    expect(getDefaultLocale()).toBe('zh-tw');
    expect(listLocales()).toEqual(expect.arrayContaining(['zh-tw', 'en']));
    expect(isLocale('zh-tw')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('nope')).toBe(false);
  });

  test('site metadata points at reversealignment.tw with English cross-domain URL', () => {
    const site = getSite() as {
      name: string;
      url: string;
      lang: string;
      englishSiteUrl: string;
    };
    expect(site.name).toBe('Reverse Alignment');
    expect(site.url).toBe('https://reversealignment.tw');
    expect(site.lang).toBe('zh-TW');
    expect(site.englishSiteUrl).toBe('https://www.reversealignment.ai');
  });

  test('brand mark segments are explicit content fields', () => {
    const copy = getContent('en');
    expect(copy.brand.mark).toBe('Reverse');
    expect(copy.brand.rest).toBe('Alignment');
    const zh = getContent('zh-tw');
    expect(zh.brand.mark).toBe('Reverse');
    expect(zh.brand.rest).toBe('Alignment');
  });

  test('all visible hero CTAs live in content', () => {
    for (const locale of listLocales()) {
      const copy = getContent(locale);
      expect(copy.hero.primaryCta.label.length).toBeGreaterThan(0);
      expect(copy.hero.secondaryCta.label.length).toBeGreaterThan(0);
      expect(copy.hero.primaryCta.href.length).toBeGreaterThan(0);
      expect(copy.hero.secondaryCta.href.length).toBeGreaterThan(0);
    }
  });

  test('typo fix Fast-grants is present in English (not FAST-RANTS)', () => {
    const copy = getContent('en');
    expect(copy.grants.title.toLowerCase()).toContain('fast-grants');
    expect(copy.grants.title.toLowerCase()).not.toContain('fast-rants');
    const footerLabels = copy.footer.columns.flatMap((column) =>
      column.links.map((link) => link.label.toLowerCase())
    );
    expect(footerLabels.some((label) => label.includes('fast-grants'))).toBe(true);
    expect(footerLabels.some((label) => label.includes('fast-rants'))).toBe(false);
  });

  test('signup routes upstream: join CTA links to the coalition home, no local forms', () => {
    for (const locale of listLocales()) {
      const copy = getContent(locale);
      expect(copy.join.cta.href).toBe('https://www.reversealignment.ai/');
      expect(copy.join.cta.external).toBe(true);
      expect(copy.join.cta.label.length).toBeGreaterThan(0);
      expect('form' in copy.join).toBe(false);
      expect('notifyForm' in copy.grants).toBe(false);
      const raw = JSON.stringify(copy);
      expect(raw).not.toContain('mailto:hello@reversealignment.ai?');
    }
    expect(getContent('zh-tw').join.cta.label).toContain('（英文）');
  });

  test('story has no unused guideBody field', () => {
    for (const locale of listLocales()) {
      const copy = getContent(locale) as { story: Record<string, unknown> };
      expect(copy.story).not.toHaveProperty('guideBody');
      expect(typeof copy.story.guideTerm).toBe('string');
      expect(typeof copy.story.guideRest).toBe('string');
    }
  });

  test('notFound copy is localized in content', () => {
    for (const locale of listLocales()) {
      const copy = getContent(locale);
      expect(copy.notFound.heading.length).toBeGreaterThan(0);
      expect(copy.notFound.backLabel.length).toBeGreaterThan(0);
    }
  });

  test('twelve challenges and coalition people are structured', () => {
    const copy = getContent('en');
    expect(copy.building.challenges).toHaveLength(12);
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
    expect(copy.coalition.people).toHaveLength(24);
    const samuelIdx = copy.coalition.people.findIndex((person) => person.name === 'Samuel Roland');
    expect(samuelIdx).toBeGreaterThanOrEqual(0);
    expect(copy.coalition.people[samuelIdx + 1]?.name).toBe('Chris White');
    for (const challenge of copy.building.challenges) {
      expect(challenge.number).toMatch(/^\d{3}$/);
      expect(challenge.title.length).toBeGreaterThan(0);
      expect(challenge.body.length).toBeGreaterThan(0);
      expect(challenge.image.length).toBeGreaterThan(0);
    }

    const zh = getContent('zh-tw');
    expect(zh.building.challenges).toHaveLength(12);
    expect(zh.building.challenges.map((c) => c.number)).toEqual(
      copy.building.challenges.map((c) => c.number)
    );
    expect(zh.coalition.people).toHaveLength(24);
    expect(zh.coalition.people.map((p) => p.name)).toEqual(
      copy.coalition.people.map((p) => p.name)
    );
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
    expect(full).toContain('items[2]');
    expect(dropped).toContain('items[1]');
    expect(full).not.toContain('items[1]');
    expect(dropped).not.toContain('items[2]');
    expect(full).not.toEqual(dropped);
    expect(full).toContain('items[1].id');
    expect(dropped).not.toContain('items[1].id');
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

      for (const [key, path] of Object.entries(getContent(locale).assets)) {
        const rel = path.replace(/^\//, '');
        expect(existsSync(resolve(PUBLIC, rel)), `${locale}:${key} -> ${path}`).toBe(true);
      }
    }
  });

  test('locale-specific og-image mapping stays on distinct existing files', () => {
    const en = getContent('en');
    const zh = getContent('zh-tw');
    expect(en.meta.ogImage).toBe('/assets/images/og-image.jpg');
    expect(en.assets['og-image']).toBe('/assets/images/og-image.jpg');
    expect(zh.meta.ogImage).toBe('/assets/images/og-image-zh-tw.jpg');
    expect(zh.assets['og-image']).toBe('/assets/images/og-image-zh-tw.jpg');
    expect(Object.keys(zh.assets).sort()).toEqual(Object.keys(en.assets).sort());
    for (const locale of listLocales()) {
      const copy = getContent(locale);
      const rel = copy.assets['og-image'].replace(/^\//, '');
      expect(existsSync(resolve(PUBLIC, rel)), `${locale} og-image file`).toBe(true);
      const metaRel = copy.meta.ogImage.replace(/^\//, '');
      expect(existsSync(resolve(PUBLIC, metaRel)), `${locale} meta.ogImage file`).toBe(true);
      expect(copy.meta.ogImage).toBe(copy.assets['og-image']);
    }
  });

  test('non-translatable structural values match across locales', () => {
    const baseline = catalogInvariants(getDefaultLocale());
    expect(Object.keys(baseline).length).toBeGreaterThan(50);
    for (const locale of listLocales()) {
      expect(catalogInvariants(locale), `invariants for ${locale}`).toEqual(baseline);
    }
    expect(baseline['join.cta.href']).toBe('https://www.reversealignment.ai/');
    expect(baseline['join.cta.external']).toBe(true);
    expect(baseline['nav.join.href']).toBe('#join');
    expect(baseline['hero.primaryCta.href']).toBe('#join');
  });
});

describe('i18n helpers coverage', () => {
  test('assertDefaultLocalePresent throws when default missing', () => {
    expect(() => assertDefaultLocalePresent(['fr'], 'zh-tw')).toThrow(
      /missing from content catalog/
    );
    expect(() => assertDefaultLocalePresent(['zh-tw'], 'zh-tw')).not.toThrow();
  });

  test('getContent throws for unknown locale cast', () => {
    expect(() => getContent('zz' as Locale)).toThrow(/Missing content for locale/);
  });

  test('served site is root-only with cross-domain hreflang', () => {
    expect(relativeRootPath('zh-tw')).toBe('./');
    expect(relativeRootPath('en')).toBe('./');
    expect(toBcp47('en')).toBe('en');
    expect(toBcp47('zh-tw')).toBe('zh-TW');
    expect(toOgLocale('zh-tw')).toBe('zh_TW');
    expect(toOgLocale('en')).toBe('en');
    expect(hreflangAlternates()).toEqual([
      { hreflang: 'zh-TW', href: 'https://reversealignment.tw/' },
      { hreflang: 'en', href: 'https://www.reversealignment.ai/' },
      { hreflang: 'x-default', href: 'https://reversealignment.tw/' },
    ]);
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

  test('collectInvariantPaths covers empty and array roots', () => {
    expect(collectInvariantPaths(null)).toEqual({});
    expect(collectInvariantPaths('leaf')).toEqual({});
    expect(collectInvariantPaths([{ id: 'a' }, { href: '#x' }])).toEqual({
      '[0].id': 'a',
      '[1].href': '#x',
    });
  });

  test('catalog retains en for parity while only zh-tw is default', () => {
    expect(listLocales().sort()).toEqual(['en', 'zh-tw'].sort());
    expect(getDefaultLocale()).toBe('zh-tw');
  });
});

describe('asset mappings', () => {
  test('every mapped asset file exists under public/', () => {
    const copy = getContent(getDefaultLocale());
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
      expect(path.startsWith('./assets/')).toBe(true);
      expect(existsSync(resolve(PUBLIC, path.replace(/^\.\//, '')))).toBe(true);
    }
  });

  test('local presentation documents include every declared slide', () => {
    const copy = getContent(getDefaultLocale());
    for (const resource of copy.papers.resources) {
      expect(existsSync(resolve(PUBLIC, 'assets/documents', resource.slides.document))).toBe(true);
      for (let number = 1; number <= resource.slides.count; number++) {
        const filename = `slide-${String(number).padStart(2, '0')}.jpg`;
        expect(
          existsSync(resolve(PUBLIC, 'assets/slides', resource.slides.directory, filename))
        ).toBe(true);
      }
    }
  });
});
