#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUNDLE="${1:-}"; OUT="${2:-$ROOT_DIR/dist/macos/pkg}"
[[ "$(uname -s)" == Darwin ]] || { echo 'build-pkg.sh must run on macOS' >&2; exit 2; }
[[ -f "$BUNDLE" ]] || { echo 'Usage: build-pkg.sh <client-package.tar.gz> [output-dir]' >&2; exit 2; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/extract"; tar -xzf "$BUNDLE" -C "$TMP/extract"
PKG="$TMP/extract/package"
[[ -f "$PKG/manifest.json" && -x "$PKG/runtime/node" && -x "$PKG/tray/LightRemoteTray" && -x "$PKG/tray/LightRemoteLauncher" ]] || { echo 'invalid macOS client bundle' >&2; exit 2; }
read -r VERSION PLATFORM < <(python3 - "$PKG/manifest.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); print(m['version'],m['platform'])
PY
)
case "$PLATFORM" in macos-x64) ARCH=x86_64;; macos-arm64) ARCH=arm64;; *) echo "unsupported platform: $PLATFORM" >&2; exit 2;; esac
SHORT_VERSION="${VERSION%%-*}"; BUILD_VERSION="$(printf '%s' "$VERSION" | sed -nE 's/.*-rc\.([0-9]+).*/\1/p')"; BUILD_VERSION="${BUILD_VERSION:-1}"
ROOT_STAGE="$TMP/root"; SCRIPTS="$TMP/scripts"; APP_ROOT="$ROOT_STAGE/Library/Application Support/Light Remote"
APP="$ROOT_STAGE/Applications/Light Remote.app"
mkdir -p "$APP_ROOT/releases/$VERSION" "$APP_ROOT/update-runtime" "$ROOT_STAGE/Library/LaunchAgents" "$ROOT_STAGE/Library/LaunchDaemons" "$APP/Contents/MacOS" "$APP/Contents/Resources" "$SCRIPTS" "$OUT"
cp -a "$PKG/." "$APP_ROOT/releases/$VERSION/"
cp "$ROOT_DIR/client/update-public.pem" "$APP_ROOT/update-public.pem"
cp "$ROOT_DIR/client/macos/launchd/com.lightremote.agent.plist" "$ROOT_STAGE/Library/LaunchAgents/"
cp "$ROOT_DIR/client/macos/launchd/com.lightremote.tray.plist" "$ROOT_STAGE/Library/LaunchAgents/"
cp "$ROOT_DIR/client/macos/launchd/com.lightremote.updater.plist" "$ROOT_STAGE/Library/LaunchDaemons/"
cp "$ROOT_DIR/client/macos/uninstall.sh" "$APP/Contents/Resources/uninstall.sh"
chmod 0755 "$APP/Contents/Resources/uninstall.sh"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Light Remote</string>
<key>CFBundleDisplayName</key><string>Light Remote</string>
<key>CFBundleIdentifier</key><string>com.lightremote.client</string>
<key>CFBundleExecutable</key><string>LightRemoteLauncher</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$SHORT_VERSION</string>
<key>CFBundleVersion</key><string>$BUILD_VERSION</string>
<key>CFBundleIconFile</key><string>LightRemote</string>
<key>LSMinimumSystemVersion</key><string>11.0</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST
cp "$PKG/tray/LightRemoteLauncher" "$APP/Contents/MacOS/LightRemoteLauncher"
chmod 0755 "$APP/Contents/MacOS/LightRemoteLauncher"
ICONSET="$TMP/LightRemote.iconset"; mkdir -p "$ICONSET"; ICON_SRC="$ROOT_DIR/assets/branding/light-remote-mark-512.png"
make_icon(){ /usr/bin/sips -z "$1" "$1" "$ICON_SRC" --out "$ICONSET/$2" >/dev/null; }
make_icon 16 icon_16x16.png; make_icon 32 icon_16x16@2x.png
make_icon 32 icon_32x32.png; make_icon 64 icon_32x32@2x.png
make_icon 128 icon_128x128.png; make_icon 256 icon_128x128@2x.png
make_icon 256 icon_256x256.png; make_icon 512 icon_256x256@2x.png
make_icon 512 icon_512x512.png; make_icon 1024 icon_512x512@2x.png
/usr/bin/iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/LightRemote.icns"
/usr/bin/plutil -lint "$APP/Contents/Info.plist" >/dev/null
if [[ -n "${MACOS_APP_SIGN_IDENTITY:-}" ]]; then
  /usr/bin/codesign --force --options runtime --timestamp --sign "$MACOS_APP_SIGN_IDENTITY" "$APP"
  /usr/bin/codesign --verify --deep --strict "$APP"
  echo "macos_app_signing=signed"
else
  echo "macos_app_signing=unsigned_external_identity_not_configured"
