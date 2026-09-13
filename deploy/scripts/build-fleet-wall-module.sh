#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/dist/fleet-wall}"
VERSION="$(tr -d '\r\n' < "$ROOT/VERSION")"
WORK="$OUT/work"
PKG="$WORK/fleet-wall"
rm -rf "$WORK"; mkdir -p "$PKG/device-agent" "$PKG/lib" "$PKG/gateway" "$OUT"
cp "$ROOT/device-agent/fleet-wall-runtime.mjs" "$PKG/device-agent/"
cp "$ROOT/device-agent/local-wall-auth.mjs" "$PKG/device-agent/"
cp "$ROOT/lib/device-proof.mjs" "$PKG/lib/"
cp "$ROOT/gateway/dashboard.mjs" "$PKG/gateway/"
cp "$ROOT/gateway/device-policy-page.mjs" "$PKG/gateway/"
cp "$ROOT/gateway/brand.mjs" "$PKG/gateway/"
cat > "$PKG/manifest.json" <<JSON
{
  "component": "fleet-wall",
  "version": "$VERSION",
  "universal": true,
  "runtime": "node>=22",
  "port": 5492
}
JSON
ART="$OUT/Light-Remote-Fleet-Wall-${VERSION}.tar.gz"
tar -czf "$ART" -C "$WORK" fleet-wall
SHA="$(sha256sum "$ART" | awk '{print $1}')"
SIZE="$(stat -c %s "$ART")"
cat > "$OUT/fleet-wall-module-metadata.json" <<JSON
{
  "schemaVersion": 1,
  "component": "fleet-wall",
  "version": "$VERSION",
  "artifact": {
    "filename": "$(basename "$ART")",
    "sha256": "$SHA",
    "size": $SIZE
  }
}
JSON
rm -rf "$WORK"
printf '%s  %s\n' "$SHA" "$(basename "$ART")" > "$OUT/SHA256SUMS.txt"
echo "fleet-wall-module-build=PASS version=$VERSION size=$SIZE sha256=$SHA"
