#!/usr/bin/env bash
# Product-embedded Robot with its OWN stable macOS TCC consent identity.
set -euo pipefail
if [[ $# -ne 2 ]]; then echo 'usage: build-robot-app.sh HELPER OUT_APP' >&2; exit 2; fi
HELPER="$1"; APP="$2"
[[ -x "$HELPER" ]] || { echo missing_robot_helper >&2; exit 3; }
[[ "$(basename "$APP")" == "Light Remote Robot.app" ]] || { echo bad_robot_bundle_name >&2; exit 4; }
[[ ! -e "$APP" ]] || { echo refusing_existing_robot_app >&2; exit 5; }
SOURCE="$(cd "$(dirname "$0")" && pwd)"
ICON_SOURCE="$SOURCE/../Resources/LightRemoteRM-256.png"
SVG_SOURCE="$SOURCE/../Resources/WindowsRMV2.svg"
[[ -s "$ICON_SOURCE" && -s "$SVG_SOURCE" ]] || { echo missing_rm_icons >&2; exit 6; }
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
install -m 0755 "$HELPER" "$APP/Contents/MacOS/LightRemoteRealRemote"
install -m 0644 "$SOURCE/Info.plist" "$APP/Contents/Info.plist"
install -m 0644 "$SVG_SOURCE" "$APP/Contents/Resources/LightRemoteRM.svg"
ICON_WORK="$(mktemp -d -t lr-robot-icon)"
trap 'rm -rf "$ICON_WORK"' EXIT
ICONSET="$ICON_WORK/LightRemoteRM.iconset"
mkdir -p "$ICONSET"
for spec in "16 icon_16x16.png" "32 icon_16x16@2x.png" "32 icon_32x32.png" "64 icon_32x32@2x.png" "128 icon_128x128.png" "256 icon_128x128@2x.png" "256 icon_256x256.png" "512 icon_256x256@2x.png" "512 icon_512x512.png" "1024 icon_512x512@2x.png"; do
  read -r SIZE NAME <<< "$spec"
  /usr/bin/sips -z "$SIZE" "$SIZE" "$ICON_SOURCE" --out "$ICONSET/$NAME" >/dev/null
done
/usr/bin/iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/LightRemoteRM.icns"
test -s "$APP/Contents/Resources/LightRemoteRM.icns"
plutil -lint "$APP/Contents/Info.plist" >/dev/null
echo macos_embedded_robot_app=PASS
