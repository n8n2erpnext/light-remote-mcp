#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/gpt-operator-agent
MANIFEST_URL="${GPT_OPERATOR_UPDATE_MANIFEST_URL:-https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/main/channels/beta/client-update.json}"
SIGNATURE_URL="${GPT_OPERATOR_UPDATE_SIGNATURE_URL:-https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/main/channels/beta/client-update.json.sig}"
BASE_URL="${OPERATOR_AGENT_BASE_URL:-https://light-remote.thaiduy.digital}"
HUB_URL="${OPERATOR_AGENT_HUB_URL:-https://light-remote.thaiduy.digital}"
BUNDLE=""
DEV_BUNDLE=0
DEFER_ENROLLMENT=0
ACTION="install"
WALL_MODE=""
WALL_HOST_ARG=""
ASSUME_YES=0
PURGE=0
TARGET_USER="${SUDO_USER:-${USER:-}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle) BUNDLE="$2"; DEV_BUNDLE=1; shift 2;;
    --user) TARGET_USER="$2"; shift 2;;
    --base-url) BASE_URL="${2%/}"; shift 2;;
    --hub-url) HUB_URL="${2%/}"; shift 2;;
    --defer-enrollment) DEFER_ENROLLMENT=1; shift;;
    --action) ACTION="$2"; shift 2;;
    --wall) WALL_MODE="$2"; shift 2;;
    --wall-host) WALL_HOST_ARG="$2"; shift 2;;
    --yes|-y) ASSUME_YES=1; shift;;
    --purge) PURGE=1; shift;;
    install|reinstall|update|uninstall|remove) ACTION="$1"; shift;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done

if [[ "${BASE_URL%/}" == "https://light-remote-mcp.vercel.app" ]]; then BASE_URL="https://light-remote.thaiduy.digital"; fi
if [[ "${HUB_URL%/}" == "https://mcp.dashboard.thaiduy.store" ]]; then HUB_URL="https://light-remote.thaiduy.digital"; fi

