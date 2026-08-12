# reversealignment.ai

The English apex, `reversealignment.ai`, is the canonical home of Reverse Alignment. This
repo builds that apex (`SITE_LOCALE=en`), the Japanese apex on `reversealignment.jp`, the
Taiwanese Mandarin multi-locale host on `reversealignment.tw`, and the Cloudflare Worker
that serves `/api/*` plus the Access-gated join POST.

| Host / path                   | Locale                              | Indexable                    |
| ----------------------------- | ----------------------------------- | ---------------------------- |
| reversealignment.ai           | `en` (`SITE_LOCALE=en`) — canonical | yes                          |
| reversealignment.jp           | `ja` (`SITE_LOCALE=ja`)             | yes                          |
| `/` on reversealignment.tw    | `zh-tw` (default build locale)      | yes                          |
| `/en/` on reversealignment.tw | `en` preview copy                   | no (`noindex`)               |
| `/es/`, `/pt-BR/`             | `es`, `pt-br`                       | no (subpath of another home) |
| `<apex>/join/`                | Access-gated join form              | —                            |

Canonical homes come from `localizedUrls` in `src/data/site.json`; the origin actually
serving a locale comes from `deployedUrls`. `isIndexableLocale` derives indexability from
that pair with one rule: anything served from a subpath is a preview of a site that lives
elsewhere, so it must not compete with the original. That is why `/en/` on the zh-TW host
is `noindex` while `reversealignment.ai` — the same locale, its own apex — is not.

Three apexes serve the form; `www` is not an entry point. The Worker takes every `www`
path and 308s it to the apex, so Cloudflare Access only ever has to cover three hosts.

## The roster lives in Cloudflare, not in Git

The coalition directory server-renders the fixed founding catalog from
`src/data/content.json` (25 people with first-party portraits) as its offline baseline.
After first paint, `CoalitionDirectory` fetches published community members from
`GET https://join.reversealignment.tw/api/members` — the single source of truth, backed by
Cloudflare D1 through the Worker — and hydrates them client-side as monogram cards.
Founding cards win on ID collision, and sector controls appear as the roster grows.
Directory labels and sort options are translated per locale.

No roster snapshot, seed file, or import migration is committed. Member rows live in D1,
portraits live in R2, and nothing in this repository contains a respondent's name.

### What is static vs live

- **Static on every locale:** page copy, the founding 25-person catalog, the client-side
  directory search/filter/sort UI, and the brochure sections. Without the Worker the
  directory stays at its founding baseline and says so honestly.
- **Live Worker (`reversealignment-api`):** one deployment on two route sets. On
  `join.reversealignment.tw` it serves the read APIs — the exclusive community roster,
  portrait bytes, health — plus admin moderation. On each apex it serves only the
  Access-gated `POST /join/api`; that path is deliberately 404 on the join host.
  Returning joiners are matched by an HMAC of their Access-verified email.
- **Brochure surface:** every homepage renders a CTA, never a form (`join.mode === "cta"`
  in all five locales). The form is a property of the join page instead: `en`, `zh-tw`, and
  `ja` set `join.form.mode === "live"` because each owns an apex, while `es` and `pt-br` set
  `cta-only` and link to a locale that owns one.

## Setup

```bash
vp install
```

## Build

```bash
# Canonical English apex (reversealignment.ai)
vp run build:en

# Japanese apex (reversealignment.jp)
vp run build:ja

# zh-TW root plus the English, Spanish, and Brazilian Portuguese subpath trees
vp run build:all

# Bare build — zh-TW, the default locale in site.json
vp run build
```

`build:en` / `build:ja` emit a single-locale root tree for their dedicated Pages projects;
`SITE_DEPLOYED_URL` makes that root indexable and self-hosted. `build:all` runs one
isolated build per locale and assembles `dist/`, `dist/en/`, `dist/es/`, `dist/pt-BR/`
(`vp run build:es` and `vp run build:pt-br` build those locales alone).

There is deliberately no `dev` script. For brochure iteration, build and serve the static
tree the same way the e2e suite does:

```bash
vp run build:all && bunx serve -l 4321 --no-clipboard dist
```

The join form needs a Worker on the same origin, so use the full-stack harness below
rather than a static preview.

## Checks

```bash
vp check
vp run test:unit
vp run build:all
vp run lint:html
vp run test:e2e
```

Worker-focused checks, no site build required:

```bash
vp run test:worker
vp run test:worker:smoke
```

Full-stack join check — real browser against a real Worker with D1 and R2, on its own
isolated database, a free port, and a locally signed Access JWT:

```bash
vp run build:en
vp run test:e2e:live
```

