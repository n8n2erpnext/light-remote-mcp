#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="$(cat "$ROOT_DIR/VERSION")"
OUT="${OUT_DIR:-$ROOT_DIR/dist/vercel}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PKG="$WORK/light-remote-mcp-vercel"
mkdir -p "$PKG"
cp -a "$ROOT_DIR/api" "$PKG/api"
cp -a "$ROOT_DIR/lib" "$PKG/lib"
cp "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" "$PKG/"
printf '%s\n' '{"currentKid":"","keys":{}}' > "$PKG/operator-public-keys.json"
cp "$ROOT_DIR/LICENSE" "$ROOT_DIR/NOTICE" "$ROOT_DIR/VERSION" "$PKG/"
cp "$ROOT_DIR/deploy/vercel/README.md" "$PKG/DEPLOY.md"
cat > "$PKG/vercel.json" <<EOF
{
  "version": 2,
  "functions": {
    "api/*.js": { "maxDuration": 30 }
  }
}
EOF
mkdir -p "$OUT"
ARCHIVE="Light-Remote-MCP-Vercel-Bridge-${VERSION}.tar.gz"
tar -czf "$OUT/$ARCHIVE" -C "$WORK" light-remote-mcp-vercel
(cd "$OUT" && sha256sum "$ARCHIVE" > SHA256SUMS.txt)
echo "vercel_bundle=$OUT/$ARCHIVE"
echo "vercel_bundle_sha256=$(cut -d' ' -f1 "$OUT/SHA256SUMS.txt")"
