#!/bin/bash
# Unsigned macOS Robot development app. Does not sign or install production.
set -euo pipefail
if [[ $# -ne 2 ]]; then
  echo "usage: build-dev-app.sh HELPER OUT" >&2
  exit 2
fi
HELPER="$1"
APP="$2"
if [[ ! -x "$HELPER" ]]; then
  echo 'missing native helper' >&2
  exit 3
fi
if [[ "${APP##*/}" != "LightRemoteRobotDev.app" ]]; then
  echo 'invalid dev app name' >&2
  exit 4
fi
if [[ -e "$APP" ]]; then
  echo 'refusing to overwrite an app' >&2
  exit 5
fi
case "$APP" in
  *"/Applications/"*|*"/Library/Application Support/Light Remote/"*)
    echo 'production/system app paths forbidden' >&2
    exit 6
    ;;
esac
SOURCE="$(cd "$(dirname "$0")" && pwd)/DevInfo.plist"
mkdir -p "$APP/Contents/MacOS"
install -m 0755 "$HELPER" "$APP/Contents/MacOS/LightRemoteRealRemote"
install -m 0644 "$SOURCE" "$APP/Contents/Info.plist"
# RM-only visual identity: byte-identical Windows RealRemoteV2 RM logo.
# Do not replace the Light Remote app/tray icon used by production.
ICON_SOURCE="$(dirname "$SOURCE")/../Resources/LightRemoteRM-256.png"
SVG_SOURCE="$(dirname "$SOURCE")/../Resources/WindowsRMV2.svg"
test -s "$ICON_SOURCE" && test -s "$SVG_SOURCE"
mkdir -p "$APP/Contents/Resources"
install -m 0644 "$SVG_SOURCE" "$APP/Contents/Resources/LightRemoteRM.svg"
ICON_WORK="$(mktemp -d -t rm-iconset)"
ICONSET="$ICON_WORK/LightRemoteRM.iconset"
mkdir -p "$ICONSET"
for spec in "16 icon_16x16.png" "32 icon_16x16@2x.png" \
            "32 icon_32x32.png" "64 icon_32x32@2x.png" \
            "128 icon_128x128.png" "256 icon_128x128@2x.png" \
            "256 icon_256x256.png" "512 icon_256x256@2x.png" \
            "512 icon_512x512.png" "1024 icon_512x512@2x.png"; do
  read -r SIZE NAME <<< "$spec"
  /usr/bin/sips -z "$SIZE" "$SIZE" "$ICON_SOURCE" --out "$ICONSET/$NAME" >/dev/null
done
/usr/bin/iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/LightRemoteRM.icns"
rm -rf "$ICON_WORK"
test -s "$APP/Contents/Resources/LightRemoteRM.icns"
plutil -lint "$APP/Contents/Info.plist"
# No explicit code signing, no TCC bypass, no Apple Developer membership.
echo 'macos-robot-dev-unsigned-app=PASS'
