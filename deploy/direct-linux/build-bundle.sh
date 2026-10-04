#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="$(tr -d '\r\n' < "$ROOT_DIR/VERSION")"
GIT_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
SHORT_SHA="${GIT_SHA:0:8}"
NODE_VERSION="${NODE_VERSION:-22.23.2}"
TARGET_ARCH="${1:-$(uname -m)}"
case "$TARGET_ARCH" in
  x64|x86_64|amd64) TARGET_ARCH=x64 ;;
  arm64|aarch64) TARGET_ARCH=arm64 ;;
  *) echo "Unsupported target architecture: $TARGET_ARCH" >&2; exit 2 ;;
esac
OUT="${OUT_DIR:-$ROOT_DIR/dist/direct-linux/$TARGET_ARCH}"
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
cp -a "$ROOT_DIR/assets" "$PKG/assets"
cp -a "$ROOT_DIR/plugin-server" "$PKG/plugin-server"
cp "$ROOT_DIR/plugin.json" "$PKG/plugin.json"
cp "$ROOT_DIR/mcp.json" "$PKG/mcp.json"
mkdir -p "$PKG/.codex-plugin"
cp "$ROOT_DIR/.codex-plugin/plugin.json" "$PKG/.codex-plugin/plugin.json"
rm -rf "$PKG/plugin-server/node_modules"
npm ci --omit=dev --ignore-scripts --prefix "$PKG/plugin-server" --no-audit --no-fund
node "$ROOT_DIR/deploy/scripts/stage-terminal-runtime.mjs" "$PKG" linux "$TARGET_ARCH"
mkdir -p "$PKG/device-agent"
cp -a "$ROOT_DIR/device-agent/platform-adapters" "$PKG/device-agent/platform-adapters"
cp "$ROOT_DIR/deploy/scripts/generate-operator-key.mjs" "$PKG/deploy/scripts/"
cp -a "$ROOT_DIR/deploy/direct-linux" "$PKG/deploy/direct-linux"

for f in LICENSE NOTICE VERSION CLIENT_COMPATIBILITY_FLOOR THIRD_PARTY_DISTRIBUTION_NOTICES.md; do
  cp "$ROOT_DIR/$f" "$PKG/$f"
done
cat > "$PKG/manifest.json" <<EOF
{
  "product": "Light Remote Direct MCP Linux ${TARGET_ARCH}",
  "version": "$VERSION",
  "gitSha": "$GIT_SHA",
  "node": "v$NODE_VERSION",
  "platform": "linux-${TARGET_ARCH}",
  "transport": "direct-mcp",
  "publicOrigin": "https://light-remote.thaiduy.digital",
  "mcpResource": "https://light-remote.thaiduy.digital/mcp",
  "builtAtUtc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

test ! -e "$PKG/operator.private.json"
test ! -e "$PKG/plugin-oauth-secret"
find "$PKG" -type f -name '*.key' -print -quit | grep -q . && { echo "private_key_like_file_in_bundle" >&2; exit 1; } || true

mkdir -p "$OUT"
ARCHIVE="Light-Remote-Direct-Linux-${TARGET_ARCH}-${VERSION}-${SHORT_SHA}.tar.gz"
tar -czf "$OUT/$ARCHIVE" -C "$WORK" package
(cd "$OUT" && sha256sum "$ARCHIVE" > SHA256SUMS.txt)
echo "direct_bundle=$OUT/$ARCHIVE"
echo "direct_bundle_sha256=$(cut -d' ' -f1 "$OUT/SHA256SUMS.txt")"
echo "direct_bundle_git_sha=$GIT_SHA"