[[ -n "$TARGET_USER" ]] || { echo "Unable to determine target user" >&2; exit 2; }
[[ "$BASE_URL" == https://* ]] || { echo "--base-url must be HTTPS" >&2; exit 2; }
[[ "$HUB_URL" == https://* ]] || { echo "--hub-url must be HTTPS" >&2; exit 2; }

as_root() {
  if [[ $EUID -eq 0 ]]; then
    "$@"
  else
    command -v sudo >/dev/null 2>&1 || { echo "sudo is required when not running as root" >&2; return 2; }
    sudo "$@"
  fi
}
as_user() {
  local user="$1"; shift
  if [[ "$(id -un)" == "$user" ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u "$user" "$@"
  elif [[ $EUID -eq 0 ]] && command -v runuser >/dev/null 2>&1; then
    runuser -u "$user" -- "$@"
  else
    echo "Unable to run command as $user; install sudo or run as that user" >&2
    return 2
  fi
}
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
[[ -n "$TARGET_HOME" ]] || { echo "Unable to determine home for $TARGET_USER" >&2; exit 2; }

has_tty(){ ( : </dev/tty ) >/dev/null 2>&1; }
ask_tty(){
  local __name="$1" __prompt="$2" __value=""
  printf '%s' "$__prompt" >/dev/tty
  IFS= read -r __value </dev/tty || true
  printf -v "$__name" '%s' "$__value"
}
is_ipv4(){
  local ip="$1" a b c d
  IFS=. read -r a b c d <<<"$ip"
  [[ "$a" =~ ^[0-9]+$ && "$b" =~ ^[0-9]+$ && "$c" =~ ^[0-9]+$ && "$d" =~ ^[0-9]+$ ]] || return 1
  (( a>=0 && a<=255 && b>=0 && b<=255 && c>=0 && c<=255 && d>=0 && d<=255 ))
}
is_netbird_ipv4(){
  local ip="$1" a b _ _
  is_ipv4 "$ip" || return 1
  IFS=. read -r a b _ _ <<<"$ip"
  (( a==100 && b>=64 && b<=127 ))
}
is_lan_ipv4(){
  local ip="$1" a b _ _
  is_ipv4 "$ip" || return 1
  IFS=. read -r a b _ _ <<<"$ip"
  (( a==10 || (a==172 && b>=16 && b<=31) || (a==192 && b==168) ))
}
valid_wall_host(){
  [[ "$1" == "127.0.0.1" ]] || is_lan_ipv4 "$1" || is_netbird_ipv4 "$1"
}
CURRENT_WALL_HOST="127.0.0.1"
CURRENT_SERVICE_ENV="$(systemctl show gpt-operator-device-agent.service --property=Environment --value 2>/dev/null || true)"
for item in $CURRENT_SERVICE_ENV; do
  case "$item" in
    OPERATOR_AGENT_WALL_HOST=*) CURRENT_WALL_HOST="${item#*=}";;
  esac
done
CURRENT_WALL_HOST="${CURRENT_WALL_HOST%\"}"; CURRENT_WALL_HOST="${CURRENT_WALL_HOST#\"}"
LAN_ROWS=()
NETBIRD_ROWS=()
NETBIRD_VERSION=""
detect_wall_candidates(){
  LAN_ROWS=(); NETBIRD_ROWS=(); NETBIRD_VERSION=""
  if command -v netbird >/dev/null 2>&1; then NETBIRD_VERSION="$(netbird version 2>/dev/null | head -n1 | tr -d '\r' || true)"; fi
  command -v ip >/dev/null 2>&1 || return 0
  local iface cidr addr
  while read -r iface cidr; do
    [[ -n "$iface" && -n "$cidr" ]] || continue
    addr="${cidr%%/*}"
    if is_netbird_ipv4 "$addr"; then
      [[ -n "$NETBIRD_VERSION" ]] && NETBIRD_ROWS+=("$iface|$addr")
      continue
    fi
    if is_lan_ipv4 "$addr" && [[ ! "$iface" =~ ^(docker|br-|veth|lxc|virbr|podman|cni|flannel|tailscale) ]]; then
      LAN_ROWS+=("$iface|$addr")
    fi
  done < <(ip -4 -o addr show scope global 2>/dev/null | awk '{print $2, $4}')
}
pick_candidate(){
  local array_name="$1" label="$2" choice="" i row
  local -n rows="$array_name"
  ((${#rows[@]})) || { echo "No $label address detected." >&2; return 2; }
  if ((${#rows[@]}==1)) || ! has_tty || [[ "$ASSUME_YES" == "1" ]]; then
    printf '%s\n' "${rows[0]#*|}"
    return 0
  fi
  printf '\nDetected %s addresses:\n' "$label" >/dev/tty
  for i in "${!rows[@]}"; do row="${rows[$i]}"; printf '  %d) %s (%s)\n' "$((i+1))" "${row#*|}" "${row%%|*}" >/dev/tty; done
  ask_tty choice "Choose [1]: "
  choice="${choice:-1}"
  [[ "$choice" =~ ^[0-9]+$ ]] && (( choice>=1 && choice<=${#rows[@]} )) || { echo "Invalid $label selection." >&2; return 2; }
  printf '%s\n' "${rows[$((choice-1))]#*|}"
}
choose_wall_host(){
  detect_wall_candidates
  local default_host="127.0.0.1" choice="" lan_hint="not detected" nb_hint="not detected"
  if [[ "$ACTION" == "update" || "$ACTION" == "reinstall" ]]; then
    valid_wall_host "$CURRENT_WALL_HOST" && default_host="$CURRENT_WALL_HOST"
  fi
  if ((${#LAN_ROWS[@]})); then lan_hint="${LAN_ROWS[0]#*|} (${LAN_ROWS[0]%%|*})"; fi
  if ((${#NETBIRD_ROWS[@]})); then nb_hint="${NETBIRD_ROWS[0]#*|} (${NETBIRD_ROWS[0]%%|*})"; fi
  [[ -n "$NETBIRD_VERSION" ]] && nb_hint="$nb_hint · $NETBIRD_VERSION"

  if [[ -n "$WALL_HOST_ARG" ]]; then
    valid_wall_host "$WALL_HOST_ARG" || { echo "--wall-host must be loopback, RFC1918 LAN, or NetBird CGNAT IPv4" >&2; exit 2; }
    WALL_HOST="$WALL_HOST_ARG"
  elif [[ -n "$WALL_MODE" ]]; then
    case "$WALL_MODE" in
      loopback|local|none) WALL_HOST="127.0.0.1";;
      lan) WALL_HOST="$(pick_candidate LAN_ROWS LAN)" || exit $?;;
      netbird) WALL_HOST="$(pick_candidate NETBIRD_ROWS NetBird)" || exit $?;;
      *) echo "--wall must be loopback, lan, or netbird" >&2; exit 2;;
    esac
  elif ! has_tty || [[ "$ASSUME_YES" == "1" ]]; then
    WALL_HOST="$default_host"
  else
    cat >/dev/tty <<EOF

Local Wall binding
  1) No bind / local only — 127.0.0.1:5491
  2) Bind host LAN       — $lan_hint:5491
  3) Bind NetBird        — $nb_hint:5491
Current/default: $default_host:5491
EOF
    ask_tty choice "Choose [Enter keeps current/default]: "
    case "$choice" in
      "") WALL_HOST="$default_host";;
      1) WALL_HOST="127.0.0.1";;
      2) WALL_HOST="$(pick_candidate LAN_ROWS LAN)" || exit $?;;
      3) WALL_HOST="$(pick_candidate NETBIRD_ROWS NetBird)" || exit $?;;
      *) echo "Invalid Local Wall binding choice." >&2; exit 2;;
    esac
  fi
  WALL_PORT=5491
  printf 'Local Wall bind selected: %s:%s\n' "$WALL_HOST" "$WALL_PORT"
}
uninstall_local(){
  local confirm=""
  if [[ "$ASSUME_YES" != "1" && has_tty ]]; then
    echo "This removes Light Remote runtime, CLI, and systemd units."
    echo "Enrollment identity is preserved unless --purge is supplied."
    ask_tty confirm "Continue? [y/N]: "
    [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 0; }
  fi
  for unit in gpt-operator-device-agent.service gpt-operator-agent-update.service gpt-operator-agent-update-check.service gpt-operator-agent-update.timer gpt-operator-agent-update.path gpt-operator-agent-update-check.path; do
    as_root systemctl disable --now "$unit" >/dev/null 2>&1 || true
  done
  as_root rm -f /etc/systemd/system/gpt-operator-device-agent.service /etc/systemd/system/gpt-operator-agent-update.service /etc/systemd/system/gpt-operator-agent-update-check.service /etc/systemd/system/gpt-operator-agent-update.timer /etc/systemd/system/gpt-operator-agent-update.path /etc/systemd/system/gpt-operator-agent-update-check.path /usr/local/bin/light-remote
  as_root rm -rf "$ROOT"
  as_root systemctl daemon-reload
  as_root systemctl reset-failed >/dev/null 2>&1 || true
  if [[ "$PURGE" == "1" ]]; then
    as_root rm -rf "$TARGET_HOME/.config/gpt-operator-agent"
    echo "Light Remote removed; local enrollment state purged."
  else
    echo "Light Remote removed; local enrollment state preserved."
  fi
  exit 0
}

case "$ACTION" in
  uninstall|remove) uninstall_local;;
  install)
    if [[ -L "$ROOT/current" || -f /etc/systemd/system/gpt-operator-device-agent.service ]]; then
      echo "Light Remote is already installed. Use update or reinstall." >&2
      exit 3
    fi
    ;;
  update|reinstall) ;;
  *) echo "Unsupported action: $ACTION" >&2; exit 2;;
esac
choose_wall_host

for cmd in curl openssl python3 tar sha256sum systemctl; do command -v "$cmd" >/dev/null || { echo "Missing required command: $cmd" >&2; exit 2; }; done
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
AGENT_WAS_ACTIVE=0
if systemctl is-active --quiet gpt-operator-device-agent.service 2>/dev/null; then AGENT_WAS_ACTIVE=1; fi
cat > "$TMP/update-public.pem" <<'PEM'
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEd0yyFRW9uXeqHy4psV2m8c4bn9wS
Vsq8wEr+VeAGZP0ZEwOjD8XDazBHXOtqevlPyamsjUfMc1zFf09iQs2BBQ==
-----END PUBLIC KEY-----
PEM

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) PLATFORM_KEY=linux-x64;;
  aarch64|arm64) PLATFORM_KEY=linux-arm64;;
  *) echo "Unsupported Linux architecture: $ARCH" >&2; exit 2;;
esac

if [[ -n "$BUNDLE" ]]; then
  [[ -f "$BUNDLE" ]] || { echo "Bundle not found: $BUNDLE" >&2; exit 2; }
  cp "$BUNDLE" "$TMP/package.tar.gz"
  tar -xzf "$TMP/package.tar.gz" -C "$TMP"
  VERSION="$(python3 - "$TMP/package/manifest.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))['version'])
