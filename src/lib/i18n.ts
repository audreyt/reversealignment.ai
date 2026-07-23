import content from '../data/content.json';
import site from '../data/site.json';
import type { Locale, SiteContent } from './types';

const catalog = content as Record<Locale, SiteContent>;
const localeList = Object.keys(catalog) as Locale[];
const configuredLocale = process.env.SITE_LOCALE ?? site.defaultLocale;

assertDefaultLocalePresent(localeList, configuredLocale);

const DEFAULT_LOCALE = configuredLocale as Locale;

/** Throws when the default locale is absent from the catalog keys. */
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

/** Catalog locale keys; each deployment serves one selected locale at `/`. */
export function listLocales(): Locale[] {
  return [...localeList];
}

export function isLocale(value: string): value is Locale {
  return Object.hasOwn(catalog, value);
}

function localizedSiteUrl(locale: Locale): string {
  return site.localizedUrls[locale as keyof typeof site.localizedUrls];
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
  if (!entry) {
    throw new Error(`Missing content for locale: ${String(locale)}`);
  }
  return entry;
}

/** Root-relative prefix to shared static files (this build serves only `/`). */
export function relativeRootPath(_locale: Locale = DEFAULT_LOCALE): './' {
  return './';
}

export function assetPath(key: string, locale: Locale = DEFAULT_LOCALE): string {
  const path = getContent(locale).assets[key];
  if (!path) {
    throw new Error(`Missing asset mapping for key: ${key}`);
  }
  return `${relativeRootPath(locale)}${path.replace(/^\/+/, '')}`;
}

/** BCP 47 language tag for HTML lang, hreflang, and JSON-LD inLanguage. */
export function toBcp47(locale: Locale): string {
  if (locale === 'zh-tw') return 'zh-TW';
  return String(locale);
}

/**
 * Open Graph locale tag (`og:locale`). Underscore form for regional tags
 * (e.g. zh_TW); plain language codes stay as-is (e.g. en).
 */
export function toOgLocale(locale: Locale): string {
  return toBcp47(locale).replace(/-/g, '_');
}

export type HreflangAlternate = {
  hreflang: string;
  href: string;
};

/**
 * Cross-domain language alternates. Only catalog locales are advertised, so a
 * reserved domain stays dark until its translated catalog is present.
 */
export function hreflangAlternates(): HreflangAlternate[] {
  const orderedLocales = [
    DEFAULT_LOCALE,
    ...localeList.filter((locale) => locale !== DEFAULT_LOCALE),
  ];
  return [
    ...orderedLocales.map((locale) => ({
      hreflang: toBcp47(locale),
      href: new URL('/', localizedSiteUrl(locale)).toString(),
    })),
    {
      hreflang: 'x-default',
      href: new URL('/', localizedSiteUrl(site.defaultLocale as Locale)).toString(),
    },
  ];
}

/**
 * Structural path keys used for catalog parity across locales.
 * Arrays encode length as `path[N]` and recurse into every element so a
 * translation cannot silently drop list items (challenges, people, nav,
 * form options, …) while still allowing translated string values to differ.
 */
export function collectShapePaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') {
    return prefix ? [prefix] : [];
  }
  if (Array.isArray(value)) {
    const lenKey = prefix ? `${prefix}[${value.length}]` : `[${value.length}]`;
    const paths: string[] = [lenKey];
    value.forEach((item, index) => {
      const itemPrefix = prefix ? `${prefix}[${index}]` : `[${index}]`;
      paths.push(...collectShapePaths(item, itemPrefix));
    });
    return paths;
  }
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    paths.push(...collectShapePaths(child, next));
  }
  return paths;
}

export function catalogShapePaths(locale: Locale = DEFAULT_LOCALE): string[] {
  return collectShapePaths(getContent(locale)).sort();
}

/**
 * Non-translatable structural values that must stay byte-identical across locales.
 * Covers hrefs, ids, slide metadata, tones, and people
 * image keys / kinds — not display labels, option strings, or locale-specific asset paths (og images, etc.).
 */
export function collectInvariantPaths(
  value: unknown,
  prefix = '',
  out: Record<string, unknown> = {}
): Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectInvariantPaths(item, prefix ? `${prefix}[${index}]` : `[${index}]`, out);
    });
    return out;
  }
  const obj = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      key === 'id' ||
      key === 'href' ||
      key === 'method' ||
      key === 'enctype' ||
      key === 'type' ||
      key === 'required' ||
      key === 'autocomplete' ||
      key === 'external' ||
      key === 'disabled' ||
      key === 'image' ||
      key === 'directory' ||
      key === 'document' ||
      key === 'count' ||
      key === 'tone' ||
      key === 'kind' ||
      key === 'number'
    ) {
      out[path] = child;
      continue;
    }
    // Person display names stay identical (proper nouns).
    if (key === 'name' && (prefix.endsWith('.people') || /\.people\[\d+\]$/.test(prefix))) {
      out[path] = child;
      continue;
    }
    collectInvariantPaths(child, path, out);
  }
  return out;
}

export function catalogInvariants(locale: Locale = DEFAULT_LOCALE): Record<string, unknown> {
  return collectInvariantPaths(getContent(locale));
}
