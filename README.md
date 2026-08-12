# reversealignment.ai

Static multilingual rendering of Reverse Alignment. Traditional Chinese stays the
default multi-locale build at `/`. English is the official apex deployment on
`reversealignment.ai` (`SITE_LOCALE=en`), matching Japanese on `reversealignment.jp`.
Spanish and Brazilian Portuguese remain self-contained subpaths on the zh-TW host.
Each whole-domain locale runs its own Access-gated join form at `/join/`.

| Path / host                   | Locale                         |
| ----------------------------- | ------------------------------ |
| `/` on reversealignment.tw    | `zh-tw` (default multi-locale) |
| `/en/` on reversealignment.tw | `en` preview tree (noindex)    |
| `/es/`                        | `es`                           |
| `/pt-BR/`                     | `pt-br`                        |
| reversealignment.ai           | `en` (`SITE_LOCALE=en`)        |
| reversealignment.jp           | `ja` (`SITE_LOCALE=ja`)        |
| `<any live domain>`/join/     | Access-gated join form         |

The coalition directory server-renders the fixed founding catalog from `src/data/content.json` (25 people with first-party portraits) as its offline baseline. After first paint, `CoalitionDirectory` fetches published community members from `GET https://join.reversealignment.tw/api/members`—the single source of truth backed by Cloudflare D1 through the Worker—and hydrates them client-side as monogram cards. Founding cards win on ID collision, and sector controls appear as the roster grows. Directory labels and sort options are translated per locale.

### What is static vs live

- **Static on every locale:** page copy, the founding 25-person catalog, client-side directory search/filter/sort UI, and brochure sections. Without the Worker, the directory remains at its founding baseline.
- **Live Worker API (`join.reversealignment.tw`):** the exclusive community roster, Access-gated join at `/join/` on every live locale, optional portrait upload, and admin moderation. Returning joiners are matched by an HMAC of their Access-verified email.
- **Brochure surface (every locale):** the homepage always uses `join.mode === "cta"`; the live form lives only on that deployment's `/join/` page. `es` and `pt-br` have no join page and link to the English one.

## Setup

```bash
vp install
```

On this machine the homebrew `vp` binary is broken (`Failed to download Node.js runtime`). Use the project binary instead: `node_modules/.bin/vp …`.

## Build

```bash
# Default zh-TW build at dist/
vp run build

# zh-TW root plus English, Spanish, and Brazilian Portuguese subpaths
vp run build:all

# Official English single-locale deployment (reversealignment.ai)
vp run build:en

# Official Japanese single-locale deployment (reversealignment.jp)
vp run build:ja
```

`build:all` produces isolated asset trees at `dist/`, `dist/en/`, `dist/es/`, and `dist/pt-BR/`.
`build:en` / `build:ja` emit a single-locale root tree for their dedicated Pages projects
(`SITE_DEPLOYED_URL` makes that root indexable and self-hosted).