PY
)"
  echo "Installing local bundle $VERSION"
else
  curl -fsSL "$MANIFEST_URL" -o "$TMP/client-update.json"
  curl -fsSL "$SIGNATURE_URL" -o "$TMP/client-update.json.sig.b64"
  base64 -d "$TMP/client-update.json.sig.b64" > "$TMP/client-update.json.sig"
  openssl dgst -sha256 -verify "$TMP/update-public.pem" -signature "$TMP/client-update.json.sig" "$TMP/client-update.json" >/dev/null
  read -r VERSION ARTIFACT_URL ARTIFACT_SHA ARTIFACT_SIZE < <(python3 - "$TMP/client-update.json" "$PLATFORM_KEY" <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); a=m['artifacts'][sys.argv[2]]
print(m['version'],a['url'],a['sha256'],a.get('size',0))
PY
)
  [[ "$ARTIFACT_SHA" =~ ^[A-Fa-f0-9]{64}$ ]] || { echo "Invalid artifact hash" >&2; exit 2; }
  curl -fsSL "$ARTIFACT_URL" -o "$TMP/package.tar.gz"
  ACTUAL_SHA="$(sha256sum "$TMP/package.tar.gz" | awk '{print $1}')"
  [[ "$ACTUAL_SHA" == "$ARTIFACT_SHA" ]] || { echo "Artifact SHA256 mismatch" >&2; exit 2; }
  if [[ "$ARTIFACT_SIZE" != "0" ]]; then [[ "$(stat -c %s "$TMP/package.tar.gz")" == "$ARTIFACT_SIZE" ]] || { echo "Artifact size mismatch" >&2; exit 2; }; fi
  tar -xzf "$TMP/package.tar.gz" -C "$TMP"
