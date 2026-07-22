import content from '../data/content.json';
import site from '../data/site.json';
import type { Locale, SiteContent } from './types';

const DEFAULT_LOCALE = 'zh-tw' as const satisfies Locale;

const catalog = content as Record<Locale, SiteContent>;

const localeList = Object.keys(catalog) as Locale[];

/** Throws when the default locale is absent from the catalog keys. */
export function assertDefaultLocalePresent(
  locales: readonly string[],
  defaultLocale: string = DEFAULT_LOCALE
): void {
  if (!locales.includes(defaultLocale)) {
    throw new Error(`Default locale "${defaultLocale}" missing from content catalog`);
  }
}

assertDefaultLocalePresent(localeList, DEFAULT_LOCALE);

export function getDefaultLocale(): Locale {
  return DEFAULT_LOCALE;
}

/** Catalog locale keys (includes `en` for parity tests; only default is routed). */
export function listLocales(): Locale[] {
  return [...localeList];
}

export function isLocale(value: string): value is Locale {
  return Object.hasOwn(catalog, value);
}

export function getSite() {
  return site;
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
 * Cross-domain language alternates for this zh-TW-only deployment.
 * English content is served on reversealignment.ai, not under a local `/en/` route.
 */
export function hreflangAlternates(): HreflangAlternate[] {
  const { url, englishSiteUrl } = getSite() as {
    url: string;
    englishSiteUrl: string;
  };
  const tw = new URL('/', url).toString();
  const en = new URL('/', englishSiteUrl).toString();
  return [
    { hreflang: 'zh-TW', href: tw },
    { hreflang: 'en', href: en },
    { hreflang: 'x-default', href: tw },
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

/** Protocol + recipient only; query (subject/body) may be localized. */
export function normalizeMailtoAction(action: unknown): unknown {
  if (typeof action !== 'string') return action;
  const match = /^mailto:([^?]+)(?:\?.*)?$/i.exec(action.trim());
  if (!match) return action;
  return `mailto:${match[1].toLowerCase()}`;
}

/**
 * Non-translatable structural values that must stay byte-identical across locales.
 * Covers hrefs, ids, form wiring, slide metadata, tones, and people
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
    // mailto: subjects are user-visible composer text and may localize;
    // lock only protocol + recipient mailbox.
    if (key === 'action') {
      out[path] = normalizeMailtoAction(child);
      continue;
    }
    // Form field `name` is the mailto body key — structural, not a label.
    if (key === 'name' && (prefix.endsWith('.fields') || /\.fields\[\d+\]$/.test(prefix))) {
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
