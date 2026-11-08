#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${LIGHT_REMOTE_DOWNLOAD_BASE:-https://light-remote.thaiduy.digital}"
BASE_URL="${BASE_URL%/}"
MANIFEST_URL="${LIGHT_REMOTE_DOWNLOAD_MANIFEST:-$BASE_URL/downloads/manifest.json}"
ENDPOINT="${LIGHT_REMOTE_ENDPOINT:-https://light-remote.thaiduy.digital}"
PROTO_HTTPS="=https"
VERIFY_ONLY=0
ACTION=""
PURGE=0
ASSUME_YES=0
INSTALL_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-only) VERIFY_ONLY=1; shift;;
    --action)
      [[ $# -ge 2 ]] || { echo "Light Remote install: --action requires a value" >&2; exit 2; }
      ACTION="$2"; shift 2;;
    install|reinstall|update|uninstall|remove)
      [[ -z "$ACTION" ]] || { echo "Light Remote install: action specified more than once" >&2; exit 2; }
      ACTION="$1"; shift;;
    --purge) PURGE=1; shift;;
    --yes|-y) ASSUME_YES=1; INSTALL_ARGS+=("--yes"); shift;;
    *) INSTALL_ARGS+=("$1"); shift;;
  esac
done

say(){ printf '%s\n' "$*"; }
die(){ printf 'Light Remote install: %s\n' "$*" >&2; exit 2; }
has_tty(){ ( : </dev/tty ) >/dev/null 2>&1; }
ask_tty(){
  local __name="$1" __prompt="$2" __value=""
  printf '%s' "$__prompt" >/dev/tty
  IFS= read -r __value </dev/tty || true
  printf -v "$__name" '%s' "$__value"
}
as_root(){
  if [[ $EUID -eq 0 ]]; then "$@"; else command -v sudo >/dev/null 2>&1 || die "sudo is required"; sudo "$@"; fi
}
installed_now(){ [[ -L /opt/gpt-operator-agent/current || -f /etc/systemd/system/gpt-operator-device-agent.service ]]; }
choose_action(){
  [[ "$VERIFY_ONLY" == "1" ]] && { ACTION=install; return; }
  [[ -n "$ACTION" ]] && return
  local default=1 choice=""
  installed_now && default=2
  if ! has_tty; then
    ACTION=$([[ "$default" == 2 ]] && echo update || echo install)
    return
  fi
  cat >/dev/tty <<EOF

Light Remote Linux Server
  1) Install
  2) Re-install / update
  3) Uninstall / remove
EOF
  ask_tty choice "Choose [$default]: "
  choice="${choice:-$default}"
  case "$choice" in
    1) ACTION=install;;
    2) ACTION=update;;
    3) ACTION=uninstall;;
    *) die "invalid action choice";;
  esac
}
uninstall_local(){
  local service_user state_home confirm=""
  service_user="$(systemctl show gpt-operator-device-agent.service -p User --value 2>/dev/null || true)"
  [[ -n "$service_user" ]] || service_user="${SUDO_USER:-${USER:-root}}"
  state_home="$(getent passwd "$service_user" | cut -d: -f6)"
  if [[ "$ASSUME_YES" != "1" && has_tty ]]; then
    say "This removes Light Remote runtime, CLI, and systemd units."
    say "Enrollment identity is preserved unless --purge is supplied."
    ask_tty confirm "Continue? [y/N]: "
    [[ "$confirm" =~ ^[Yy]$ ]] || { say "Cancelled."; exit 0; }
  fi
  for unit in gpt-operator-device-agent.service gpt-operator-agent-update.service gpt-operator-agent-update-check.service gpt-operator-agent-update.timer gpt-operator-agent-update.path gpt-operator-agent-update-check.path; do
    as_root systemctl disable --now "$unit" >/dev/null 2>&1 || true
  done
  as_root rm -f     /etc/systemd/system/gpt-operator-device-agent.service     /etc/systemd/system/gpt-operator-agent-update.service     /etc/systemd/system/gpt-operator-agent-update-check.service     /etc/systemd/system/gpt-operator-agent-update.timer     /etc/systemd/system/gpt-operator-agent-update.path     /etc/systemd/system/gpt-operator-agent-update-check.path     /usr/local/bin/light-remote
  as_root rm -rf /opt/gpt-operator-agent
  as_root systemctl daemon-reload
  as_root systemctl reset-failed >/dev/null 2>&1 || true
  if [[ "$PURGE" == "1" && -n "$state_home" ]]; then
    as_root rm -rf "$state_home/.config/gpt-operator-agent"
    say "Light Remote removed; local enrollment state purged."
  else
    say "Light Remote removed; local enrollment state preserved."
    say "Use --purge to remove local identity/state as well."
  fi
  exit 0
}

choose_action
case "$ACTION" in
  uninstall|remove) uninstall_local;;
  install|reinstall|update) ;;
  *) die "unsupported action: $ACTION";;
esac

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

say "Light Remote: verified release; starting $ACTION..."
exec bash "$TMP/install-linux-client.sh" --bundle "$TMP/package.tar.gz" --base-url "$ENDPOINT" --hub-url "$ENDPOINT" --defer-enrollment --action "$ACTION" "${INSTALL_ARGS[@]}"
