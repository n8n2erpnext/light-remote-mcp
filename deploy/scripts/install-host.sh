#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sudo install -d -m 0755 /opt/gpt-vps-operator/operator-host /opt/gpt-vps-operator/lib /opt/gpt-vps-operator/device-agent/platform-adapters
sudo install -m 0644 "$ROOT_DIR"/operator-host/*.mjs /opt/gpt-vps-operator/operator-host/
for lib in device-proof.mjs native-fs.mjs native-process.mjs native-terminal.mjs native-search.mjs activity-ring.mjs light-scp-file.mjs light-scp-registry.mjs update-contract.mjs runtime-version.mjs version-compat.mjs update-helper-reconcile.mjs brand.mjs; do
  sudo install -m 0644 "$ROOT_DIR/lib/$lib" "/opt/gpt-vps-operator/lib/$lib"
done
NODE_BIN="$(command -v node)"
TERMINAL_ARCH="$("$NODE_BIN" -p 'process.arch')"
case "$TERMINAL_ARCH" in x64|arm64) ;; *) echo "Unsupported terminal runtime architecture: $TERMINAL_ARCH" >&2; exit 2;; esac
sudo "$NODE_BIN" "$ROOT_DIR/deploy/scripts/stage-terminal-runtime.mjs" /opt/gpt-vps-operator linux "$TERMINAL_ARCH"
sudo install -m 0644 "$ROOT_DIR"/device-agent/platform-adapters/*.mjs /opt/gpt-vps-operator/device-agent/platform-adapters/
sudo install -m 0755 "$ROOT_DIR/deploy/scripts/light-remote-license-admin.mjs" /opt/gpt-vps-operator/light-remote-license-admin.mjs
sudo install -m 0644 "$ROOT_DIR/VERSION" /opt/gpt-vps-operator/VERSION
sudo install -d -m 0755 /opt/gpt-vps-operator/host-wall/device-agent/platform-adapters /opt/gpt-vps-operator/host-wall/lib /opt/gpt-vps-operator/host-wall/assets/branding /opt/gpt-vps-operator/host-wall/client
sudo install -m 0644 "$ROOT_DIR/device-agent/operator-agent.mjs" "$ROOT_DIR/device-agent/local-wall.mjs" "$ROOT_DIR/device-agent/local-wall-auth.mjs" "$ROOT_DIR/device-agent/update-settings-page.mjs" "$ROOT_DIR/device-agent/fleet-component-manager.mjs" "$ROOT_DIR/device-agent/fleet-component-supervisor.mjs" /opt/gpt-vps-operator/host-wall/device-agent/
sudo install -m 0644 "$ROOT_DIR/device-agent/platform-adapters/"*.mjs /opt/gpt-vps-operator/host-wall/device-agent/platform-adapters/
for lib in device-proof.mjs native-fs.mjs native-process.mjs native-terminal.mjs native-search.mjs activity-ring.mjs light-scp-file.mjs light-scp-registry.mjs update-contract.mjs runtime-version.mjs version-compat.mjs update-helper-reconcile.mjs brand.mjs; do
  sudo install -m 0644 "$ROOT_DIR/lib/$lib" "/opt/gpt-vps-operator/host-wall/lib/$lib"
done
sudo install -m 0644 "$ROOT_DIR/assets/branding/light-remote-mark.svg" /opt/gpt-vps-operator/host-wall/assets/branding/light-remote-mark.svg
sudo install -m 0644 "$ROOT_DIR/client/update-public.pem" /opt/gpt-vps-operator/host-wall/client/update-public.pem
sudo install -m 0644 "$ROOT_DIR/VERSION" /opt/gpt-vps-operator/host-wall/VERSION
sudo install -d -o ubuntu -g ubuntu -m 0700 /home/ubuntu/.config/gpt-vps-operator
sudo install -d -o ubuntu -g ubuntu -m 0750 /home/ubuntu/.local/run/gpt-vps-operator
sudo install -m 0644 "$ROOT_DIR/deploy/systemd/gpt-vps-operator.service" /etc/systemd/system/gpt-vps-operator.service
sudo install -m 0644 "$ROOT_DIR/deploy/systemd/light-remote-host-wall.service" /etc/systemd/system/light-remote-host-wall.service
sudo install -m 0644 "$ROOT_DIR/deploy/logrotate/gpt-vps-operator" /etc/logrotate.d/gpt-vps-operator
sudo systemctl daemon-reload
printf '%s\n' 'Host executor installed. Service not started automatically.'
