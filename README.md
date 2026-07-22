# reversealignment.ai

Static recreation of [Reverse Alignment](https://www.reversealignment.ai/) — a coalition site for the institutional side of AI transformation.

Built with [Astro 7](https://astro.build/) and [Vite+](https://viteplus.dev/).

## Setup

```bash
curl -fsSL https://vite.plus | bash
vp install
```

If PATH is stale, use `~/.vite-plus/bin/vp`.

## Development

```bash
vp dev
```

## Checks and tests

```bash
vp check
vp test
```

`vp check` runs formatting, linting, and type-aware checks. `vp test` covers `tests/unit` (100% on `src/lib`) and runs `astro sync` + `tsc --noEmit` in global setup. Playwright E2E: `vp run test:e2e` after `vp build`.

## Build

```bash
vp build
```

## Content and locales

All visible copy lives in `src/data/content.json` keyed by locale. Locale codes are derived from those keys (`src/lib/types.ts` / `src/lib/i18n.ts`). English is served at `/`; additional locales get static routes at `/{locale}/` via `src/pages/[locale]/index.astro` with `hreflang` alternates in the base layout. Adding a locale means adding a catalog entry (and assets) — no component string edits.
