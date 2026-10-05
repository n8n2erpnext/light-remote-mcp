#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO="${LIGHT_REMOTE_RELEASE_REPO:-n8n2erpnext/light-remote-mcp}"
ENV_FILE="${LIGHT_REMOTE_R2_ENV_FILE:-$HOME/.config/lightbi-backup-r2.env}"
R2_PREFIX="${LIGHT_REMOTE_R2_PREFIX:-light-remote/release}"
STATE_FILE="${LIGHT_REMOTE_R2_SYNC_STATE:-$HOME/.local/state/light-remote-release-sync/version}"
LXD_NAME="${LIGHT_REMOTE_DISTRIBUTION_LXD:-light-remote-direct}"
LXD_DIST_DIR="${LIGHT_REMOTE_DISTRIBUTION_DIR:-/var/lib/light-remote-direct/distribution}"
VERSION_ARG="${1:-}"

[[ -f "$ENV_FILE" ]] || { echo "R2 environment file not found: $ENV_FILE" >&2; exit 2; }
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${AWS_ACCESS_KEY_ID:?}"
: "${AWS_SECRET_ACCESS_KEY:?}"
: "${R2_ACCOUNT_ID:?}"
: "${R2_BUCKET:?}"
: "${R2_PUBLIC_URL:?}"

BUCKET="${LIGHT_REMOTE_R2_BUCKET_ROOT:-${R2_BUCKET%%/*}}"
OBJECT_PREFIX="${LIGHT_REMOTE_R2_OBJECT_PREFIX:-${R2_PREFIX#/}}"
PUBLIC_ROOT="${R2_PUBLIC_URL%/}"
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/light-remote-release.XXXXXXXXXX")"
trap 'rm -rf "$TMP"' EXIT

api_get(){
  curl -fsSL --proto '=https' --proto-redir '=https'     -H 'Accept: application/vnd.github+json'     -H 'User-Agent: light-remote-release-sync' "$1"
}

if [[ -n "$VERSION_ARG" ]]; then
  VERSION="${VERSION_ARG#v}"
  api_get "https://api.github.com/repos/$REPO/releases/tags/v$VERSION" > "$TMP/release.json"
else
  api_get "https://api.github.com/repos/$REPO/releases?per_page=20" > "$TMP/releases.json"
  python3 - "$TMP/releases.json" "$TMP/release.json" <<'PY'
import json,re,sys
rows=json.load(open(sys.argv[1],encoding='utf-8'))
row=next((r for r in rows if not r.get('draft') and re.match(r'^v0\.9\.',str(r.get('tag_name','')))),None)
if not row: raise SystemExit('no Light Remote v0.9 release found')
json.dump(row,open(sys.argv[2],'w',encoding='utf-8'))
PY
  VERSION="$(python3 - "$TMP/release.json" <<'PY'
import json,sys
print(str(json.load(open(sys.argv[1]))['tag_name']).removeprefix('v'))
PY
)"
fi

mkdir -p "$(dirname "$STATE_FILE")"
if [[ -z "$VERSION_ARG" && -f "$STATE_FILE" && "$(cat "$STATE_FILE")" == "$VERSION" ]]; then
  echo "light-remote-r2-sync=NOOP version=$VERSION"
  exit 0
fi

python3 - "$TMP/release.json" > "$TMP/assets.tsv" <<'PY'
import json,re,sys
r=json.load(open(sys.argv[1],encoding='utf-8'))
wanted=re.compile(r'^(?:Light-Remote-MCP-Setup-x64-|Light-Remote-MCP-Compact-Setup-x64-|Light-Remote-MCP-Client-Linux-(?:x64|arm64)-|light-remote_.+_(?:amd64|arm64)\.deb|Light-Remote-Client-macOS-|Light-Remote-.+\.pkg$|install-linux-client\.sh$|SHA256SUMS\.txt$)')
for a in r.get('assets',[]):
    name=str(a.get('name',''))
    if wanted.search(name):
        print(name+'\t'+str(a.get('browser_download_url','')))
PY

[[ -s "$TMP/assets.tsv" ]] || { echo "release has no distribution assets: $VERSION" >&2; exit 3; }
while IFS=$'\t' read -r name url; do
  [[ "$url" == https://* ]] || { echo "invalid asset URL for $name" >&2; exit 3; }
  echo "download $name"
  curl -fL --retry 3 --proto '=https' --proto-redir '=https' "$url" -o "$TMP/$name"
done < "$TMP/assets.tsv"

required=(
  "Light-Remote-MCP-Setup-x64-$VERSION.exe"
  "Light-Remote-MCP-Client-Linux-x64-$VERSION.tar.gz"
  "Light-Remote-MCP-Client-Linux-arm64-$VERSION.tar.gz"
  "install-linux-client.sh"
)
for name in "${required[@]}"; do
  [[ -s "$TMP/$name" ]] || { echo "required release asset missing: $name" >&2; exit 4; }
done

content_type(){
  case "$1" in
    *.exe) echo 'application/vnd.microsoft.portable-executable' ;;
    *.deb) echo 'application/vnd.debian.binary-package' ;;
    *.tar.gz) echo 'application/gzip' ;;
    *.pkg) echo 'application/octet-stream' ;;
    *.sh) echo 'text/x-shellscript; charset=utf-8' ;;
    *.json) echo 'application/json; charset=utf-8' ;;
    *.txt) echo 'text/plain; charset=utf-8' ;;
    *) echo 'application/octet-stream' ;;
  esac
}
put(){
  local file="$1" key="$2" cache="$3" type code
  type="$(content_type "$file")"
  code="$(curl -sS -o /dev/null -w '%{http_code}'     --aws-sigv4 'aws:amz:auto:s3'     --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}"     -X PUT --data-binary @"$file"     -H "content-type: $type"     -H "cache-control: $cache"     "$ENDPOINT/$BUCKET/$key")"
  [[ "$code" =~ ^2 ]] || { echo "R2 PUT failed key=$key http=$code" >&2; exit 5; }
}

