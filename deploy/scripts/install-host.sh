#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sudo install -d -m 0755 /opt/gpt-vps-operator
sudo install -m 0644 "$ROOT_DIR/operator-host/executor.mjs" /opt/gpt-vps-operator/executor.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/crypto.mjs" /opt/gpt-vps-operator/crypto.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/session-manager.mjs" /opt/gpt-vps-operator/session-manager.mjs
sudo install -m 0644 "$ROOT_DIR/operator-host/device-registry.mjs" /opt/gpt-vps-operator/device-registry.mjs
sudo install -d -o ubuntu -g ubuntu -m 0700 /home/ubuntu/.config/gpt-vps-operator
sudo install -d -o ubuntu -g ubuntu -m 0750 /home/ubuntu/.local/run/gpt-vps-operator
sudo install -m 0644 "$ROOT_DIR/deploy/systemd/gpt-vps-operator.service" /etc/systemd/system/gpt-vps-operator.service
sudo install -m 0644 "$ROOT_DIR/deploy/logrotate/gpt-vps-operator" /etc/logrotate.d/gpt-vps-operator
sudo systemctl daemon-reload
printf '%s\n' 'Host executor installed. Service not started automatically.'
