#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${LIGHT_REMOTE_DOWNLOAD_BASE:-https://light-remote.thaiduy.digital}"
BASE_URL="${BASE_URL%/}"
MANIFEST_URL="${LIGHT_REMOTE_DOWNLOAD_MANIFEST:-$BASE_URL/downloads/manifest.json}"
ENDPOINT="${LIGHT_REMOTE_ENDPOINT:-https://light-remote.thaiduy.digital}"
PROTO_HTTPS="=https"
VERIFY_ONLY=0
INSTALL_ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--verify-only" ]]; then VERIFY_ONLY=1; else INSTALL_ARGS+=("$arg"); fi
done

say(){ printf '%s\n' "$*"; }
die(){ printf 'Light Remote install: %s\n' "$*" >&2; exit 2; }

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v python3 >/dev/null 2>&1 || die "python3 is required"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required"
command -v tar >/dev/null 2>&1 || die "tar is required"

case "$(uname -s)" in
  Linux) ;;
  *) die "this installer is for Linux terminal/server devices" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) die "unsupported Linux architecture: $(uname -m)" ;;
esac

TMP="$(mktemp -d "${TMPDIR:-/tmp}/light-remote.XXXXXXXXXX")" || die "unable to create temporary directory"
trap 'rm -rf "$TMP"' EXIT

say "Light Remote: resolving current Linux $ARCH release..."
curl -fsSL --proto "$PROTO_HTTPS" --proto-redir "$PROTO_HTTPS" "$MANIFEST_URL" -o "$TMP/manifest.json"

read -r VERSION BUNDLE_URL BUNDLE_SHA BUNDLE_SIZE INSTALLER_URL INSTALLER_SHA < <(
  python3 - "$TMP/manifest.json" "$ARCH" <<'PY'
import json,sys
m=json.load(open(sys.argv[1],encoding='utf-8'))
arch=sys.argv[2]
release=next((r for r in m.get('releases',[]) if r.get('id')=='linux-server' and r.get('available') is True),None)
if not release:
    raise SystemExit('linux-server release is not published')
asset=(release.get('assets') or {}).get(arch)
if not asset:
    raise SystemExit(f'linux-server {arch} asset is not published')
installer=release.get('installer') or {}
vals=[
    str(release.get('version') or m.get('channel') or ''),
    str(asset.get('url') or ''),
    str(asset.get('sha256') or ''),
    str(asset.get('bytes') or 0),
    str(installer.get('url') or ''),
    str(installer.get('sha256') or ''),
]
if not vals[0] or not vals[1] or len(vals[2])!=64 or not vals[4] or len(vals[5])!=64:
    raise SystemExit('distribution manifest is incomplete')
print(' '.join(vals))
PY
)

[[ "$BUNDLE_URL" == https://* ]] || die "bundle URL must be HTTPS"
[[ "$INSTALLER_URL" == https://* ]] || die "installer URL must be HTTPS"
[[ "$BUNDLE_SHA" =~ ^[A-Fa-f0-9]{64}$ ]] || die "invalid bundle SHA256"
[[ "$INSTALLER_SHA" =~ ^[A-Fa-f0-9]{64}$ ]] || die "invalid installer SHA256"

say "Light Remote: downloading $VERSION for linux-$ARCH..."
curl -fsSL --proto "$PROTO_HTTPS" --proto-redir "$PROTO_HTTPS" "$BUNDLE_URL" -o "$TMP/package.tar.gz"
curl -fsSL --proto "$PROTO_HTTPS" --proto-redir "$PROTO_HTTPS" "$INSTALLER_URL" -o "$TMP/install-linux-client.sh"

ACTUAL_BUNDLE_SHA="$(sha256sum "$TMP/package.tar.gz" | awk '{print $1}')"
ACTUAL_INSTALLER_SHA="$(sha256sum "$TMP/install-linux-client.sh" | awk '{print $1}')"
[[ "$ACTUAL_BUNDLE_SHA" == "$BUNDLE_SHA" ]] || die "bundle SHA256 mismatch"
[[ "$ACTUAL_INSTALLER_SHA" == "$INSTALLER_SHA" ]] || die "installer SHA256 mismatch"
if [[ "$BUNDLE_SIZE" != "0" ]]; then
  ACTUAL_SIZE="$(stat -c %s "$TMP/package.tar.gz")"
  [[ "$ACTUAL_SIZE" == "$BUNDLE_SIZE" ]] || die "bundle size mismatch"
fi
chmod 0755 "$TMP/install-linux-client.sh"

if [[ "$VERIFY_ONLY" == "1" ]]; then
  say "Light Remote: verified $VERSION linux-$ARCH bundle and installer."
  exit 0
fi

say "Light Remote: verified release; starting install..."
exec bash "$TMP/install-linux-client.sh" --bundle "$TMP/package.tar.gz" --base-url "$ENDPOINT" --hub-url "$ENDPOINT" --defer-enrollment "${INSTALL_ARGS[@]}"