VERSION_KEY="$OBJECT_PREFIX/$VERSION"
while IFS=$'\t' read -r name _; do
  put "$TMP/$name" "$VERSION_KEY/$name" 'public, max-age=31536000, immutable'
done < "$TMP/assets.tsv"

python3 - "$TMP" "$VERSION" "$PUBLIC_ROOT/$VERSION_KEY" > "$TMP/manifest.json" <<'PY'
import hashlib,json,os,sys,datetime
root,version,base=sys.argv[1:4]
def info(name):
    p=os.path.join(root,name)
    if not os.path.isfile(p): return None
    b=open(p,'rb').read()
    return {'file':name,'url':f'{base}/{name}','sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
win=info(f'Light-Remote-MCP-Setup-x64-{version}.exe')
compact=info(f'Light-Remote-MCP-Compact-Setup-x64-{version}.exe')
linux_x64=info(f'Light-Remote-MCP-Client-Linux-x64-{version}.tar.gz')
linux_arm64=info(f'Light-Remote-MCP-Client-Linux-arm64-{version}.tar.gz')
deb_x64=info(f'light-remote_{version}_amd64.deb')
deb_arm64=info(f'light-remote_{version}_arm64.deb')
installer=info('install-linux-client.sh')
releases=[
  {
    'id':'windows','label':'Windows x64','kind':'desktop','version':version,
    'description':'Tray client + Local Wall + Real Remote V2.',
    'available':bool(win),'file':win['file'] if win else None,'url':win['url'] if win else None,
    'sha256':win['sha256'] if win else None,'bytes':win['bytes'] if win else None,
    'compact':compact,'storage':'r2',
    'installHint':'Run the installer, then reopen Local Wall to link or resume the device.'
  },
  {
    'id':'macos','label':'macOS','kind':'desktop','version':version,
    'description':'Native desktop launcher + Light Remote agent.',
    'available':False,'file':None,
    'installHint':'Signed/notarized package will appear here when published.'
  },
  {
    'id':'linux-desktop','label':'Linux Desktop ARM64','kind':'desktop','version':version,
    'description':'Debian package with Local Wall and terminal runtime.',
    'available':bool(deb_arm64),'file':deb_arm64['file'] if deb_arm64 else None,'url':deb_arm64['url'] if deb_arm64 else None,
    'sha256':deb_arm64['sha256'] if deb_arm64 else None,'bytes':deb_arm64['bytes'] if deb_arm64 else None,
    'assets':{'x64':deb_x64,'arm64':deb_arm64},'storage':'r2',
    'installHint':'Install the .deb package, then open Local Wall to link the device.'
  },
  {
    'id':'linux-server','label':'Linux Server / Terminal','kind':'server','version':version,
    'description':'Headless Light Remote device agent for Linux servers and VPS terminals.',
    'available':bool(linux_x64 and linux_arm64 and installer),
    'file':linux_arm64['file'] if linux_arm64 else None,'url':linux_arm64['url'] if linux_arm64 else None,
    'sha256':linux_arm64['sha256'] if linux_arm64 else None,'bytes':linux_arm64['bytes'] if linux_arm64 else None,
    'assets':{'x64':linux_x64,'arm64':linux_arm64},
    'installer':installer,'storage':'r2',
    'installCommand':'curl -fsSL https://light-remote.thaiduy.digital/downloads/install.sh | bash',
    'installHint':'The installer verifies the release, then lets you choose install/update/remove and Local Wall binding. Loopback is the safe default. After a fresh install, run light-remote up to enroll.'
  }
]
m={
  'schemaVersion':1,'channel':version,
  'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z'),
  'endpoint':'https://light-remote.thaiduy.digital','storage':'r2',
  'installScriptUrl':base.rsplit('/',1)[0]+'/install.sh',
  'releases':releases
}
print(json.dumps(m,indent=2))
PY

put "$TMP/manifest.json" "$VERSION_KEY/manifest.json" 'public, max-age=31536000, immutable'
put "$TMP/manifest.json" "$OBJECT_PREFIX/latest/manifest.json" 'public, max-age=60'
put "$REPO_ROOT/plugin-server/downloads-install-linux.sh" "$OBJECT_PREFIX/install.sh" 'public, max-age=300'

if command -v lxc >/dev/null 2>&1 && lxc info "$LXD_NAME" >/dev/null 2>&1; then
  lxc exec "$LXD_NAME" -- install -d -o lightremote -g lightremote -m 0755 "$LXD_DIST_DIR"
  lxc file push "$TMP/manifest.json" "$LXD_NAME$LXD_DIST_DIR/manifest.json"
  lxc exec "$LXD_NAME" -- chown lightremote:lightremote "$LXD_DIST_DIR/manifest.json"
  lxc exec "$LXD_NAME" -- chmod 0644 "$LXD_DIST_DIR/manifest.json"
  lxc exec "$LXD_NAME" -- find "$LXD_DIST_DIR" -maxdepth 1 -type f ! -name manifest.json -delete
fi

printf '%s\n' "$VERSION" > "$STATE_FILE"
echo "light-remote-r2-sync=PASS version=$VERSION prefix=$VERSION_KEY"
