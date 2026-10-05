#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
USER_UNITS="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$USER_UNITS"
install -m 0644 "$ROOT/deploy/distribution/light-remote-release-sync.service" "$USER_UNITS/light-remote-release-sync.service"
install -m 0644 "$ROOT/deploy/distribution/light-remote-release-sync.timer" "$USER_UNITS/light-remote-release-sync.timer"
systemctl --user daemon-reload
systemctl --user enable --now light-remote-release-sync.timer
echo "light-remote-release-sync-timer=enabled"