`build:en` is required, not interchangeable with `build:all`: the live suite drives the
English deployment shape, where `/join/` sits at the dist root same-origin with
`/join/api`. A multi-locale `dist` puts it under `/en/` instead. CI's `join-live` job runs
the same target.

`tests/e2e/join-live.e2e.ts` skips itself unless `E2E_LIVE_API=1`, so the default
`test:e2e` run stays a pure static-`dist` suite.

## Structure

- `src/data/content.json` — localized page copy, asset maps, the fixed founding cohort,
  translated directory controls, and per-locale join mode / CTA / form copy.
- `src/data/site.json` — canonical vs deployed URL maps that drive canonicals, hreflang,
  and indexability.
- `src/components/CoalitionDirectory.astro` — founding SSR cards plus client-side roster
  hydration, filters, and motion.
- `src/components/JoinForm.astro` — the live join UI (Access session + optional
  in-browser photo step).
- `src/pages/join.astro` — the join page, including the bounce that sends any non-canonical
  copy to the host that owns the form.
- `src/lib/directory.ts` — deterministic search, filtering, sorting, and API merge helpers.
- `src/lib/api.ts` — join path constants, the members API origin, and the paging fetch.
- `src/lib/halftone.ts` + `src/workers/halftone.worker.ts` — the in-browser portrait filter.
- `worker/` — Cloudflare Worker + D1 (+ optional R2 portraits).
- `scripts/build-all-locales.sh` — per-locale isolation builds and subpath assembly.

## Live join backend

Identity comes from Cloudflare Access. Access gates `/join/*` at the edge while the
brochure stays public, so a visitor is already authenticated before the form renders, and
the Worker re-verifies the `Cf-Access-Jwt-Assertion` on submit. There is no CAPTCHA, no
emailed verification code, and no challenge table — the join is a single authenticated
POST. `tests/e2e/join-form.e2e.ts` asserts the absence of every removed control.

The form posts to a **page-relative** `api`, which resolves to `/join/api` on whichever
deployment served it. That is what keeps the zh-TW host's `/en/join/` preview copy from
posting to the English apex, and the copy bounces to its canonical URL anyway, so a
visitor can only ever submit from the deployment that owns the form.

| Route                       | Method | Purpose                                             |
| --------------------------- | ------ | --------------------------------------------------- |
| `<apex>/join/api`           | POST   | Access-gated join; only the `JOIN_API_HOSTS` apexes |
| `/api/members`              | GET    | published roster, 100 rows per page                 |
| `/api/portrait/<sha>.<ext>` | GET    | verified portrait bytes from R2                     |
| `/api/health`               | GET    | liveness                                            |
| `/api/admin/queue`          | GET    | moderation queue (admin token)                      |
| `/api/admin/members`        | POST   | publish / reject (admin token)                      |

`join.reversealignment.tw` and `workers.dev` are excluded from `JOIN_API_HOSTS` by design,
and the legacy `/api/join*` paths return `not_found` so no old client can create a member.

### Local full stack

```bash
vp install
cp .dev.vars.example .dev.vars   # local secrets; never commit
vp run db:migrate:local
vp run dev:api                   # Worker API on :8787 — /api/* only, no pages
```

`vp run dev:api` is enough to exercise the read APIs. The join POST needs a page and the
Worker on one origin plus a valid Access JWT, which is exactly what `vp run test:e2e:live`
builds: `scripts/join-live-e2e.sh` boots an isolated `wrangler dev --assets dist` on a free
port, mints a local JWKS and signed token via `scripts/access-jwt-fixture.mjs`, and never
touches your `.wrangler/state` or `.dev.vars`.

| Script                     | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `vp run dev:api`           | `wrangler dev` — the `/api/*` Worker, no pages |
| `vp run db:migrate:local`  | apply D1 migrations to the local DB            |
| `vp run test:worker`       | focused Worker unit tests                      |
| `vp run test:worker:smoke` | end-to-end Worker lifecycle smoke              |
| `vp run test:e2e:live`     | browser + Worker + D1 + R2 join flow, isolated |
| `vp run types:worker`      | regenerate `worker-configuration.d.ts`         |

### Migrations

`worker/migrations` holds `0001`–`0006`, `0011`, and `0012`. **The `0007`–`0010` gap is
intentional**: those were the one-time spreadsheet import and its follow-ups, they carried
respondent names and salted email hashes, and they were deleted when the roster became
D1-only. They are already applied on the production database, and D1 tracks applied
migrations by filename, so their absence is inert. Do not renumber to close the gap.

`0006` dropped `join_challenges` — Access verifies identity before submit, so there is
nothing to stage. `0011` added the `updates_only` status that keeps non-directory join
intents out of the human moderation queue. `0012` added the private verified-email column.