The English join form’s API base is set at build time via `PUBLIC_API_BASE`, and any build meant to reach a live Worker must set it — the deployed Worker is API-only, so nothing serves a same-origin page. Unset means same-origin `/api`, which is for `scripts/join-live-e2e.sh` only. See [Hosting honesty](#hosting-honesty).

## Checks

```bash
vp check
vp run test:unit
vp run build:all
vp run lint:html
vp run test:e2e
```

Worker-focused checks (do not need a full site build):

```bash
vp run test:worker
vp run test:worker:smoke
```

Full-stack join check — real browser against a real Worker with D1 and R2, using its own
isolated database and a free port:

```bash
vp run build:all
vp run test:e2e:live
```

`tests/e2e/join-live.e2e.ts` skips itself unless `E2E_LIVE_API=1`, so the default
`test:e2e` run stays a pure static-`dist` suite.

## Structure

- `src/data/content.json` — localized page copy, asset mappings, fixed founding coalition cohort, translated directory controls, and per-locale join mode/CTA/form copy.
- The member roster lives exclusively in Cloudflare D1/R2 and is never committed to the repository.
- `src/components/HomePage.astro` — page rendering.
- `src/components/CoalitionDirectory.astro` — founding SSR cards plus client-side community hydration, filters, and motion.
- `src/components/JoinForm.astro` — English live join UI (Access session + optional in-browser photo step).
- `src/lib/directory.ts` — deterministic search, filtering, sorting, and community/API merge helpers.
- `src/lib/halftone.ts` + `src/workers/halftone.worker.ts` — in-browser portrait filter used by the join form.
- `worker/` — Cloudflare Worker + D1 (+ optional R2 portraits) for `/api/*`.
- `scripts/build-all-locales.sh` — locale isolation builds and subpath assembly.

## Live join backend

Mounted at `/join/` on **every whole-domain deployment** — `reversealignment.ai`, `reversealignment.tw`, and `reversealignment.jp` — where Cloudflare Access gates `/join/*` while the brochure stays public. Spanish and Brazilian Portuguese are brochure-only and link their CTA to the English form. The zh-TW build also emits the English copy at `/en/join/`; that copy bounces to its own canonical URL, so a visitor can only ever submit from the deployment that owns the form.

### Local full stack

```bash
vp install
cp .dev.vars.example .dev.vars   # local secrets; never commit
vp run db:migrate:local
vp run dev:api                   # Worker API on :8787 — /api/* only, no pages
```

Then, in a second shell, run the site pointed at that API. This mirrors production,
where the page and the API are always different origins:

```bash
PUBLIC_API_BASE=http://127.0.0.1:8787 vp run dev      # Astro on :4321
```

`.dev.vars.example` already lists `http://127.0.0.1:4321` in `ALLOWED_ORIGINS`, so the
cross-origin POST and its preflight both pass. `vp run dev` alone still serves the
brochure locales; only the English form needs the API.

Useful scripts (see `package.json`):

| Script                     | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `vp run dev:api`           | `wrangler dev` — the `/api/*` Worker, no pages |
| `vp run db:migrate:local`  | apply D1 migrations to the local DB            |
| `vp run test:worker`       | focused Worker unit tests                      |
| `vp run test:worker:smoke` | end-to-end Worker lifecycle smoke              |
| `vp run test:e2e:live`     | browser + Worker + D1 + R2 join flow, isolated |
| `vp run types:worker`      | regenerate `worker-configuration.d.ts`         |

With `DEMO_INBOX=true` locally, verification codes appear in the JSON response. Production must use `DEMO_INBOX=false`, real email, Turnstile, and admin token.

### Provisioning (Cloudflare)

```bash
wrangler d1 create reversealignment-coalition
wrangler r2 bucket create reversealignment-portraits
wrangler secret put AUTH_PEPPER
wrangler secret put TURNSTILE_SECRET
wrangler secret put ADMIN_TOKEN
```

- **D1** (`reversealignment-coalition`) holds join challenges and member rows.
- **R2** (`reversealignment-portraits`, binding `PORTRAITS`) stores verified portraits under content-addressed keys. If the R2 binding is absent, join still works and members fall back to the generated monogram.
- **Secrets:** `AUTH_PEPPER` (HMAC pepper, ≥16 chars), `TURNSTILE_SECRET`, `ADMIN_TOKEN` (HTTP moderation API).

Bind the D1 database and R2 bucket in `wrangler.jsonc`, then deploy the Worker separately from the static Pages publish.

### Turnstile

The English join form carries one Turnstile widget, placed outside both step forms so
resend can read a fresh token. Three values must agree or every submit is refused:

| Where                                                  | Value                                                             | Effect if wrong                                                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_TURNSTILE_SITE_KEY` (build env, repo variable) | public site key                                                   | unset ⇒ no widget and no `api.js` at all; the form still submits and the Worker refuses it when `TURNSTILE_REQUIRED=true` |
| `TURNSTILE_SECRET` (Worker secret)                     | secret key for that same widget                                   | unset ⇒ `turnstile_not_configured`; wrong ⇒ `invalid-input-secret`                                                        |
| `TURNSTILE_EXPECTED_ACTION` (var)                      | must equal the div's `data-action`, currently `turnstile-spin-v2` | mismatch ⇒ `turnstile_bad_action` on every request                                                                        |

`TURNSTILE_EXPECTED_HOSTNAME` is a comma-separated allowlist of every hostname that may
_render_ the widget — siteverify reports the page's hostname, so an iframe embed must list
the embed origin, not just the site that frames it. Widget domains in the Cloudflare
dashboard must cover the same set.

The secret is read from the Worker `env` binding (`env.TURNSTILE_SECRET`), never
`process.env` — workerd has no Node process object in the request path. `tests/unit/turnstile-contract.test.ts`
pins the widget action to `TURNSTILE_EXPECTED_ACTION` and asserts the siteverify body shape.

### In-browser photo filter

The English join form can accept an optional portrait. Processing runs entirely in the visitor’s browser (`src/lib/halftone.ts` + `src/workers/halftone.worker.ts`): only the halftone-processed WebP/PNG is uploaded, the original never leaves the device, and the Worker stages bytes on the challenge row until email verification succeeds. After verify, the portrait is written to R2 under a content-addressed key (`portraits/<sha256>.<webp|png>`) and exposed as `/api/portrait/<sha>.<ext>`.

### Security / privacy defaults (worker)

- Access-verified email stored privately in full, alongside its HMAC hash + domain; returned only by the authenticated moderation API, never by public APIs.
- Contribution, statement, links, IP hashes, moderation notes stay private.
- Avatars: local PNGs when a portrait asset exists; optional verified halftone upload after email confirm; otherwise a first-party monogram from the display name — no Gravatar.
- AI moderation is recommendation-only and fail-closed: every join stays `pending_review` until a human publishes or rejects.
- Public directory queries always use `status = 'published'`.

### Hosting honesty

The two halves are deployed separately and neither can stand in for the other:

| Surface                                | Deployed by                           | Serves                                            |
| -------------------------------------- | ------------------------------------- | ------------------------------------------------- |
| Cloudflare Pages `reversealignment-ai` | its own build on every push to `main` | zh-TW multi-locale HTML (`bun run build:all`)     |
| Cloudflare Pages `reversealignment-en` | its own build on every push to `main` | English apex HTML (`SITE_LOCALE=en`, `vp build`)  |
| Cloudflare Pages `reversealignment-jp` | its own build on every push to `main` | Japanese apex HTML (`SITE_LOCALE=ja`, `vp build`) |
| Worker `join.reversealignment.tw`      | `wrangler deploy`, by hand            | `/api/*` plus Access join POST on `/join/api`     |

`reversealignment.tw` is served by the **Cloudflare Pages** project
`reversealignment-ai`, which builds this repo itself (`bun install --frozen-lockfile &&
bun run build:all`). `reversealignment.ai` is served by **`reversealignment-en`** with
`SITE_LOCALE=en` and `SITE_DEPLOYED_URL=https://reversealignment.ai`, the same pattern as
`reversealignment-jp` / `SITE_LOCALE=ja`. GitHub Pages is not involved: the repo has no
CNAME, and the `deploy.yml` workflow that used to publish there was deleted because
`audreyt.github.io/reversealignment.ai/` 404s — it spent CI minutes producing an
artifact nobody served, and worse, it was the only build that set the public
variables, so the build that _is_ live shipped without them.

The Worker binds **no static assets**: anything that is not an `/api/*` route returns
`{"error":"not_found"}` with status 404. That is deliberate. It previously served a
copy of `dist/`, which went stale on every push that did not also run
`wrangler deploy` — at one point publishing an English join form with no Turnstile
widget, which fails closed on every submit. One page, one owner.

So the English form is always cross-origin to its API, and `PUBLIC_API_BASE` is
**required** for any build that must reach a live Worker
(`https://join.reversealignment.tw`). Leaving it unset yields same-origin `/api`, which
is only useful for `scripts/join-live-e2e.sh`, where `wrangler dev --assets dist` puts
a page and the API on one origin for the duration of the test. Add every origin that
may post to the Worker to `ALLOWED_ORIGINS`.

Preview deployments get a random hostname per build, and both gates are exact-match
allowlists, so a preview's form is refused with `origin_not_allowed` even when keyed.
Only the stable aliases could ever be listed. Restrict previews with Cloudflare Access
rather than trying to allowlist them.

When the API is unreachable, the form surfaces an honest error/offline state rather
than pretending the submit succeeded.
