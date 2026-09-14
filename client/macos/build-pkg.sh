#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUNDLE="${1:-}"; OUT="${2:-$ROOT_DIR/dist/macos/pkg}"
[[ "$(uname -s)" == Darwin ]] || { echo 'build-pkg.sh must run on macOS' >&2; exit 2; }
[[ -f "$BUNDLE" ]] || { echo 'Usage: build-pkg.sh <client-package.tar.gz> [output-dir]' >&2; exit 2; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/extract"; tar -xzf "$BUNDLE" -C "$TMP/extract"
PKG="$TMP/extract/package"
[[ -f "$PKG/manifest.json" && -x "$PKG/runtime/node" && -x "$PKG/tray/LightRemoteTray" ]] || { echo 'invalid macOS client bundle' >&2; exit 2; }
read -r VERSION PLATFORM < <(python3 - "$PKG/manifest.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); print(m['version'],m['platform'])
PY
)
case "$PLATFORM" in macos-x64) ARCH=x86_64;; macos-arm64) ARCH=arm64;; *) echo "unsupported platform: $PLATFORM" >&2; exit 2;; esac
ROOT_STAGE="$TMP/root"; SCRIPTS="$TMP/scripts"; APP_ROOT="$ROOT_STAGE/Library/Application Support/Light Remote"
mkdir -p "$APP_ROOT/releases/$VERSION" "$APP_ROOT/update-runtime" "$ROOT_STAGE/Library/LaunchAgents" "$ROOT_STAGE/Library/LaunchDaemons" "$SCRIPTS" "$OUT"
cp -a "$PKG/." "$APP_ROOT/releases/$VERSION/"
cp "$ROOT_DIR/client/update-public.pem" "$APP_ROOT/update-public.pem"
cp "$ROOT_DIR/client/macos/launchd/com.lightremote.agent.plist" "$ROOT_STAGE/Library/LaunchAgents/"
cp "$ROOT_DIR/client/macos/launchd/com.lightremote.tray.plist" "$ROOT_STAGE/Library/LaunchAgents/"
cp "$ROOT_DIR/client/macos/launchd/com.lightremote.updater.plist" "$ROOT_STAGE/Library/LaunchDaemons/"
cat > "$SCRIPTS/postinstall" <<POST
#!/bin/bash
set -e
ROOT='/Library/Application Support/Light Remote'
ln -sfn "\$ROOT/releases/$VERSION" "\$ROOT/current.next"
mv -f "\$ROOT/current.next" "\$ROOT/current"
if [[ ! -x "\$ROOT/updater/current/runtime/node" ]]; then
  HELPER="\$ROOT/updater/releases/$VERSION"
  mkdir -p "\$HELPER/runtime" "\$HELPER/client/macos" "\$HELPER/lib"
  cp "\$ROOT/releases/$VERSION/runtime/node" "\$HELPER/runtime/node"
  cp "\$ROOT/releases/$VERSION/client/macos/updater.mjs" "\$ROOT/releases/$VERSION/client/macos/update-lifeboat.mjs" "\$HELPER/client/macos/"
  cp "\$ROOT/releases/$VERSION/lib/update-contract.mjs" "\$HELPER/lib/update-contract.mjs"
  cp "\$ROOT/releases/$VERSION/manifest.json" "\$HELPER/manifest.json"
  ln -sfn "\$HELPER" "\$ROOT/updater/current.next"
  mv -f "\$ROOT/updater/current.next" "\$ROOT/updater/current"
fi
chown -R root:wheel "\$ROOT"
chmod -R go-w "\$ROOT"
launchctl bootout system/com.lightremote.updater >/dev/null 2>&1 || true
launchctl bootstrap system /Library/LaunchDaemons/com.lightremote.updater.plist >/dev/null 2>&1 || true
launchctl enable system/com.lightremote.updater >/dev/null 2>&1 || true
USER_NAME="\$(stat -f '%Su' /dev/console 2>/dev/null || true)"
if [[ -n "\$USER_NAME" && "\$USER_NAME" != root && "\$USER_NAME" != loginwindow ]]; then
  UID_NUM="\$(id -u "\$USER_NAME")"
  GROUP_NAME="\$(id -gn "\$USER_NAME")"
  mkdir -p "\$ROOT/update-runtime"
  chown "\$USER_NAME:\$GROUP_NAME" "\$ROOT/update-runtime"
  chmod 700 "\$ROOT/update-runtime"
  for LABEL in com.lightremote.agent com.lightremote.tray; do
    launchctl asuser "\$UID_NUM" launchctl bootout "gui/\$UID_NUM/\$LABEL" >/dev/null 2>&1 || true
    launchctl asuser "\$UID_NUM" launchctl bootstrap "gui/\$UID_NUM" "/Library/LaunchAgents/\$LABEL.plist" >/dev/null 2>&1 || true
    launchctl asuser "\$UID_NUM" launchctl enable "gui/\$UID_NUM/\$LABEL" >/dev/null 2>&1 || true
    launchctl asuser "\$UID_NUM" launchctl kickstart -k "gui/\$UID_NUM/\$LABEL" >/dev/null 2>&1 || true
  done
fi
exit 0
POST
chmod 0755 "$SCRIPTS/postinstall"
IDENT="com.lightremote.client.${PLATFORM}"
pkgbuild --root "$ROOT_STAGE" --scripts "$SCRIPTS" --identifier "$IDENT" --version "$VERSION" --install-location / "$OUT/Light-Remote-${VERSION}-${ARCH}.pkg"
echo "Built $OUT/Light-Remote-${VERSION}-${ARCH}.pkg"
