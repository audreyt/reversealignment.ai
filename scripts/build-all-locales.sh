#!/bin/bash
# Build all locale deployments into a single dist/ directory.
# The default locale (zh-tw) is built into dist/ root;
# subpath locales are built in isolation then moved into dist/<path>/.
set -euo pipefail

# Clean any previous output
rm -rf dist dist_es dist_pt_br

# Build subpath locales first (each vp build wipes dist/)
SITE_LOCALE=es vp build
mv dist dist_es

SITE_LOCALE=pt-br vp build
mv dist dist_pt_br

# Build the default locale last (stays in dist/)
vp build

# Merge subpath builds into the main dist/
mv dist_es dist/es
mv dist_pt_br dist/pt-BR

# Verify structure
test -f dist/index.html
test -f dist/es/index.html
test -f dist/pt-BR/index.html

echo "✓ Multi-locale build complete: dist/ (zh-tw), dist/es/ (es), dist/pt-BR/ (pt-br)"
