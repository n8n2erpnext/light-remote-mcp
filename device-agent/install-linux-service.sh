#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_NAME="${SUDO_USER:-${USER}}"
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
NODE_BIN="$(command -v node)"
STATE_FILE="$HOME_DIR/.config/gpt-operator-agent/device.json"
NO_NEW_PRIVILEGES="$($NODE_BIN "$ROOT_DIR/device-agent/linux-service-policy.mjs" "$STATE_FILE" noNewPrivileges)"
RESTRICT_SUID_SGID="$($NODE_BIN "$ROOT_DIR/device-agent/linux-service-policy.mjs" "$STATE_FILE" restrictSuidSgid)"
CLEAR_CAPABILITY_BOUNDING_SET="$($NODE_BIN "$ROOT_DIR/device-agent/linux-service-policy.mjs" "$STATE_FILE" clearCapabilityBoundingSet)"
if [[ "$CLEAR_CAPABILITY_BOUNDING_SET" == "true" ]]; then
  CAPABILITY_BOUNDING_SET_LINE="CapabilityBoundingSet="
else
  CAPABILITY_BOUNDING_SET_LINE="# CapabilityBoundingSet left at the system default for approved sudo-on-demand"
fi
sudo install -d -m 0755 /opt/gpt-operator-agent/device-agent /opt/gpt-operator-agent/device-agent/platform-adapters /opt/gpt-operator-agent/lib /opt/gpt-operator-agent/assets/branding
sudo install -m 0755 "$ROOT_DIR/device-agent/operator-agent.mjs" /opt/gpt-operator-agent/device-agent/operator-agent.mjs
sudo install -m 0644 "$ROOT_DIR/device-agent/local-wall.mjs" /opt/gpt-operator-agent/device-agent/local-wall.mjs
sudo install -m 0644 "$ROOT_DIR"/device-agent/platform-adapters/*.mjs /opt/gpt-operator-agent/device-agent/platform-adapters/
sudo install -m 0644 "$ROOT_DIR/lib/device-proof.mjs" /opt/gpt-operator-agent/lib/device-proof.mjs
sudo install -m 0644 "$ROOT_DIR/assets/branding/light-remote-mark.svg" /opt/gpt-operator-agent/assets/branding/light-remote-mark.svg
unit="$(mktemp)"
trap 'rm -f "$unit"' EXIT
cat > "$unit" <<UNIT
[Unit]
Description=GPT Operator Device Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
Environment=HOME=$HOME_DIR
ExecStart=$NODE_BIN /opt/gpt-operator-agent/device-agent/operator-agent.mjs daemon
Restart=always
RestartSec=5
UMask=0077
NoNewPrivileges=$NO_NEW_PRIVILEGES
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$HOME_DIR/.config/gpt-operator-agent
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictSUIDSGID=$RESTRICT_SUID_SGID
RestrictRealtime=true
$CAPABILITY_BOUNDING_SET_LINE
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
UNIT
sudo install -m 0644 "$unit" /etc/systemd/system/gpt-operator-device-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now gpt-operator-device-agent.service
echo "Installed gpt-operator-device-agent.service for $USER_NAME"
echo "Local Wall: http://127.0.0.1:5491/ (service stays alive even before enrollment or while cloud is dormant)"
