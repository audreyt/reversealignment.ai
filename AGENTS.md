# Working in this repo

Everything here is a decision you cannot recover by reading the code, or a place
where the obvious action is the wrong one. Anything discoverable from
`package.json`, `wrangler.jsonc`, or one grep is deliberately absent.

## Invariants

**No respondent PII enters Git.** Member rows live in D1, portraits in R2. No
roster snapshot, seed file, or import migration is committed. If a task seems to
need one, it is the wrong task.

**`worker/migrations` skips `0007`–`0010` on purpose.** Those were the one-time
spreadsheet import and its follow-ups; they carried respondent names and salted
email hashes and were deleted when the roster became D1-only. They are already
applied in production, and D1 tracks applied migrations by filename, so the gap
is inert. **Renumbering to close it resurrects deleted PII.** Never close it.

**AI moderation is recommendation-only and fail-closed.** Every join stays
`pending_review` until a human publishes or rejects. Public queries always filter
`status = 'published'`.

**An empty `ACCESS_AUD` fails closed** — every join returns 401. This value is
dangerous when absent, not when disclosed; it is a public Access audience tag,
not a secret.

## Traps

**The join API path is page-relative on purpose.** The form posts `api`, and the
entry manager posts `../api/me`. An absolute `/join/api` looks equivalent and
silently breaks the zh-TW host's `/en/join/` preview, which would then post
across hosts to the English apex. Never convert these to absolute paths.

**`es` and `pt-BR` join copy is dead data.** Both set `join.form.mode ===
"cta-only"`, and `scripts/build-all-locales.sh` deletes their `/join` output. Keep
their strings at parity, but never verify them by looking for rendered output.

**There is no `dev` script, deliberately.** For brochure iteration:
`vp run build:all && bunx serve -l 4321 --no-clipboard dist`. The join form needs a
Worker on the same origin, so use `vp run test:e2e:live` instead of a static preview.

**`test:e2e:live` requires `build:en`, not `build:all`.** The live suite drives the
English deployment shape, where `/join/` sits at the dist root same-origin with
`/join/api`. A multi-locale `dist` puts it under `/en/` and the suite fails
confusingly.

**e2e navigation uses paths relative to Playwright's `baseURL`** (`/en/join/manage/`),
never the absolute production URLs. Those constants exist only for asserting
redirect targets. Navigating the `/en/` tree is also what proves `../api/me`
resolves correctly.

**`lint:html` has a hardcoded page list in `package.json`.** A new page is never
validated until you add it there.

**Portrait keys are content-addressed** (`portraits/<sha256>.<webp|png>`), so two
members who uploaded identical bytes share one R2 object. Deletion must refuse
while another row still points at the key, and must never touch a canonical asset
key. `isPortraitKey` requires exactly 64 lowercase hex — short fixture keys
silently skip the R2 branch.

**Self-service edits may not touch `contribution` or `status`.** `contribution`
drives `classifyJoinIntent`; accepting it would let a member promote themselves out
of `updates_only` into the directory with no human review.

**Deliberate 404s that look like bugs:** `/join/api` on `join.reversealignment.tw`
and on `workers.dev`; the legacy `/api/join*` paths. The Worker also binds **no
static assets** — it once served a copy of `dist/` that went stale on every push
without a `wrangler deploy`. One page, one owner.

**Per-build preview hostnames cannot be allowlisted.** `ALLOWED_ORIGINS` and
`JOIN_API_HOSTS` are exact-match; random preview hosts are refused with
`origin_not_allowed`. Restrict previews with Cloudflare Access instead.

**`PUBLIC_API_BASE` and `PUBLIC_TURNSTILE_SITE_KEY` are vestigial repo variables.**
Nothing reads them. Do not wire them up.

## Facts that live outside the repo

**Cloudflare Access matches `/join/` as a prefix**, and gates before Pages resolves
whether a route exists. A new page under `/join/` inherits the OTP with no Access
or dashboard change. Verify with the `Location` header, not the body:

```bash
curl -sD- https://reversealignment.ai/join/anything/ | grep -i location
```

The apex answers **302 with a ~143-byte body**, so grepping the body for
`cloudflareaccess` fails to detect the gate. The `*.pages.dev` alias is the only way
to read the deployed HTML of an Access-gated path.

**Cloudflare Pages reports builds as GitHub check runs, not deployments.** The
deployments and environments APIs both return empty, which reads as "not linked"
and is wrong. The authoritative query:

```bash
gh api repos/audreyt/reversealignment.ai/commits/<sha>/check-runs
```

Pages deploys do not wait on the CI e2e job.

**Bindings are load-bearing by name:** `env.DB` (D1) and `env.PORTRAITS` (R2). If
R2 is absent, join still succeeds and the member falls back to a monogram.

**`IMPORT_SALT`** exists to recognize members imported before the join flow, whose
rows carry `import:` hashes. **`AUTH_PEPPER`** is the HMAC pepper for email hashes.

## Why the schema looks like this

`0006` dropped `join_challenges` — Access verifies identity before submit, so there
is nothing to stage, and no emailed code or CAPTCHA exists anywhere in the flow.
`0011` added `updates_only`, keeping non-directory join intents out of the human
moderation queue. `0012` added the private verified-email column, returned only by
the authenticated moderation API.

## Why `/en/` on the zh-TW host is noindex

`localizedUrls` in `src/data/site.json` gives a locale's canonical home;
`deployedUrls` gives the origin actually serving it. `isIndexableLocale` derives
indexability from that pair with one rule: **anything served from a subpath is a
preview of a site that lives elsewhere**, so it must not compete with the original.
The same locale on its own apex is indexable. Do not "fix" the noindex.
