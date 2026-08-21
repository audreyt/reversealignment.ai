import content from '../data/content.json';
import esDirectoryBios from '../data/directory-bios.es.json';
import jaDirectoryBios from '../data/directory-bios.ja.json';
import ptBrDirectoryBios from '../data/directory-bios.pt-br.json';
import zhTwDirectoryBios from '../data/directory-bios.zh-tw.json';
import site from '../data/site.json';
import { englishDirectoryBios } from '../data/directory-bios';
import type { DirectoryPerson } from './directory';
import type { Locale, SiteContent } from './types';

const catalog = content as Record<Locale, SiteContent>;
const directoryBiosByLocale: Record<Locale, Readonly<Record<string, string>>> = {
  en: englishDirectoryBios,
  'zh-tw': zhTwDirectoryBios,
  ja: jaDirectoryBios,
  es: esDirectoryBios,
  'pt-br': ptBrDirectoryBios,
};
const localeList = Object.keys(catalog) as Locale[];
const configuredLocale = process.env.SITE_LOCALE ?? site.defaultLocale;

assertDefaultLocalePresent(localeList, configuredLocale);

const DEFAULT_LOCALE = configuredLocale as Locale;

export function assertDefaultLocalePresent(
  locales: readonly string[],
  defaultLocale: string = DEFAULT_LOCALE
): void {
  if (!locales.includes(defaultLocale)) {
    throw new Error(`Default locale "${defaultLocale}" missing from content catalog`);
  }
}

export function getDefaultLocale(): Locale {
  return DEFAULT_LOCALE;
}

/** Catalog locale keys. Each build renders one selected locale at its root. */
export function listLocales(): Locale[] {
  return [...localeList];
}

export function isLocale(value: string): value is Locale {
  return Object.hasOwn(catalog, value);
}

function localizedSiteUrl(locale: Locale): string {
  const url = site.localizedUrls[locale as keyof typeof site.localizedUrls];
  if (!url) throw new Error(`No site URL configured for locale "${locale}"`);
  return url;
}

/** Origin actually serving a locale's files, when its canonical home lives elsewhere. */
function deployedSiteUrl(locale: Locale): string {
  // Official single-locale Pages deploys (en/ja) set SITE_DEPLOYED_URL to the
  // apex origin so isolation builds are indexable and self-hosted. Multi-locale
  // English still defaults to the /en preview path in site.deployedUrls.
  if (process.env.SITE_DEPLOYED_URL && locale === (process.env.SITE_LOCALE ?? site.defaultLocale)) {
    return process.env.SITE_DEPLOYED_URL;
  }
  return site.deployedUrls[locale as keyof typeof site.deployedUrls] ?? localizedSiteUrl(locale);
}

function resolveAgainst(root: string, path: string): string {
  return new URL(path.replace(/^\/+/, '') || './', `${root.replace(/\/+$/, '')}/`).toString();
}

/** Canonical URL a locale claims for itself, which search engines are pointed at. */
export function absoluteSiteUrl(path: string, locale: Locale = DEFAULT_LOCALE): string {
  return resolveAgainst(localizedSiteUrl(locale), path);
}

/** Absolute URL for a file this build ships, which must resolve on the serving origin. */
export function deployedAssetUrl(path: string, locale: Locale = DEFAULT_LOCALE): string {
  return resolveAgainst(deployedSiteUrl(locale), path);
}

/**
 * A locale is offered to search engines only where it owns a whole domain.
 * Anything served from a subpath is a preview of a site that lives elsewhere,
 * so it must not compete with the original.
 */
export function isIndexableLocale(locale: Locale = DEFAULT_LOCALE): boolean {
  return new URL(resolveAgainst(deployedSiteUrl(locale), '/')).pathname === '/';
}

export function getSite() {
  return {
    ...site,
    url: localizedSiteUrl(DEFAULT_LOCALE),
    lang: toBcp47(DEFAULT_LOCALE),
  };
}