fi

[[ -f "$TMP/package/manifest.json" && -x "$TMP/package/runtime/node" ]] || { echo "Invalid Light Remote Linux package" >&2; exit 2; }
PACKAGE_VERSION="$(python3 - "$TMP/package/manifest.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))['version'])
PY
)"
[[ "$PACKAGE_VERSION" == "$VERSION" ]] || { echo "Package version mismatch" >&2; exit 2; }

as_root install -d -m 0755 "$ROOT/releases/$VERSION"
as_root rm -rf "$ROOT/releases/$VERSION"
as_root install -d -m 0755 "$ROOT/releases/$VERSION"
as_root cp -a --no-preserve=ownership "$TMP/package/." "$ROOT/releases/$VERSION/"
as_root chown -R root:root "$ROOT/releases/$VERSION"
as_root chmod -R go-w "$ROOT/releases/$VERSION"
as_root install -m 0644 "$TMP/update-public.pem" "$ROOT/update-public.pem"
as_root ln -sfn "$ROOT/releases/$VERSION" "$ROOT/current.next"
as_root mv -Tf "$ROOT/current.next" "$ROOT/current"
[[ -x "$ROOT/current/client/linux/light-remote" ]] || { echo "Linux CLI missing from package" >&2; exit 2; }
as_root install -m 0755 "$ROOT/current/client/linux/light-remote" /usr/local/bin/light-remote
STATE_FILE="$TARGET_HOME/.config/gpt-operator-agent/device.json"
FRESH_UNENROLLED=0
if [[ ! -f "$STATE_FILE" ]]; then
  if [[ "$DEFER_ENROLLMENT" == "1" ]]; then
    FRESH_UNENROLLED=1
  else
    echo
    echo "This Linux user is not enrolled yet. Starting device enrollment..."
    as_user "$TARGET_USER" env HOME="$TARGET_HOME" OPERATOR_AGENT_BASE_URL="$BASE_URL" OPERATOR_AGENT_HUB_URL="$HUB_URL" "$ROOT/current/runtime/node" "$ROOT/current/device-agent/operator-agent.mjs" login
    [[ -f "$STATE_FILE" ]] || { echo "Device enrollment did not produce state" >&2; exit 2; }
  fi
