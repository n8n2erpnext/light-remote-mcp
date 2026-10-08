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
plutil -lint "$APP/Contents/Info.plist"
# No explicit code signing, no TCC bypass, no Apple Developer membership.
echo 'macos-robot-dev-unsigned-app=PASS'