### Provisioning (Cloudflare)

```bash
wrangler d1 create reversealignment-coalition
wrangler r2 bucket create reversealignment-portraits
wrangler secret put AUTH_PEPPER
wrangler secret put IMPORT_SALT
wrangler secret put ADMIN_TOKEN
```

- **D1** (`reversealignment-coalition`, binding `DB`) holds member rows. The binding name
  is load-bearing: `worker/src/*` reads `env.DB`.
- **R2** (`reversealignment-portraits`, binding `PORTRAITS`) stores verified portraits under
  content-addressed keys. If the binding is absent, join still succeeds and the member
  falls back to a generated monogram.
- **Secrets:** `AUTH_PEPPER` (HMAC pepper for email hashes, ≥16 chars), `IMPORT_SALT`
  (≥16 chars; recognizes members imported before the join flow existed, whose rows carry
  `import:` hashes), `ADMIN_TOKEN` (moderation API bearer).
- **Vars** in `wrangler.jsonc`: `ACCESS_AUD`, `ACCESS_ISSUER`, `ACCESS_JWKS_URL`,
  `JOIN_API_HOSTS`, `ALLOWED_ORIGINS`. An empty `ACCESS_AUD` fails closed — every join
  request returns 401.

Deploy the Worker with `wrangler deploy`, separately from the static publish.

### In-browser photo filter

The join form accepts an optional portrait. Processing runs entirely in the visitor's
browser (`src/lib/halftone.ts` + `src/workers/halftone.worker.ts`): only the
halftone-processed WebP/PNG is uploaded and the original never leaves the device. Because
Access has already verified the submitter, accepted bytes go straight to R2 under
`portraits/<sha256>.<webp|png>` and are served at `/api/portrait/<sha>.<ext>`.

### Security / privacy defaults (worker)

- The Access-verified email is stored privately in full alongside its HMAC hash and domain;
  it is returned only by the authenticated moderation API, never by a public one.
- Contribution, statement, links, IP hashes, and moderation notes stay private.
- Avatars: first-party PNGs for the founding cohort, an optional verified halftone upload,
  otherwise a monogram generated from the display name. No Gravatar.
- AI moderation is recommendation-only and fail-closed: every join stays `pending_review`
  until a human publishes or rejects it.
- Public directory queries always filter `status = 'published'`.

## Hosting

The halves deploy separately and neither can stand in for the other:

| Surface                                | Deployed by                | Serves                                            |
| -------------------------------------- | -------------------------- | ------------------------------------------------- |
| Cloudflare Pages `reversealignment-en` | its own build from `main`  | English apex (`SITE_LOCALE=en`, `vp build`)       |
| Cloudflare Pages `reversealignment-jp` | its own build from `main`  | Japanese apex (`SITE_LOCALE=ja`, `vp build`)      |
| Cloudflare Pages `reversealignment-ai` | its own build from `main`  | zh-TW multi-locale HTML (`vp run build:all`)      |
| Worker `reversealignment-api`          | `wrangler deploy`, by hand | `/api/*` plus the Access join POST on `/join/api` |

Despite its name, the `reversealignment-ai` Pages project serves **`reversealignment.tw`**,
not the `.ai` apex. It is production for the zh-TW host. Do not delete it.

> **Git integration needs re-linking.** The repository was deleted and re-created on
> 2026-08-13 to purge respondent PII from its history, so every Pages project lost the
> Git connection that pointed at the old repository ID. Until each project is re-linked in
> the Cloudflare dashboard, pushes to `main` do not trigger a build; the live sites keep
> serving their last successful deploy.

GitHub Pages is not involved: the repo ships no `CNAME`, and the workflow that used to
publish there was deleted because `audreyt.github.io/reversealignment.ai/` 404s.

The repo variables `PUBLIC_API_BASE` and `PUBLIC_TURNSTILE_SITE_KEY` are vestigial —
nothing in the build reads either one. The join API is reached by a page-relative path
instead of a baked-in origin, and Turnstile was removed when Access took over identity.

The Worker binds **no static assets**: anything that is not an `/api/*` route or the
`/join/api` POST returns `{"error":"not_found"}` with status 404. That is deliberate. It
once served a copy of `dist/`, which went stale on every push that did not also run
`wrangler deploy`. One page, one owner.

`ALLOWED_ORIGINS` and `JOIN_API_HOSTS` are exact-match allowlists. The three stable
`*.pages.dev` aliases are listed; per-build preview hostnames are random and cannot be,
so a preview's form is refused with `origin_not_allowed`. Restrict previews with
Cloudflare Access rather than trying to allowlist them.

When the API is unreachable the form surfaces an honest error/offline state rather than
pretending the submit succeeded.