export function getContent(locale: Locale = DEFAULT_LOCALE): SiteContent {
  const entry = catalog[locale];
  if (!entry) throw new Error(`Missing content for locale: ${String(locale)}`);
  return entry;
}

/**
 * Prefix that walks back to the build-tree root from `pathname`.
 *
 * Every isolation build owns its own asset tree, so a root page gets `./`.
 * Nested pages (`/join/`, `/halftone-lab/`) must climb, or their stylesheet and
 * favicon resolve one directory too deep once the locale merge relocates them.
 */
export function relativeRootPath(pathname = '/'): string {
  const segments = pathname.split('/').filter(Boolean);
  const depth = segments.length - (pathname.endsWith('/') ? 0 : 1);
  return depth <= 0 ? './' : '../'.repeat(depth);
}

/**
 * Root-relative asset URL. Every asset-bearing component renders on a tree-root
 * page, so the prefix is `./`; pass `rootPath` from {@link relativeRootPath}
 * when rendering one on a nested page.
 */
export function assetPath(key: string, locale: Locale = DEFAULT_LOCALE, rootPath = './'): string {
  const path = getContent(locale).assets[key];
  if (!path) throw new Error(`Missing asset mapping for key: ${key}`);
  return `${rootPath}${path.replace(/^\/+/, '')}`;
}

export function toBcp47(locale: Locale): string {
  if (locale === 'zh-tw') return 'zh-TW';
  if (locale === 'pt-br') return 'pt-BR';
  return locale;
}

export function toOgLocale(locale: Locale): string {
  return toBcp47(locale).replace(/-/g, '_');
}

export type HreflangAlternate = {
  hreflang: string;
  href: string;
};

/** Cross-domain alternates for every locally catalogued locale. */
export function hreflangAlternates(): HreflangAlternate[] {
  const orderedLocales = [
    DEFAULT_LOCALE,
    ...localeList.filter((locale) => locale !== DEFAULT_LOCALE),
  ];
  return [
    ...orderedLocales.map((locale) => ({
      hreflang: toBcp47(locale),
      href: absoluteSiteUrl('/', locale),
    })),
    {
      hreflang: 'x-default',
      href: absoluteSiteUrl('/', site.defaultLocale as Locale),
    },
  ];
}

/** Map one fixed catalog person into the browser directory contract. */
export function catalogPersonAsDirectory(
  person: { name: string; role: string; image: string; sector: string },
  index: number,
  bio?: string
): DirectoryPerson {
  const imageKey = person.image.trim();
  if (!imageKey) throw new Error(`Static directory person "${person.name}" needs an image key`);
  const separator = person.role.search(/[,，、]/);
  return {
    id: `canonical:${imageKey}`,
    fullName: person.name,
    role: person.role,
    affiliation: separator >= 0 ? person.role.slice(separator + 1).trim() : person.role,
    sector: person.sector,
    imageKey,
    sortIndex: index,
    ...(bio ? { bio } : {}),
  };
}

/** Fixed localized directory data, embedded in each static build. */
export function catalogPeopleAsDirectory(locale: Locale = DEFAULT_LOCALE): DirectoryPerson[] {
  return getContent(locale).coalition.people.map((person, index) =>
    catalogPersonAsDirectory(person, index, directoryBiosByLocale[locale][person.image.trim()])
  );
}

/** Valid HTML id fragment from a form field name or explicit id. */
export function formFieldDomId(formId: string, field: { name: string; id?: string }): string {
  const raw = (field.id || field.name).trim();
  const slug = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    // Drop apostrophes so "I'd" → "id" rather than "i-d"
    .replace(/['\u2019\u2018]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (!slug) {
    throw new Error(`Form field in "${formId}" needs a name/id that slugifies to a non-empty id`);
  }
  // HTML ids must start with a letter
  const safe = /^[a-z]/.test(slug) ? slug : `f-${slug}`;
  return `${formId}-${safe}`;
}