fi
UPDATE_STATE_DIR="$TARGET_HOME/.config/gpt-operator-agent/update-runtime"
UPDATE_REQUEST_FILE="$UPDATE_STATE_DIR/request.json"
UPDATE_CHECK_REQUEST_FILE="$UPDATE_STATE_DIR/check-request.json"
as_user "$TARGET_USER" install -d -m 0700 "$UPDATE_STATE_DIR"
UPDATER_ROOT="$ROOT/updater"
if [[ ! -x "$UPDATER_ROOT/current/runtime/node" ]]; then
  UPDATER_RELEASE="$UPDATER_ROOT/releases/$VERSION"
  as_root rm -rf "$UPDATER_RELEASE"
  as_root install -d -m 0755 "$UPDATER_RELEASE/runtime" "$UPDATER_RELEASE/client/linux" "$UPDATER_RELEASE/lib"
  as_root install -m 0755 "$ROOT/current/runtime/node" "$UPDATER_RELEASE/runtime/node"
  as_root install -m 0644 "$ROOT/current/client/linux/updater.mjs" "$UPDATER_RELEASE/client/linux/updater.mjs"
  as_root install -m 0644 "$ROOT/current/client/linux/update-lifeboat.mjs" "$UPDATER_RELEASE/client/linux/update-lifeboat.mjs"
  as_root install -m 0644 "$ROOT/current/lib/update-contract.mjs" "$UPDATER_RELEASE/lib/update-contract.mjs"
  as_root install -m 0644 "$ROOT/current/manifest.json" "$UPDATER_RELEASE/manifest.json"
  as_root ln -sfn "$UPDATER_RELEASE" "$UPDATER_ROOT/current.next"
  as_root mv -Tf "$UPDATER_ROOT/current.next" "$UPDATER_ROOT/current"
fi
POLICY_HELPER="$ROOT/current/device-agent/linux-service-policy.mjs"
NO_NEW_PRIVILEGES="$("$ROOT/current/runtime/node" "$POLICY_HELPER" "$STATE_FILE" noNewPrivileges)"
RESTRICT_SUID_SGID="$("$ROOT/current/runtime/node" "$POLICY_HELPER" "$STATE_FILE" restrictSuidSgid)"
CLEAR_CAPABILITY_BOUNDING_SET="$("$ROOT/current/runtime/node" "$POLICY_HELPER" "$STATE_FILE" clearCapabilityBoundingSet)"
for value in "$NO_NEW_PRIVILEGES" "$RESTRICT_SUID_SGID" "$CLEAR_CAPABILITY_BOUNDING_SET"; do
  [[ "$value" == "true" || "$value" == "false" ]] || { echo "Invalid Linux service policy helper output" >&2; exit 2; }
done
if [[ "$CLEAR_CAPABILITY_BOUNDING_SET" == "true" ]]; then
  CAPABILITY_BOUNDING_SET_LINE="CapabilityBoundingSet="
else
  CAPABILITY_BOUNDING_SET_LINE="# CapabilityBoundingSet left at the system default for approved sudo-on-demand"
