#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/gpt-operator-agent
MANIFEST_URL="${GPT_OPERATOR_UPDATE_MANIFEST_URL:-https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/main/channels/beta/client-update.json}"
SIGNATURE_URL="${GPT_OPERATOR_UPDATE_SIGNATURE_URL:-https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/main/channels/beta/client-update.json.sig}"
BASE_URL="${OPERATOR_AGENT_BASE_URL:-https://light-remote-mcp.vercel.app}"
HUB_URL="${OPERATOR_AGENT_HUB_URL:-https://mcp.dashboard.thaiduy.store}"
BUNDLE=""
DEV_BUNDLE=0
TARGET_USER="${SUDO_USER:-${USER:-}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle) BUNDLE="$2"; DEV_BUNDLE=1; shift 2;;
    --user) TARGET_USER="$2"; shift 2;;
    --base-url) BASE_URL="${2%/}"; shift 2;;
    --hub-url) HUB_URL="${2%/}"; shift 2;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done

[[ -n "$TARGET_USER" ]] || { echo "Unable to determine target user" >&2; exit 2; }
[[ "$BASE_URL" == https://* ]] || { echo "--base-url must be HTTPS" >&2; exit 2; }
[[ "$HUB_URL" == https://* ]] || { echo "--hub-url must be HTTPS" >&2; exit 2; }
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
[[ -n "$TARGET_HOME" ]] || { echo "Unable to determine home for $TARGET_USER" >&2; exit 2; }

for cmd in curl openssl python3 tar sha256sum sudo systemctl; do command -v "$cmd" >/dev/null || { echo "Missing required command: $cmd" >&2; exit 2; }; done
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

[[ -f "$TMP/package/manifest.json" && -x "$TMP/package/runtime/node" ]] || { echo "Invalid GPT Operator Linux package" >&2; exit 2; }
PACKAGE_VERSION="$(python3 - "$TMP/package/manifest.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))['version'])
PY
)"
[[ "$PACKAGE_VERSION" == "$VERSION" ]] || { echo "Package version mismatch" >&2; exit 2; }

sudo install -d -m 0755 "$ROOT/releases/$VERSION"
sudo rm -rf "$ROOT/releases/$VERSION"
sudo install -d -m 0755 "$ROOT/releases/$VERSION"
sudo cp -a --no-preserve=ownership "$TMP/package/." "$ROOT/releases/$VERSION/"
sudo chown -R root:root "$ROOT/releases/$VERSION"
sudo chmod -R go-w "$ROOT/releases/$VERSION"
sudo install -m 0644 "$TMP/update-public.pem" "$ROOT/update-public.pem"
sudo ln -sfn "$ROOT/releases/$VERSION" "$ROOT/current.next"
sudo mv -Tf "$ROOT/current.next" "$ROOT/current"
STATE_FILE="$TARGET_HOME/.config/gpt-operator-agent/device.json"
if [[ ! -f "$STATE_FILE" ]]; then
  echo
  echo "This Linux user is not enrolled yet. Starting device enrollment..."
  sudo -u "$TARGET_USER" env HOME="$TARGET_HOME" OPERATOR_AGENT_BASE_URL="$BASE_URL" OPERATOR_AGENT_HUB_URL="$HUB_URL" "$ROOT/current/runtime/node" "$ROOT/current/device-agent/operator-agent.mjs" login
