/**
 * Deterministic first-party monogram/abstract avatars.
 * No email-derived hashes, no third-party requests, no uploads.
 */

const PALETTES = [
  ['#6d28f5', '#cdfc56'],
  ['#0e0e0e', '#cdfc56'],
  ['#1d4ed8', '#e0e7ff'],
  ['#9f1239', '#ffe4e6'],
  ['#065f46', '#d1fae5'],
  ['#9a3412', '#ffedd5'],
  ['#1e3a8a', '#cdfc56'],
  ['#4c1d95', '#f5d0fe'],
] as const;

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Initials from a display name (1–2 Latin/CJK-friendly chars). */
export function monogramInitials(fullName: string): string {
  const cleaned = fullName.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '?';
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 1) {
    const word = parts[0]!;
    // CJK / single token: take up to 2 code points
    const chars = Array.from(word);
    return chars.slice(0, 2).join('').toUpperCase();
  }
  const first = Array.from(parts[0]!)[0]!;
  const last = Array.from(parts[parts.length - 1]!)[0]!;
  return `${first}${last}`.toUpperCase();
}

export type AvatarModel = {
  initials: string;
  primary: string;
  secondary: string;
  seed: number;
};

export function avatarFromName(fullName: string): AvatarModel {
  const initials = monogramInitials(fullName);
  const normalized = fullName.normalize('NFC').trim().toLowerCase();
  // Empty names still get a stable seed via initials ("?").
  const seed = fnv1a(normalized.length > 0 ? normalized : initials);
  const palette = PALETTES[seed % PALETTES.length]!;
  return {
    initials,
    primary: palette[0],
    secondary: palette[1],
    seed,
  };
}

/** Inline SVG data URI — safe for <img src> and CSS backgrounds. */
export function avatarDataUri(fullName: string, size = 256): string {
  const { initials, primary, secondary, seed } = avatarFromName(fullName);
  const cx = 30 + (seed % 40);
  const cy = 25 + ((seed >>> 8) % 50);
  const r = 55 + ((seed >>> 16) % 35);
  const rot = seed % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256" role="img" aria-hidden="true">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${secondary}"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="28" fill="url(#g)"/>
  <g opacity="0.28" transform="rotate(${rot} 128 128)">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/>
    <circle cx="${256 - cx}" cy="${256 - cy}" r="${r * 0.7}" fill="#000"/>
  </g>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
    font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    font-size="${initials.length > 1 ? 92 : 110}" font-weight="700" fill="#fff"
    style="letter-spacing:-0.04em">${escapeXml(initials)}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