fi

cat > "$SCRIPTS/preinstall" <<'PRE'
#!/bin/bash
set -e
console_user="$(/usr/bin/stat -f '%Su' /dev/console 2>/dev/null || true)"
if [[ -n "$console_user" && "$console_user" != root && "$console_user" != loginwindow ]]; then
  uid="$(/usr/bin/id -u "$console_user")"
  for label in com.lightremote.tray com.lightremote.agent; do
    /bin/launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || true
  done
fi
exit 0
PRE
chmod 0755 "$SCRIPTS/preinstall"
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
chown -R root:wheel "\$ROOT" '/Applications/Light Remote.app'
chmod -R go-w "\$ROOT" '/Applications/Light Remote.app'
touch '/Applications/Light Remote.app'
if [[ -x /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister ]]; then
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f '/Applications/Light Remote.app' >/dev/null 2>&1 || true
fi
launchctl bootout system/com.lightremote.updater >/dev/null 2>&1 || true
launchctl bootstrap system /Library/LaunchDaemons/com.lightremote.updater.plist >/dev/null 2>&1 || true
launchctl enable system/com.lightremote.updater >/dev/null 2>&1 || true
USER_NAME="\$(stat -f '%Su' /dev/console 2>/dev/null || true)"
if [[ -n "\$USER_NAME" && "\$USER_NAME" != root && "\$USER_NAME" != loginwindow ]]; then
  UID_NUM="\$(id -u "\$USER_NAME")"; GROUP_NAME="\$(id -gn "\$USER_NAME")"
  mkdir -p "\$ROOT/update-runtime"; chown "\$USER_NAME:\$GROUP_NAME" "\$ROOT/update-runtime"; chmod 700 "\$ROOT/update-runtime"
  for LABEL in com.lightremote.agent com.lightremote.tray; do
    launchctl asuser "\$UID_NUM" launchctl bootout "gui/\$UID_NUM/\$LABEL" >/dev/null 2>&1 || true
    if ! launchctl asuser "\$UID_NUM" launchctl bootstrap "gui/\$UID_NUM" "/Library/LaunchAgents/\$LABEL.plist" >/dev/null 2>&1; then
      launchctl print "gui/\$UID_NUM/\$LABEL" >/dev/null 2>&1 || exit 31
    fi
    launchctl asuser "\$UID_NUM" launchctl enable "gui/\$UID_NUM/\$LABEL" >/dev/null 2>&1 || exit 32
    launchctl asuser "\$UID_NUM" launchctl kickstart -k "gui/\$UID_NUM/\$LABEL" >/dev/null 2>&1 || exit 33
    launchctl print "gui/\$UID_NUM/\$LABEL" >/dev/null 2>&1 || exit 34
  done
  WALL_OK=0
  for _ in {1..20}; do
    if /usr/bin/curl -fsS --max-time 1 'http://127.0.0.1:5491/' >/dev/null 2>&1; then WALL_OK=1; break; fi
    sleep 0.5
  done
  if [[ "\$WALL_OK" != 1 ]]; then
    launchctl asuser "\$UID_NUM" launchctl kickstart -k "gui/\$UID_NUM/com.lightremote.agent" >/dev/null 2>&1 || exit 35
    for _ in {1..20}; do
      if /usr/bin/curl -fsS --max-time 1 'http://127.0.0.1:5491/' >/dev/null 2>&1; then WALL_OK=1; break; fi
      sleep 0.5
    done
  fi
  [[ "\$WALL_OK" == 1 ]] || exit 36
  "\$ROOT/current/runtime/node" "\$ROOT/current/lib/update-helper-reconcile.mjs" \
    --platform darwin --version "$VERSION" --core-root "\$ROOT/current" --install-root "\$ROOT" --state-dir "\$ROOT/update-runtime" || exit 37
else
  echo 'helper_reconcile=deferred_no_console_user'
fi
exit 0
POST
chmod 0755 "$SCRIPTS/postinstall"
IDENT="com.lightremote.client.${PLATFORM}"
PKGBUILD_ARGS=(--root "$ROOT_STAGE" --scripts "$SCRIPTS" --identifier "$IDENT" --version "$SHORT_VERSION" --install-location /)
if [[ -n "${MACOS_INSTALLER_SIGN_IDENTITY:-}" ]]; then
  PKGBUILD_ARGS+=(--sign "$MACOS_INSTALLER_SIGN_IDENTITY")
  echo "macos_installer_signing=signed"
else
  echo "macos_installer_signing=unsigned_external_identity_not_configured"
fi
pkgbuild "${PKGBUILD_ARGS[@]}" "$OUT/Light-Remote-${VERSION}-${ARCH}.pkg"
echo "Built $OUT/Light-Remote-${VERSION}-${ARCH}.pkg"