fi
[[ -f "$STATE_FILE" ]] || { echo "Device enrollment did not produce state" >&2; exit 2; }
UPDATE_STATE_DIR="$TARGET_HOME/.config/gpt-operator-agent/update-runtime"
UPDATE_REQUEST_FILE="$UPDATE_STATE_DIR/request.json"
UPDATE_CHECK_REQUEST_FILE="$UPDATE_STATE_DIR/check-request.json"
sudo -u "$TARGET_USER" install -d -m 0700 "$UPDATE_STATE_DIR"
UPDATER_ROOT="$ROOT/updater"
if [[ ! -x "$UPDATER_ROOT/current/runtime/node" ]]; then
  UPDATER_RELEASE="$UPDATER_ROOT/releases/$VERSION"
  sudo rm -rf "$UPDATER_RELEASE"
  sudo install -d -m 0755 "$UPDATER_RELEASE/runtime" "$UPDATER_RELEASE/client/linux" "$UPDATER_RELEASE/lib"
  sudo install -m 0755 "$ROOT/current/runtime/node" "$UPDATER_RELEASE/runtime/node"
  sudo install -m 0644 "$ROOT/current/client/linux/updater.mjs" "$UPDATER_RELEASE/client/linux/updater.mjs"
  sudo install -m 0644 "$ROOT/current/client/linux/update-lifeboat.mjs" "$UPDATER_RELEASE/client/linux/update-lifeboat.mjs"
  sudo install -m 0644 "$ROOT/current/lib/update-contract.mjs" "$UPDATER_RELEASE/lib/update-contract.mjs"
  sudo install -m 0644 "$ROOT/current/manifest.json" "$UPDATER_RELEASE/manifest.json"
  sudo ln -sfn "$UPDATER_RELEASE" "$UPDATER_ROOT/current.next"
  sudo mv -Tf "$UPDATER_ROOT/current.next" "$UPDATER_ROOT/current"
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

sudo tee /etc/systemd/system/gpt-operator-device-agent.service >/dev/null <<UNIT
[Unit]
Description=GPT Operator outbound device agent
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

sudo tee /etc/systemd/system/gpt-operator-agent-update.service >/dev/null <<UNIT
[Unit]
Description=Update GPT Operator client from signed release manifest
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=GPT_OPERATOR_UPDATE_MANIFEST_URL=$MANIFEST_URL
Environment=GPT_OPERATOR_UPDATE_SIGNATURE_URL=$SIGNATURE_URL
Environment=LIGHT_REMOTE_UPDATE_STATE_DIR=$UPDATE_STATE_DIR
ExecStart=$ROOT/updater/current/runtime/node $ROOT/updater/current/client/linux/updater.mjs
UNIT
sudo tee /etc/systemd/system/gpt-operator-agent-update-check.service >/dev/null <<UNIT
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
sudo tee /etc/systemd/system/gpt-operator-agent-update.path >/dev/null <<UNIT
[Unit]
Description=Wake Light Remote updater on owner request

[Path]
PathExists=$UPDATE_REQUEST_FILE
Unit=gpt-operator-agent-update.service

[Install]
WantedBy=multi-user.target
UNIT
sudo tee /etc/systemd/system/gpt-operator-agent-update-check.path >/dev/null <<UNIT
[Unit]
Description=Wake Light Remote update checker on owner request

[Path]
PathExists=$UPDATE_CHECK_REQUEST_FILE
Unit=gpt-operator-agent-update-check.service

[Install]
WantedBy=multi-user.target
UNIT
sudo tee /etc/systemd/system/gpt-operator-agent-update.timer >/dev/null <<'UNIT'
[Unit]
Description=Periodic GPT Operator signed client update check

[Timer]
Unit=gpt-operator-agent-update-check.service
OnBootSec=5min
OnUnitActiveSec=6h
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now gpt-operator-device-agent.service
sudo systemctl enable --now gpt-operator-agent-update.timer
sudo systemctl enable --now gpt-operator-agent-update.path
sudo systemctl enable --now gpt-operator-agent-update-check.path
if [[ "$AGENT_WAS_ACTIVE" == "1" ]]; then sudo systemctl restart gpt-operator-device-agent.service; fi
sleep 2
systemctl --no-pager --full status gpt-operator-device-agent.service | sed -n '1,12p'
echo
printf 'Light Remote MCP client installed: version=%s user=%s\n' "$VERSION" "$TARGET_USER"
printf 'Enrollment bridge: %s\n' "$BASE_URL"
printf 'Device hub: %s\n' "$HUB_URL"
echo 'The terminal can now be closed; systemd owns the always-alive local service.'
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
printf 'Local Wall: http://%s:%s/ (cloud may be Connected or Dormant independently).\n' "$WALL_DISPLAY_HOST" "$WALL_PORT"
echo 'Signed update availability checks run automatically every ~6 hours; installation remains owner-triggered.'