fi
IDENTITY_FILE="$TARGET_HOME/.config/gpt-operator-agent/identity.json"
IDENTITY_ENV_LINE="# No external device identity file; private identity is stored in device state"
if [[ -f "$IDENTITY_FILE" ]]; then
  as_root chown "$TARGET_USER":"$(id -gn "$TARGET_USER")" "$IDENTITY_FILE"
  as_root chmod 0600 "$IDENTITY_FILE"
  IDENTITY_ENV_LINE="Environment=OPERATOR_AGENT_IDENTITY_FILE=$IDENTITY_FILE"
fi

as_root tee /etc/systemd/system/gpt-operator-device-agent.service >/dev/null <<UNIT
[Unit]
Description=Light Remote outbound device agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$TARGET_USER
WorkingDirectory=$TARGET_HOME
Environment=HOME=$TARGET_HOME
Environment=LIGHT_REMOTE_UPDATE_STATE_DIR=$UPDATE_STATE_DIR
Environment=OPERATOR_AGENT_BASE_URL=$BASE_URL
Environment=OPERATOR_AGENT_HUB_URL=$HUB_URL
Environment=OPERATOR_AGENT_WALL_HOST=$WALL_HOST
Environment=OPERATOR_AGENT_WALL_PORT=$WALL_PORT
$IDENTITY_ENV_LINE
ExecStart=$ROOT/current/runtime/node $ROOT/current/device-agent/operator-agent.mjs daemon
Restart=always
RestartSec=5
UMask=0077
PrivateTmp=true
ProtectSystem=strict
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
NoNewPrivileges=$NO_NEW_PRIVILEGES
RestrictSUIDSGID=$RESTRICT_SUID_SGID
$CAPABILITY_BOUNDING_SET_LINE
AmbientCapabilities=
ReadWritePaths=$TARGET_HOME/.config/gpt-operator-agent

[Install]
WantedBy=multi-user.target
UNIT

as_root tee /etc/systemd/system/gpt-operator-agent-update.service >/dev/null <<UNIT
[Unit]
Description=Update Light Remote client from signed release manifest
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=GPT_OPERATOR_UPDATE_MANIFEST_URL=$MANIFEST_URL
Environment=GPT_OPERATOR_UPDATE_SIGNATURE_URL=$SIGNATURE_URL
Environment=LIGHT_REMOTE_UPDATE_STATE_DIR=$UPDATE_STATE_DIR
ExecStart=$ROOT/updater/current/runtime/node $ROOT/updater/current/client/linux/updater.mjs
UNIT
as_root tee /etc/systemd/system/gpt-operator-agent-update-check.service >/dev/null <<UNIT
[Unit]
Description=Check signed Light Remote client update availability
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=GPT_OPERATOR_UPDATE_MANIFEST_URL=$MANIFEST_URL
Environment=GPT_OPERATOR_UPDATE_SIGNATURE_URL=$SIGNATURE_URL
Environment=LIGHT_REMOTE_UPDATE_STATE_DIR=$UPDATE_STATE_DIR
ExecStart=$ROOT/updater/current/runtime/node $ROOT/updater/current/client/linux/updater.mjs --check-only
UNIT
as_root tee /etc/systemd/system/gpt-operator-agent-update.path >/dev/null <<UNIT
[Unit]
Description=Wake Light Remote updater on owner request

[Path]
PathExists=$UPDATE_REQUEST_FILE
Unit=gpt-operator-agent-update.service

[Install]
WantedBy=multi-user.target
UNIT
as_root tee /etc/systemd/system/gpt-operator-agent-update-check.path >/dev/null <<UNIT
[Unit]
Description=Wake Light Remote update checker on owner request

[Path]
PathExists=$UPDATE_CHECK_REQUEST_FILE
Unit=gpt-operator-agent-update-check.service

[Install]
WantedBy=multi-user.target
UNIT
as_root tee /etc/systemd/system/gpt-operator-agent-update.timer >/dev/null <<'UNIT'
[Unit]
Description=Periodic Light Remote signed client update check

