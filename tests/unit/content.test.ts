import { describe, expect, test } from 'vite-plus/test';
import { JOIN_API_PATH, JOIN_API_RELATIVE_PATH, JOIN_PATH } from '../../src/lib/api';
import {
  absoluteSiteUrl,
  deployedAssetUrl,
  assertDefaultLocalePresent,
  assetPath,
  catalogPeopleAsDirectory,
  catalogPersonAsDirectory,
  formFieldDomId,
  getContent,
  getDefaultLocale,
  getSite,
  hreflangAlternates,
  isIndexableLocale,
  isLocale,
  listLocales,
  relativeRootPath,
  toBcp47,
  toOgLocale,
} from '../../src/lib/i18n';
import type { Locale } from '../../src/lib/types';

const expectedSortLabels = {
  en: ['Default order', 'Name A–Z', 'Name Z–A', 'Sector'],
  'zh-tw': ['預設排序', '姓名 A–Z', '姓名 Z–A', '領域'],
  ja: ['デフォルト順', '名前 A–Z', '名前 Z–A', '分野'],
  es: ['Orden predeterminado', 'Nombre A–Z', 'Nombre Z–A', 'Sector'],
  'pt-br': ['Ordem padrão', 'Nome A–Z', 'Nome Z–A', 'Setor'],
} satisfies Record<Locale, string[]>;

/**
 * Locales that own a whole domain and therefore host their own Access-gated join
 * form. Every other locale is brochure-only and links to one of these.
 */
const LIVE_JOIN_URLS: Partial<Record<Locale, string>> = {
  en: 'https://reversealignment.ai/join/',
  'zh-tw': 'https://reversealignment.tw/join/',
  ja: 'https://reversealignment.jp/join/',
};

