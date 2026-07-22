# reversealignment.tw

Static recreation of [Reverse Alignment](https://reversealignment.tw/) — a coalition site for the institutional side of AI transformation.

This deployment serves **Traditional Mandarin (zh-TW) only** at the apex. The separate English site lives at [reversealignment.ai](https://www.reversealignment.ai/).

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

All visible copy lives in `src/data/content.json` keyed by locale. This site builds and serves the `zh-tw` catalog at `/` (and the global 404). The `en` catalog entry is retained for translation parity tests only — it is not routed here. Cross-domain `hreflang` points English readers at `https://www.reversealignment.ai/`. There is no on-site language toggle.
