#!/bin/bash
# Experimental macOS RM V2 app identity canary. NEVER a production signing path.
# Usage: build-canary.sh <built-native-helper> <new-LightRemoteRmv2Canary.app-path>
set -euo pipefail
if [[ $# -ne 2 ]]; then echo 'usage: build-canary.sh HELPER OUT_APP' >&2; exit 2; fi
HELPER="$1"
APP="$2"
[[ -f "$HELPER" && -x "$HELPER" ]] || { echo 'missing executable helper' >&2; exit 3; }
[[ "${APP##*/}" == "LightRemoteRmv2Canary.app" ]] || { echo 'canary output name required' >&2; exit 4; }
[[ ! -e "$APP" ]] || { echo 'refusing to replace an existing app' >&2; exit 5; }
case "$APP" in
  *"/Library/Application Support/Light Remote/"*|*"/Applications/"*) echo 'production app path denied' >&2;exit 6;;
esac
SOURCE="$(cd "$(dirname "$0")" && pwd)/Info.plist"
[[ -f "$SOURCE" ]] || exit 7
mkdir -p "$APP/Contents/MacOS"
install -m 0755 "$HELPER" "$APP/Contents/MacOS/LightRemoteRealRemote"
install -m 0644 "$SOURCE" "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist"
# Ad-hoc signature is for isolated CI testing, NOT Developer ID notarization.
codesign --force --sign - "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
echo 'macos-rmv2-canary-ad-hoc-signing=PASS'
