#!/bin/bash
# Build each deployed locale in isolation, then place the self-contained trees
# under their public paths. zh-TW remains the root/default deployment.
set -euo pipefail

rm -rf dist dist_en dist_es dist_pt_br

# English also ships as its own apex deployment (SITE_LOCALE=en → reversealignment.ai),
# matching reversealignment-jp. Keep a self-contained /en/ tree here so the zh-TW
# host can still deep-link the English preview.
SITE_LOCALE=en vp build
mv dist dist_en

SITE_LOCALE=es vp build
mv dist dist_es

SITE_LOCALE=pt-br vp build
mv dist dist_pt_br

vp build

rm -rf dist/en dist/es dist/pt-BR
mv dist_en dist/en
mv dist_es dist/es
mv dist_pt_br dist/pt-BR

# zh-TW and English both run a live join form, so dist/join and dist/en/join both
# ship. Spanish and Brazilian Portuguese are brochure-only and link out to a live
# locale, so drop the join pages their builds also emit.
rm -rf dist/es/join dist/pt-BR/join

test -f dist/index.html
test -f dist/en/index.html
test -f dist/es/index.html
test -f dist/pt-BR/index.html
test -f dist/join/index.html
test -f dist/en/join/index.html
test -f dist/join/manage/index.html
test -f dist/en/join/manage/index.html

# The event page is the landing surface for the 29 Aug 2026 talk in every
# locale, including the brochure-only ones that have no join form to ship.
test -f dist/events/you-are-here/index.html
test -f dist/en/events/you-are-here/index.html
test -f dist/es/events/you-are-here/index.html
test -f dist/pt-BR/events/you-are-here/index.html
test ! -e dist/es/join
test ! -e dist/pt-BR/join
test ! -e dist/en/en
test ! -e dist/en/en/index.html
test -f dist/en/assets/css/main.css
test -f dist/es/assets/css/main.css
test -f dist/pt-BR/assets/css/main.css

echo "✓ Multi-locale build complete: dist/ (zh-tw), dist/en/ (en), dist/es/ (es), dist/pt-BR/ (pt-br)"
