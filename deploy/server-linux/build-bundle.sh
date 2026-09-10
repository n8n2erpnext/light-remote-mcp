#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="$(cat "$ROOT_DIR/VERSION")"
NODE_VERSION="${NODE_VERSION:-22.23.2}"
TARGET_ARCH="${1:-$(uname -m)}"
case "$TARGET_ARCH" in
  x64|x86_64|amd64) TARGET_ARCH=x64 ;;
  arm64|aarch64) TARGET_ARCH=arm64 ;;
  *) echo "Unsupported target architecture: $TARGET_ARCH" >&2; exit 2 ;;
esac
OUT="${OUT_DIR:-$ROOT_DIR/dist/server-linux/$TARGET_ARCH}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PKG="$WORK/package"
mkdir -p "$PKG/runtime" "$PKG/licenses/node" "$PKG/deploy/scripts"

cd "$WORK"
NODE_TAR="node-v${NODE_VERSION}-linux-${TARGET_ARCH}.tar.xz"
curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TAR}"
grep "  ${NODE_TAR}$" SHASUMS256.txt | sha256sum -c -
tar -xJf "$NODE_TAR"
install -m 0755 "node-v${NODE_VERSION}-linux-${TARGET_ARCH}/bin/node" "$PKG/runtime/node"
cp "node-v${NODE_VERSION}-linux-${TARGET_ARCH}/LICENSE" "$PKG/licenses/node/LICENSE"
cp -a "$ROOT_DIR/operator-host" "$PKG/operator-host"
cp -a "$ROOT_DIR/gateway" "$PKG/gateway"
cp -a "$ROOT_DIR/lib" "$PKG/lib"
cp "$ROOT_DIR/deploy/scripts/generate-operator-key.mjs" "$PKG/deploy/scripts/"
cp "$ROOT_DIR/deploy/scripts/generate-wall-auth.mjs" "$PKG/deploy/scripts/"
cp "$ROOT_DIR/deploy/server-linux/install.sh" "$PKG/install.sh"
chmod 0755 "$PKG/install.sh"
for f in LICENSE NOTICE VERSION THIRD_PARTY_DISTRIBUTION_NOTICES.md PRODUCT_ARCHITECTURE_ROADMAP_V0_9_BETA_TO_PLUGIN.md; do
  cp "$ROOT_DIR/$f" "$PKG/$f"
done
cat > "$PKG/manifest.json" <<EOF
{
  "product": "Light Remote MCP Server Linux ${TARGET_ARCH}",
  "version": "$VERSION",
  "node": "v$NODE_VERSION",
  "platform": "linux-$TARGET_ARCH",
  "gitSha": "$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)",
  "builtAtUtc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
mkdir -p "$OUT"
ARCHIVE="Light-Remote-MCP-Server-Linux-${TARGET_ARCH}-${VERSION}.tar.gz"
tar -czf "$OUT/$ARCHIVE" -C "$WORK" package
(cd "$OUT" && sha256sum "$ARCHIVE" > SHA256SUMS.txt)
echo "server_bundle=$OUT/$ARCHIVE"
echo "server_bundle_sha256=$(cut -d' ' -f1 "$OUT/SHA256SUMS.txt")"
