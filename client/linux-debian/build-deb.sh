#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUNDLE="${1:-}"; OUT="${2:-$ROOT_DIR/dist/linux-debian}"
[[ -f "$BUNDLE" ]] || { echo 'Usage: build-deb.sh <signed-client-package.tar.gz> [output-dir]' >&2; exit 2; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/extract"; tar -xzf "$BUNDLE" -C "$TMP/extract"
PKG="$TMP/extract/package"; [[ -f "$PKG/manifest.json" && -x "$PKG/runtime/node" ]] || { echo 'invalid client bundle' >&2; exit 2; }
read -r VERSION PLATFORM < <(python3 -c 'import json,sys;m=json.load(open(sys.argv[1]));print(m["version"],m["platform"])' "$PKG/manifest.json")
case "$PLATFORM" in linux-x64) ARCH=amd64;; linux-arm64) ARCH=arm64;; *) echo "unsupported Debian platform: $PLATFORM" >&2; exit 2;; esac
STAGE="$TMP/stage"; mkdir -p "$STAGE/DEBIAN" "$STAGE/opt/gpt-operator-agent/releases/$VERSION" "$STAGE/usr/lib/systemd/user" "$STAGE/etc/systemd/system" "$STAGE/etc/xdg/autostart" "$STAGE/usr/share/icons/hicolor/256x256/apps"
cp -a "$PKG/." "$STAGE/opt/gpt-operator-agent/releases/$VERSION/"
cp "$ROOT_DIR/client/update-public.pem" "$STAGE/opt/gpt-operator-agent/update-public.pem"
cp "$PKG/assets/branding/light-remote-mark-256.png" "$STAGE/usr/share/icons/hicolor/256x256/apps/light-remote.png"
cp "$ROOT_DIR/client/linux-debian/systemd/light-remote-agent.service" "$STAGE/usr/lib/systemd/user/"
cp "$ROOT_DIR/client/linux-debian/systemd/light-remote-tray.service" "$STAGE/usr/lib/systemd/user/"
cp "$ROOT_DIR/client/linux-debian/systemd/light-remote-update.service" "$STAGE/etc/systemd/system/"
cp "$ROOT_DIR/client/linux-debian/systemd/light-remote-update.timer" "$STAGE/etc/systemd/system/"
cat > "$STAGE/DEBIAN/control" <<CTL
Package: light-remote
Version: $VERSION
Section: net
Priority: optional
Architecture: $ARCH
Depends: python3, python3-gi, gir1.2-gtk-3.0, gir1.2-ayatanaappindicator3-0.1, policykit-1, xdg-utils, ca-certificates, util-linux
Maintainer: Light Remote
Description: Light Remote background service, Local Wall, tray helper and signed updater.
CTL
cat > "$STAGE/DEBIAN/postinst" <<'POST'
#!/bin/sh
set -e
ln -sfn '/opt/gpt-operator-agent/releases/@VERSION@' /opt/gpt-operator-agent/current
systemctl daemon-reload || true
systemctl enable --now light-remote-update.timer || true
systemctl --global enable light-remote-agent.service light-remote-tray.service || true
for RUNTIME in /run/user/[0-9]*; do
  [ -d "$RUNTIME" ] || continue
  UID_NUM="${RUNTIME##*/}"; [ -S "$RUNTIME/bus" ] || continue
  USER_NAME="$(getent passwd "$UID_NUM" | cut -d: -f1)"; [ -n "$USER_NAME" ] || continue
  runuser -u "$USER_NAME" -- env XDG_RUNTIME_DIR="$RUNTIME" DBUS_SESSION_BUS_ADDRESS="unix:path=$RUNTIME/bus" systemctl --user daemon-reload || true
  runuser -u "$USER_NAME" -- env XDG_RUNTIME_DIR="$RUNTIME" DBUS_SESSION_BUS_ADDRESS="unix:path=$RUNTIME/bus" systemctl --user enable --now light-remote-agent.service light-remote-tray.service || true
done
exit 0
POST
sed -i "s/@VERSION@/$VERSION/g" "$STAGE/DEBIAN/postinst"
cat > "$STAGE/DEBIAN/prerm" <<'PRE'
#!/bin/sh
systemctl disable --now light-remote-update.timer 2>/dev/null || true
for RUNTIME in /run/user/[0-9]*; do
  [ -d "$RUNTIME" ] || continue
  UID_NUM="${RUNTIME##*/}"; [ -S "$RUNTIME/bus" ] || continue
  USER_NAME="$(getent passwd "$UID_NUM" | cut -d: -f1)"; [ -n "$USER_NAME" ] || continue
  runuser -u "$USER_NAME" -- env XDG_RUNTIME_DIR="$RUNTIME" DBUS_SESSION_BUS_ADDRESS="unix:path=$RUNTIME/bus" systemctl --user disable --now light-remote-tray.service light-remote-agent.service 2>/dev/null || true
done
systemctl --global disable light-remote-agent.service light-remote-tray.service 2>/dev/null || true
exit 0
PRE
chmod 0755 "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/prerm"
find "$STAGE" -type d -exec chmod 0755 {} +
find "$STAGE" -type f -exec chmod 0644 {} +
chmod 0755 "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/prerm" "$STAGE/opt/gpt-operator-agent/releases/$VERSION/runtime/node"
mkdir -p "$OUT"; dpkg-deb --root-owner-group --build "$STAGE" "$OUT/light-remote_${VERSION}_${ARCH}.deb"
echo "Built $OUT/light-remote_${VERSION}_${ARCH}.deb"
