#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="${1:-${LIGHT_REMOTE_GATEWAY_DEST:-}}"
SERVICE="${LIGHT_REMOTE_GATEWAY_SERVICE:-light-remote-mcp-gateway}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="${LIGHT_REMOTE_GATEWAY_BACKUP_DIR:-${HOME}/.cache/light-remote-mcp/gateway-backups}"
BACKUP="$BACKUP_ROOT/gateway-$STAMP"
[[ -n "$DEST" ]] || { echo "Usage: sync-gateway.sh <compose-directory> or set LIGHT_REMOTE_GATEWAY_DEST" >&2; exit 2; }
mkdir -p "$BACKUP"
[[ -f "$DEST/docker-compose.yml" ]] || { echo "Missing live compose: $DEST/docker-compose.yml" >&2; exit 2; }
cp -a "$DEST/docker-compose.yml" "$BACKUP/docker-compose.yml"
OVERRIDE="$DEST/docker-compose.override.yml"
if [[ -f "$OVERRIDE" ]]; then cp -a "$OVERRIDE" "$BACKUP/docker-compose.override.yml"; fi
cat > "$OVERRIDE" <<EOF
services:
  ${SERVICE}:
    build:
      context: "${ROOT_DIR}"
      dockerfile: gateway/Dockerfile
EOF
IMAGE="${LIGHT_REMOTE_GATEWAY_IMAGE:-$(cd "$DEST" && docker compose config --images | head -n1)}"
[[ -n "$IMAGE" ]] || { echo 'Unable to resolve gateway image name' >&2; exit 2; }
OLD_ID="$(docker image inspect "$IMAGE" --format '{{.Id}}' 2>/dev/null || true)"
BACKUP_IMAGE=""
if [[ -n "$OLD_ID" ]]; then
  BACKUP_IMAGE="${IMAGE}:backup-${STAMP}"
  docker tag "$OLD_ID" "$BACKUP_IMAGE"
  printf '%s\n' "$OLD_ID" > "$BACKUP/previous-image-id.txt"
  printf '%s\n' "$BACKUP_IMAGE" > "$BACKUP/previous-image-tag.txt"
fi
(cd "$DEST" && docker compose build "$SERVICE")
(cd "$DEST" && docker compose up -d --no-build --force-recreate "$SERVICE")
CID="$(cd "$DEST" && docker compose ps -q "$SERVICE")"
[[ -n "$CID" ]] || { echo 'Gateway container id missing after rollout' >&2; exit 40; }
health_gate(){
  local cid="$1"
  for _ in {1..30}; do
    if docker exec "$cid" node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(j=>{if(!j.ok)process.exit(1)})" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}
if ! health_gate "$CID"; then
  echo 'Gateway health gate failed.' >&2
  if [[ -n "$BACKUP_IMAGE" ]]; then
    echo "Rolling back to $BACKUP_IMAGE" >&2
    docker tag "$BACKUP_IMAGE" "$IMAGE"
    (cd "$DEST" && docker compose up -d --no-build --force-recreate "$SERVICE")
    ROLLBACK_CID="$(cd "$DEST" && docker compose ps -q "$SERVICE")"
    health_gate "$ROLLBACK_CID" || echo 'WARNING: gateway rollback health gate also failed' >&2
  fi
  exit 41
fi
printf 'Gateway deployed from canonical repo source; image=%s backup=%s
' "$IMAGE" "$BACKUP"
