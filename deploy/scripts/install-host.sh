#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sudo install -d -m 0755 /opt/gpt-vps-operator
sudo install -m 0644 "$ROOT_DIR/operator-host/executor.mjs" /opt/gpt-vps-operator/executor.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/crypto.mjs" /opt/gpt-vps-operator/crypto.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/session-manager.mjs" /opt/gpt-vps-operator/session-manager.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/device-registry.mjs" /opt/gpt-vps-operator/device-registry.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/enrollment-registry.mjs" /opt/gpt-vps-operator/enrollment-registry.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/fleet-router.mjs" /opt/gpt-vps-operator/fleet-router.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/device-connection-registry.mjs" /opt/gpt-vps-operator/device-connection-registry.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/device-access-grant-registry.mjs" /opt/gpt-vps-operator/device-access-grant-registry.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/device-pairing-registry.mjs" /opt/gpt-vps-operator/device-pairing-registry.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/agent-client-registry.mjs" /opt/gpt-vps-operator/agent-client-registry.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/account-registry.mjs" /opt/gpt-vps-operator/account-registry.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/usage-registry.mjs" /opt/gpt-vps-operator/usage-registry.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/license-key-registry.mjs" /opt/gpt-vps-operator/license-key-registry.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/fleet-authority-registry.mjs" /opt/gpt-vps-operator/fleet-authority-registry.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/host-device-identity.mjs" /opt/gpt-vps-operator/host-device-identity.mjs
sudo install -m 0755 "$ROOT_DIR/deploy/scripts/light-remote-license-admin.mjs" /opt/gpt-vps-operator/light-remote-license-admin.mjs
sudo install -m 0644 "$ROOT_DIR/lib/device-proof.mjs" /opt/gpt-vps-operator/device-proof.mjs
sudo install -d -m 0755 /opt/gpt-vps-operator/host-wall/device-agent/platform-adapters /opt/gpt-vps-operator/host-wall/lib /opt/gpt-vps-operator/host-wall/assets/branding /opt/gpt-vps-operator/host-wall/client
sudo install -m 0644 "$ROOT_DIR/device-agent/operator-agent.mjs" "$ROOT_DIR/device-agent/local-wall.mjs" "$ROOT_DIR/device-agent/local-wall-auth.mjs" "$ROOT_DIR/device-agent/fleet-component-manager.mjs" "$ROOT_DIR/device-agent/fleet-component-supervisor.mjs" /opt/gpt-vps-operator/host-wall/device-agent/
sudo install -m 0644 "$ROOT_DIR/device-agent/platform-adapters/"*.mjs /opt/gpt-vps-operator/host-wall/device-agent/platform-adapters/
sudo install -m 0644 "$ROOT_DIR/lib/device-proof.mjs" /opt/gpt-vps-operator/host-wall/lib/device-proof.mjs
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