[Timer]
Unit=gpt-operator-agent-update-check.service
OnBootSec=5min
OnUnitActiveSec=6h
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

as_root systemctl daemon-reload
as_root systemctl enable --now gpt-operator-agent-update.timer
as_root systemctl enable --now gpt-operator-agent-update.path
as_root systemctl enable --now gpt-operator-agent-update-check.path
if [[ "$FRESH_UNENROLLED" == "1" ]]; then
  as_root systemctl disable --now gpt-operator-device-agent.service >/dev/null 2>&1 || true
  echo
  printf 'Light Remote MCP client installed: version=%s user=%s\n' "$VERSION" "$TARGET_USER"
  echo 'Enrollment is intentionally deferred for headless/server installation.'
  echo 'Next step: light-remote up'
  echo 'After approval, systemd will own the always-alive local service.'
  exit 0
fi
as_root systemctl enable --now gpt-operator-device-agent.service
if [[ "$AGENT_WAS_ACTIVE" == "1" ]]; then as_root systemctl restart gpt-operator-device-agent.service; fi
WALL_HOST="127.0.0.1"
WALL_PORT="5491"
SERVICE_ENV="$(systemctl show gpt-operator-device-agent.service --property=Environment --value 2>/dev/null || true)"
for item in $SERVICE_ENV; do
  case "$item" in
    OPERATOR_AGENT_WALL_HOST=*) WALL_HOST="${item#*=}";;
    OPERATOR_AGENT_WALL_PORT=*) WALL_PORT="${item#*=}";;
  esac
done
WALL_HOST="${WALL_HOST%\"}"; WALL_HOST="${WALL_HOST#\"}"
WALL_PORT="${WALL_PORT%\"}"; WALL_PORT="${WALL_PORT#\"}"
WALL_DISPLAY_HOST="$WALL_HOST"
if [[ "$WALL_DISPLAY_HOST" == *:* && "$WALL_DISPLAY_HOST" != \[*\] ]]; then WALL_DISPLAY_HOST="[$WALL_DISPLAY_HOST]"; fi
AGENT_HEALTHY=0
for _ in {1..40}; do
  MAIN_PID="$(systemctl show gpt-operator-device-agent.service -p MainPID --value 2>/dev/null || echo 0)"
  HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 1 "http://$WALL_DISPLAY_HOST:$WALL_PORT/" 2>/dev/null || true)"
  if systemctl is-active --quiet gpt-operator-device-agent.service && [[ "$MAIN_PID" =~ ^[1-9][0-9]*$ ]] && [[ "$HTTP_CODE" =~ ^(200|303|401)$ ]]; then AGENT_HEALTHY=1; break; fi
  sleep 0.5
done
if [[ "$AGENT_HEALTHY" != "1" ]]; then
  systemctl --no-pager --full status gpt-operator-device-agent.service | sed -n '1,24p' >&2 || true
  echo 'Light Remote Core failed post-install health gate; updater Helper was not changed.' >&2
  exit 37
fi
as_root env LIGHT_REMOTE_UPDATE_STATE_DIR="$UPDATE_STATE_DIR" "$ROOT/current/runtime/node" "$ROOT/current/lib/update-helper-reconcile.mjs" \
  --platform linux --version "$VERSION" --core-root "$ROOT/current" --install-root "$ROOT" --state-dir "$UPDATE_STATE_DIR"
systemctl --no-pager --full status gpt-operator-device-agent.service | sed -n '1,12p'
echo
printf 'Light Remote MCP client installed: version=%s user=%s\n' "$VERSION" "$TARGET_USER"
printf 'Enrollment bridge: %s\n' "$BASE_URL"
printf 'Device hub: %s\n' "$HUB_URL"
echo 'The terminal can now be closed; systemd owns the always-alive local service.'
printf 'Local Wall: http://%s:%s/ (cloud may be Connected or Dormant independently).\n' "$WALL_DISPLAY_HOST" "$WALL_PORT"
echo 'Signed update availability checks run automatically every ~6 hours; installation remains owner-triggered.'
