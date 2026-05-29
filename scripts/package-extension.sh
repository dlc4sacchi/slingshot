#!/usr/bin/env bash
# Build a flat-root zip for Chrome Web Store / Firefox AMO / "Load unpacked".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VER="$(node -e "console.log(JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version)")"
OUT="slingshot_V${VER}.zip"

for p in manifest.json background-entry.js background.js storage.js pages scripts telemetry icons; do
  if [[ ! -e "$p" ]]; then
    echo "Missing required path: $p" >&2
    exit 1
  fi
done

rm -f "$OUT"
zip -r -q "$OUT" \
  manifest.json \
  background-entry.js \
  background.js \
  storage.js \
  pages \
  scripts \
  telemetry \
  icons \
  -x ".git/*" \
  -x ".cursor/*" \
  -x "docs/*" \
  -x "docs/**/*" \
  -x "README.md" \
  -x "SOURCE-LICENSE.md" \
  -x "*.sql" \
  -x "scripts/**/*.sql" \
  -x "scripts/package-extension.sh" \
  -x "scripts/generate_screenshots.py" \
  -x "pages/promo-tiles.html"

echo "Wrote $ROOT/$OUT"
