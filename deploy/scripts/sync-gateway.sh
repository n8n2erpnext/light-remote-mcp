#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="${1:-/home/ubuntu/services/lightbi-mcp-poc}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/home/ubuntu/backups/gpt-vps-operator/gateway-$STAMP"
mkdir -p "$BACKUP"
for f in server.mjs activity.mjs security.mjs workspace.mjs dashboard.mjs operator-proxy.mjs wall-auth.mjs Dockerfile package.json package-lock.json; do
  [ -e "$DEST/$f" ] && cp -a "$DEST/$f" "$BACKUP/$f"
  cp -a "$ROOT_DIR/gateway/$f" "$DEST/$f"
done
printf 'Synced gateway to %s; backup: %s\n' "$DEST" "$BACKUP"