describe('multilingual static catalog', () => {
  test('keeps zh-TW as the default deployment and retains every locale', () => {
    expect(getDefaultLocale()).toBe('zh-tw');
    expect(listLocales().sort()).toEqual(['en', 'es', 'ja', 'pt-br', 'zh-tw']);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('zh-tw')).toBe(true);
    expect(isLocale('ja')).toBe(true);
    expect(isLocale('es')).toBe(true);
    expect(isLocale('pt-br')).toBe(true);
    expect(isLocale('missing')).toBe(false);
    expect(() => assertDefaultLocalePresent(['en'], 'zh-tw')).toThrow(
      /missing from content catalog/
    );
    expect(() => assertDefaultLocalePresent(['en'], 'en')).not.toThrow();
    expect(getSite()).toMatchObject({
      name: 'Reverse Alignment',
      url: 'https://reversealignment.tw',
      lang: 'zh-TW',
    });
  });

  test('keeps static 26-person catalogs and translated directory controls', () => {
    for (const locale of listLocales()) {
      const copy = getContent(locale);
      const people = catalogPeopleAsDirectory(locale);
      const directory = copy.coalition.directory;

      const join = copy.join;
      expect(join.eyebrow.length, locale).toBeGreaterThan(0);
      expect(join.title.length, locale).toBeGreaterThan(0);
      expect(join.lead.length, locale).toBeGreaterThan(0);
      expect(join.body.length, locale).toBeGreaterThan(0);
      expect(join.mode, locale).toBe('cta');
      expect(join.cta.href, locale).toBe(
        LIVE_JOIN_URLS[locale] ?? 'https://reversealignment.ai/join/'
      );
      expect(join.cta.external, locale).toBe(true);
      expect(join.cta.label.length, locale).toBeGreaterThan(0);
      if (locale in LIVE_JOIN_URLS) {
        // A live locale hosts the form itself, so its CTA stays on its own domain.
        expect(join.form.mode, locale).toBe('live');
        expect(new URL(join.cta.href).origin, locale).toBe(
          absoluteSiteUrl('/', locale).slice(0, -1)
        );
      } else {
        expect(join.form.mode, locale).toBe('cta-only');
      }
      expect(copy.coalition.people, locale).toHaveLength(26);
      expect(people, locale).toHaveLength(26);
      expect(
        people.filter((person) => person.fullName === 'Tenzin Yangtso'),
        locale
      ).toHaveLength(1);
      expect(people.find((person) => person.fullName === 'Audrey Tang')?.role, locale).toContain(
        '🇹🇼'
      );
      expect(copy.assets['person-tenzin-yangtso'], locale).toBe(
        '/assets/images/person-tenzin-yangtso.png'
      );
      expect(typeof copy.assets['join-bg'], locale).toBe('string');
      expect(copy.assets['join-bg'].length, locale).toBeGreaterThan(0);
      // Card identity is derived from the portrait key, so a shared key would
      // collapse two people into one and break filtering for both.
      expect(new Set(people.map((person) => person.id)).size, locale).toBe(people.length);
      expect(copy.nav.coalition.href, locale).toBe('#coalition');
      expect(copy.hero.primaryCta.href, locale).toBe('#coalition');
      expect(directory.searchLabel.length, locale).toBeGreaterThan(0);
      expect(directory.sortLabel.length, locale).toBeGreaterThan(0);
      expect(
        directory.sortOptions.map((option) => option.label),
        locale
      ).toEqual(expectedSortLabels[locale]);
      expect(
        directory.sortOptions.map((option) => option.value),
        locale
      ).toEqual(['default', 'name', 'name-desc', 'sector']);
    }
  });

  test('ships live join form copy for every whole-domain locale', () => {
    const liveLocales = listLocales().filter(
      (locale) => getContent(locale).join.form.mode === 'live'
    );
    expect(liveLocales.slice().sort()).toEqual(['en', 'ja', 'zh-tw']);

    // A live locale must own a whole domain, or its join URL would collide with
    // another locale's tree on a shared host.
    for (const locale of liveLocales) {
      expect(new URL(absoluteSiteUrl('/', locale)).pathname, locale).toBe('/');
      expect(absoluteSiteUrl(JOIN_PATH, locale), locale).toBe(LIVE_JOIN_URLS[locale]);
    }

    expect(JOIN_API_PATH).toBe('/join/api');

    for (const locale of liveLocales) {
      const form = getContent(locale).join.form;
      // Page-relative so the locale merge cannot rewrite it to /en/en/join/api.
      expect(form.action, locale).toBe(JOIN_API_RELATIVE_PATH);
      expect(form.submitLabel.length, locale).toBeGreaterThan(0);
      const byName = Object.fromEntries(form.fields.map((field) => [field.name, field]));
      for (const name of ['fullName', 'sector'] as const) {
        expect(byName[name]?.required, `${locale} ${name}`).toBe(true);
      }
      // Access supplies the verified email, so the form must never collect one.
      expect(byName.email, locale).toBeUndefined();
      expect(
        form.fields.map((field) => field.name),
        locale
      ).toEqual(['fullName', 'affiliation', 'sector', 'contribution', 'links', 'statement']);
      expect(
        (byName.sector?.options ?? []).map((option) =>
          typeof option === 'string' ? option : option.value
        ),
        locale
      ).toEqual([
        'Research',
        'Technology',
        'Government',
        'Philanthropy',
        'Civil Society',
        'Business',
        'Entertainment',
        'Media',
      ]);
      expect(
        (byName.contribution?.options ?? []).map((option) =>
          typeof option === 'string' ? option : option.value
        ),
        locale
      ).toEqual([
        'Lend your name to the statement',
        'Bring a challenge into your own organization or sector',
        'Contribute expertise, writing, or research',
        'Help fund the work',
        'Stay informed as the coalition grows',
        'All of the above',
      ]);
      expect(form.honeypotName.length, locale).toBeGreaterThan(0);
      for (const key of [
        'successTitle',
        'successMessage',
        'updatesTitle',
        'updatesMessage',
        'pendingTitle',
      ] as const) {
        const value = form[key];
        expect(typeof value === 'string' && value.length > 0, `${locale} ${key}`).toBe(true);
      }
      expect(form.updatesTitle, locale).not.toMatch(/review queue|審核佇列|審査キュー/i);
      expect(form.updatesMessage, locale).toMatch(/updates list|更新名單|最新情報リスト/i);

      // The optional portrait step ships with the form; missing copy renders blank.
      const photo = form.photo;
      if (photo == null || typeof photo !== 'object') {
        throw new Error(`${locale}.join.form.photo missing`);
      }
      for (const key of [
        'label',
        'hint',
        'removeLabel',
        'processingLabel',
        'readyLabel',
        'errorMessage',
        'uploadFailed',
        'storeFailed',
      ] as const) {
        const value = photo[key];
        expect(typeof value === 'string' && value.length > 0, `${locale} photo.${key}`).toBe(true);
      }
    }
  });

  test('builds the expected cross-locale metadata and paths', () => {
    const alternates = hreflangAlternates();
    expect(alternates).toEqual(
      expect.arrayContaining([
        { hreflang: 'zh-TW', href: 'https://reversealignment.tw/' },
        { hreflang: 'en', href: 'https://reversealignment.ai/' },
        { hreflang: 'ja', href: 'https://reversealignment.jp/' },
        { hreflang: 'es', href: 'https://reversealignment.tw/es/' },
        { hreflang: 'pt-BR', href: 'https://reversealignment.tw/pt-BR/' },
        { hreflang: 'x-default', href: 'https://reversealignment.tw/' },
      ])
    );
    expect(relativeRootPath('/')).toBe('./');
    expect(relativeRootPath('/index.html')).toBe('./');
    // Nested pages must climb, or the merged /en/join/ tree loads /en/join/assets.
    expect(relativeRootPath('/join/')).toBe('../');
    expect(relativeRootPath('/join/index.html')).toBe('../');
    expect(assetPath('person-glen-weyl', 'en')).toBe('./assets/images/person-glen-weyl.png');
    expect(assetPath('person-glen-weyl', 'en', '../')).toBe(
      '../assets/images/person-glen-weyl.png'
    );
    expect(() => assetPath('not-an-asset')).toThrow(/Missing asset mapping/);
    expect(absoluteSiteUrl('/', 'zh-tw')).toBe('https://reversealignment.tw/');
    expect(absoluteSiteUrl('/', 'en')).toBe('https://reversealignment.ai/');
    expect(absoluteSiteUrl('/assets/images/og-image.jpg', 'pt-br')).toBe(
      'https://reversealignment.tw/pt-BR/assets/images/og-image.jpg'
    );
    expect(absoluteSiteUrl('assets/images/og-image.jpg', 'es')).toBe(
      'https://reversealignment.tw/es/assets/images/og-image.jpg'
    );
    expect(deployedAssetUrl('/assets/images/og-image.jpg', 'en')).toBe(
      'https://reversealignment.tw/en/assets/images/og-image.jpg'
    );
    expect(deployedAssetUrl('/assets/images/og-image.jpg', 'zh-tw')).toBe(
      'https://reversealignment.tw/assets/images/og-image.jpg'
    );
    expect(() => deployedAssetUrl('/', 'missing' as Locale)).toThrow(/No site URL configured/);
    expect(toBcp47('zh-tw')).toBe('zh-TW');
    expect(toBcp47('pt-br')).toBe('pt-BR');
    expect(toBcp47('ja')).toBe('ja');
    expect(toOgLocale('pt-br')).toBe('pt_BR');
    expect(() => getContent('missing' as Locale)).toThrow(/Missing content/);
    expect(() => absoluteSiteUrl('/', 'missing' as Locale)).toThrow(/No site URL configured/);
  });

  test('indexes only locales that own a whole domain', () => {
    expect(isIndexableLocale('zh-tw')).toBe(true);
    expect(isIndexableLocale('ja')).toBe(true);
    // English brochure is official at reversealignment.ai, but the multi-locale
    // build still serves a noindex preview under reversealignment.tw/en/.
    expect(isIndexableLocale('en')).toBe(false);
    expect(isIndexableLocale('es')).toBe(false);
    expect(isIndexableLocale('pt-br')).toBe(false);
    expect(isIndexableLocale()).toBe(true);
  });

  test('SITE_DEPLOYED_URL makes the active locale self-hosted and indexable', () => {
    // Official English Pages builds set SITE_LOCALE=en + SITE_DEPLOYED_URL so the
    // apex owns its assets. Multi-locale build:all leaves both unset, so /en stays
    // a noindex preview under reversealignment.tw.
    const prevDeployed = process.env.SITE_DEPLOYED_URL;
    const prevLocale = process.env.SITE_LOCALE;
    try {
      process.env.SITE_DEPLOYED_URL = 'https://reversealignment.ai';
      process.env.SITE_LOCALE = 'en';
      expect(deployedAssetUrl('/assets/images/og-image.jpg', 'en')).toBe(
        'https://reversealignment.ai/assets/images/og-image.jpg'
      );
      expect(isIndexableLocale('en')).toBe(true);
      // Other locales keep their configured homes.
      expect(deployedAssetUrl('/assets/images/og-image.jpg', 'zh-tw')).toBe(
        'https://reversealignment.tw/assets/images/og-image.jpg'
      );

      // Nullish SITE_LOCALE falls back to site.defaultLocale (zh-tw).
      delete process.env.SITE_LOCALE;
      expect(deployedAssetUrl('/assets/images/og-image.jpg', 'zh-tw')).toBe(
        'https://reversealignment.ai/assets/images/og-image.jpg'
      );
      expect(deployedAssetUrl('/assets/images/og-image.jpg', 'en')).toBe(
        'https://reversealignment.tw/en/assets/images/og-image.jpg'
      );
    } finally {
      if (prevDeployed === undefined) delete process.env.SITE_DEPLOYED_URL;
      else process.env.SITE_DEPLOYED_URL = prevDeployed;
      if (prevLocale === undefined) delete process.env.SITE_LOCALE;
      else process.env.SITE_LOCALE = prevLocale;
    }
    expect(isIndexableLocale('en')).toBe(false);
  });

  test('derives stable HTML ids for every live form field', () => {
    const form = getContent('en').join.form;
    const ids = form.fields.map((field) => formFieldDomId(form.id, field));

    // Ids land in markup as label/aria targets, so collisions break the form.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z][a-z0-9-]*$/.test(id))).toBe(true);
    expect(ids).toContain('join-form-fullname');
    // "I’d also like to contribute by…" must not become "i-d-also-…".
    expect(formFieldDomId('join-form', { name: 'I’d also like to contribute by…' })).toBe(
      'join-form-id-also-like-to-contribute-by'
    );
    expect(formFieldDomId('f', { name: 'Adresse E-Mail (privé)' })).toBe('f-adresse-e-mail-prive');
    expect(formFieldDomId('f', { name: 'ignored', id: 'explicit' })).toBe('f-explicit');
    // Ids may not start with a digit.
    expect(formFieldDomId('f', { name: '2fa code' })).toBe('f-f-2fa-code');
    expect(() => formFieldDomId('join-form', { name: '姓名' })).toThrow(/non-empty id/);
    expect(() => formFieldDomId('join-form', { name: '   ' })).toThrow(/non-empty id/);
  });

  test('maps fixed directory people and rejects missing portraits', () => {
    expect(catalogPeopleAsDirectory()[0]).toMatchObject({
      id: 'canonical:person-glen-weyl',
      fullName: 'Eric Glen Weyl',
      sortIndex: 0,
    });
    expect(catalogPeopleAsDirectory('en').at(-2)).toMatchObject({
      id: 'canonical:person-vitalik-buterin',
      fullName: 'Vitalik Buterin',
      affiliation: 'Ethereum',
      sector: 'Technology',
      sortIndex: 24,
    });
    expect(catalogPeopleAsDirectory('en').at(-1)).toMatchObject({
      id: 'canonical:person-tenzin-yangtso',
      fullName: 'Tenzin Yangtso',
      affiliation: 'Civic.AI',
      sector: 'Research',
      sortIndex: 25,
    });
    const englishPeople = catalogPeopleAsDirectory('en');
    expect(englishPeople.filter((person) => person.bio)).toHaveLength(26);
    expect(englishPeople[0].bio).toContain('Plural Technology Collaboratory');
    expect(englishPeople.find((person) => person.fullName === 'Vitalik Buterin')?.bio).toContain(
      'conceived Ethereum'
    );
    expect(englishPeople.find((person) => person.fullName === 'Tenzin Yangtso')?.bio).toContain(
      'data soil'
    );
    for (const locale of ['zh-tw', 'ja', 'es', 'pt-br'] as const) {
      expect(catalogPeopleAsDirectory(locale).filter((person) => person.bio)).toHaveLength(26);
    }
    expect(catalogPeopleAsDirectory('zh-tw')[0].bio).toContain('多元宇宙');
    expect(
      catalogPeopleAsDirectory('zh-tw').find((person) => person.fullName === 'Tenzin Yangtso')?.bio
    ).toContain('資料土壤');
    expect(catalogPeopleAsDirectory('ja')[0].bio).toContain('プルラリティ');
    expect(
      catalogPeopleAsDirectory('ja').find((person) => person.fullName === 'Tenzin Yangtso')?.bio
    ).toContain('データの土壌');
    expect(
      catalogPeopleAsDirectory('es').find((person) => person.fullName === 'Tenzin Yangtso')?.bio
    ).toContain('suelo de datos');
    expect(
      catalogPeopleAsDirectory('pt-br').find((person) => person.fullName === 'Tenzin Yangtso')?.bio
    ).toContain('solo de dados');
    const audreyZhBio = catalogPeopleAsDirectory('zh-tw').find(
      (person) => person.fullName === 'Audrey Tang'
    )?.bio;
    expect(audreyZhBio).toContain('公民黑客');
    expect(audreyZhBio).toContain('《仁工智慧》');
    expect(audreyZhBio).toContain('「諾貝爾替代獎」');
    expect(audreyZhBio).toContain('Right Livelihood Award（正命獎）');
    expect(
      catalogPersonAsDirectory(
        {
          name: 'Ada Lovelace',
          role: 'Analyst, Analytical Engine',
          image: 'person-ada',
          sector: 'Research',
        },
        3
      )
    ).toEqual({
      id: 'canonical:person-ada',
      fullName: 'Ada Lovelace',
      role: 'Analyst, Analytical Engine',
      affiliation: 'Analytical Engine',
      sector: 'Research',
      imageKey: 'person-ada',
      sortIndex: 3,
    });
    expect(
      catalogPersonAsDirectory(
        { name: 'Ada Lovelace', role: 'Analyst', image: 'person-ada', sector: 'Research' },
        4
      ).affiliation
    ).toBe('Analyst');
    expect(() =>
      catalogPersonAsDirectory(
        { name: 'Missing Portrait', role: 'Researcher', image: ' ', sector: 'Research' },
        5
      )
    ).toThrow(/needs an image key/);
  });
});
