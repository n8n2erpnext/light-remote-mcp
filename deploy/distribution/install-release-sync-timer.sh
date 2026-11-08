#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sudo install -m 0644 "$ROOT/deploy/distribution/light-remote-release-sync.service" /etc/systemd/system/light-remote-release-sync.service
sudo install -m 0644 "$ROOT/deploy/distribution/light-remote-release-sync.timer" /etc/systemd/system/light-remote-release-sync.timer
sudo systemctl daemon-reload
sudo systemctl enable --now light-remote-release-sync.timer
echo "light-remote-release-sync-timer=enabled"
