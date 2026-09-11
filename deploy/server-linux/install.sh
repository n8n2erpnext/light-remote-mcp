#!/usr/bin/env bash
set -euo pipefail

VERSION="${LIGHT_REMOTE_VERSION:-0.9.0-beta.1}"
ROOT="/opt/light-remote-mcp/server"
ETC="/etc/light-remote-mcp"
STATE="/var/lib/light-remote-mcp"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_USER="${SUDO_USER:-${USER:-}}"
VERCEL_TEAM=""
VERCEL_PROJECT="light-remote-mcp"
PUBLIC_MCP_URL=""
MCP_BIND="127.0.0.1"
MCP_PORT="8080"
WALL_BIND="127.0.0.1"
WALL_PORT="8081"
WALL_URL=""
WALL_COOKIE_SECURE="auto"
INSTALL_DEPS=0
WORKSPACES=()

usage() {
  printf '%s\n' \
    'Usage: sudo ./install.sh --vercel-team TEAM --public-mcp-url https://mcp.example.com [options]' \
    '  --user USER                  executor owner (default: invoking sudo user)' \
    '  --vercel-project NAME        Vercel project name (default: light-remote-mcp)' \
    '  --mcp-bind ADDRESS           local MCP listener bind (default: 127.0.0.1)' \
    '  --mcp-port PORT              local MCP listener port (default: 8080)' \
    '  --wall-bind ADDRESS          Wall listener bind (default: 127.0.0.1)' \
    '  --wall-port PORT             Wall listener port (default: 8081)' \
    '  --wall-url URL                owner-facing Wall base URL used in enrollment links' \
    '  --wall-cookie-secure BOOL     true/false; default auto from Wall URL' \
    '  --workspace NAME=PATH        add read-only MCP workspace; repeatable' \
    '  --install-deps               apt-install Docker/Git/Curl/OpenSSL when possible'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) TARGET_USER="$2"; shift 2 ;;
    --vercel-team) VERCEL_TEAM="$2"; shift 2 ;;
    --vercel-project) VERCEL_PROJECT="$2"; shift 2 ;;
    --public-mcp-url) PUBLIC_MCP_URL="${2%/}"; shift 2 ;;
    --mcp-bind) MCP_BIND="$2"; shift 2 ;;
    --mcp-port) MCP_PORT="$2"; shift 2 ;;
    --wall-bind) WALL_BIND="$2"; shift 2 ;;
    --wall-port) WALL_PORT="$2"; shift 2 ;;
    --wall-url) WALL_URL="${2%/}"; shift 2 ;;
    --wall-cookie-secure) WALL_COOKIE_SECURE="$2"; shift 2 ;;
    --workspace) WORKSPACES+=("$2"); shift 2 ;;
    --install-deps) INSTALL_DEPS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo 'Run this installer with sudo/root.' >&2; exit 2; }
[[ -n "$TARGET_USER" && "$TARGET_USER" != root ]] || { echo 'Choose a non-root --user for the executor.' >&2; exit 2; }
[[ -n "$VERCEL_TEAM" ]] || { echo '--vercel-team is required.' >&2; exit 2; }
[[ "$PUBLIC_MCP_URL" == https://* ]] || { echo '--public-mcp-url must be HTTPS.' >&2; exit 2; }
[[ "$WALL_COOKIE_SECURE" == true || "$WALL_COOKIE_SECURE" == false || "$WALL_COOKIE_SECURE" == auto ]] || { echo '--wall-cookie-secure must be true, false, or auto.' >&2; exit 2; }
if [[ "$INSTALL_DEPS" == 1 ]]; then
  command -v apt-get >/dev/null || { echo '--install-deps currently supports Debian/Ubuntu only.' >&2; exit 2; }
  apt-get update
  apt-get install -y ca-certificates curl git openssl docker.io
  if ! docker compose version >/dev/null 2>&1; then
    apt-get install -y docker-compose-v2 2>/dev/null || apt-get install -y docker-compose-plugin
  fi
fi

for cmd in getent install python3 docker systemctl; do
  command -v "$cmd" >/dev/null || { echo "Missing required command: $cmd" >&2; exit 2; }
done
docker compose version >/dev/null 2>&1 || { echo 'Docker Compose v2 is required.' >&2; exit 2; }
[[ -x "$SRC/runtime/node" && -f "$SRC/gateway/package.json" && -f "$SRC/operator-host/executor.mjs" ]] || {
  echo 'Invalid server bundle: runtime/gateway/operator-host payload is missing.' >&2; exit 2;
}
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
TARGET_GROUP="$(id -gn "$TARGET_USER")"
TARGET_UID="$(id -u "$TARGET_USER")"
TARGET_GID="$(id -g "$TARGET_USER")"
[[ -n "$TARGET_HOME" ]] || { echo "Unable to resolve home for $TARGET_USER" >&2; exit 2; }

PUBLIC_HOST="$(python3 - "$PUBLIC_MCP_URL" <<'PY'
from urllib.parse import urlparse
import sys
u=urlparse(sys.argv[1]); print(u.hostname or '')
PY
)"
[[ -n "$PUBLIC_HOST" ]] || { echo 'Unable to parse --public-mcp-url.' >&2; exit 2; }
if [[ -z "$WALL_URL" ]]; then
  if [[ "$WALL_BIND" == "127.0.0.1" || "$WALL_BIND" == "localhost" || "$WALL_BIND" == "::1" ]]; then
    WALL_URL="http://127.0.0.1:${WALL_PORT}"
  else
    echo '--wall-url is required when Wall binds beyond localhost.' >&2; exit 2
  fi
fi
if [[ "$WALL_COOKIE_SECURE" == auto ]]; then
  [[ "$WALL_URL" == https://* ]] && WALL_COOKIE_SECURE=true || WALL_COOKIE_SECURE=false
fi
if [[ "$WALL_URL" == https://* && "$WALL_COOKIE_SECURE" != true ]]; then
  echo 'HTTPS Wall requires secure cookies; use --wall-cookie-secure true.' >&2; exit 2
fi

install -d -m 0755 "$ROOT/releases/$VERSION" "$ETC" "$STATE" /run/light-remote-mcp
rm -rf "$ROOT/releases/$VERSION"
install -d -m 0755 "$ROOT/releases/$VERSION"
cp -a "$SRC/runtime" "$SRC/operator-host" "$SRC/gateway" "$SRC/lib" "$SRC/deploy" "$ROOT/releases/$VERSION/"
for f in LICENSE NOTICE VERSION THIRD_PARTY_DISTRIBUTION_NOTICES.md; do [[ -f "$SRC/$f" ]] && cp -a "$SRC/$f" "$ROOT/releases/$VERSION/$f"; done
chown -R root:root "$ROOT/releases/$VERSION"
chmod -R go-w "$ROOT/releases/$VERSION"
ln -sfn "$ROOT/releases/$VERSION" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
if [[ ! -f "$ETC/operator.private.json" ]]; then
  "$ROOT/current/runtime/node" "$ROOT/current/deploy/scripts/generate-operator-key.mjs" \
    "$ETC/operator-public-keys.json" "$ETC/operator.private.json"
fi
chown "$TARGET_USER:$TARGET_GROUP" "$ETC/operator.private.json"
chmod 0600 "$ETC/operator.private.json"
chmod 0644 "$ETC/operator-public-keys.json"

if [[ ! -f "$ETC/wall-auth.json" ]]; then
  "$ROOT/current/runtime/node" "$ROOT/current/deploy/scripts/generate-wall-auth.mjs" "$ETC"
fi
chown "$TARGET_USER:$TARGET_GROUP" "$ETC/wall-auth.json"
chmod 0600 "$ETC/wall-auth.json"
chmod 0600 "$ETC/wall-bootstrap-password"

WORKSPACE_DIR="$STATE/workspace"
install -d -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0750 "$WORKSPACE_DIR"
if [[ ${#WORKSPACES[@]} -eq 0 ]]; then WORKSPACES+=("workspace=$WORKSPACE_DIR"); fi
WORKSPACE_JSON="$(python3 - "${WORKSPACES[@]}" <<'PY'
import json,os,re,sys
out={}
for item in sys.argv[1:]:
    if '=' not in item: raise SystemExit('workspace must be NAME=PATH')
    name,path=item.split('=',1)
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,64}',name): raise SystemExit('invalid workspace name: '+name)
    path=os.path.abspath(path)
    if not os.path.isdir(path): raise SystemExit('workspace path does not exist: '+path)
    out[name]='/workspace/'+name
print(json.dumps(out,separators=(',',':')))
PY
)"

cat > "$ETC/server.env" <<EOF
LIGHT_REMOTE_VERSION=$VERSION
TARGET_UID=$TARGET_UID
TARGET_GID=$TARGET_GID
VERCEL_TEAM_SLUG=$VERCEL_TEAM
VERCEL_PROJECT_NAME=$VERCEL_PROJECT
VERCEL_ENVIRONMENT=production
VERCEL_AUDIENCE=$PUBLIC_MCP_URL
MCP_ALLOWED_HOSTS=$PUBLIC_HOST
MCP_PUBLIC_ORIGIN=$PUBLIC_MCP_URL
MCP_BIND=$MCP_BIND
MCP_PORT=$MCP_PORT
WALL_BIND=$WALL_BIND
WALL_PORT=$WALL_PORT
WALL_COOKIE_SECURE=$WALL_COOKIE_SECURE
MCP_WORKSPACE_ROOTS_JSON=$WORKSPACE_JSON
EOF
chmod 0600 "$ETC/server.env"
cat > "$ETC/docker-compose.yml" <<EOF
services:
  gateway:
    build: $ROOT/current/gateway
    container_name: light-remote-mcp-gateway
    restart: unless-stopped
    user: "$TARGET_UID:$TARGET_GID"
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    tmpfs:
      - /tmp:size=16m,noexec,nosuid,nodev
    env_file:
      - $ETC/server.env
    environment:
      OPERATOR_SOCKET: /run/light-remote-mcp/operator.sock
      WALL_AUTH_CONFIG_FILE: /run/secrets/wall-auth.json
      OPERATOR_PUBLIC_KEYS_FILE: /run/secrets/operator-public-keys.json
    ports:
      - "$MCP_BIND:$MCP_PORT:8080"
      - "$WALL_BIND:$WALL_PORT:8081"
    volumes:
      - /run/light-remote-mcp:/run/light-remote-mcp:ro
      - $ETC/wall-auth.json:/run/secrets/wall-auth.json:ro
      - $ETC/operator-public-keys.json:/run/secrets/operator-public-keys.json:ro
EOF
for item in "${WORKSPACES[@]}"; do
  name="${item%%=*}"
  host_path="$(python3 - "${item#*=}" <<'PY'
import os,sys
print(os.path.abspath(sys.argv[1]))
PY
)"
  printf '      - "%s:/workspace/%s:ro"\n' "$host_path" "$name" >> "$ETC/docker-compose.yml"
done
chmod 0600 "$ETC/docker-compose.yml"

cat > /etc/systemd/system/light-remote-mcp-host.service <<EOF
[Unit]
Description=Light Remote MCP durable host executor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$TARGET_USER
Group=$TARGET_GROUP
WorkingDirectory=$TARGET_HOME
RuntimeDirectory=light-remote-mcp
RuntimeDirectoryMode=0750
StateDirectory=light-remote-mcp
StateDirectoryMode=0750
LogsDirectory=light-remote-mcp
LogsDirectoryMode=0750
Environment=OPERATOR_SOCKET=/run/light-remote-mcp/operator.sock
Environment=OPERATOR_KEY_FILE=$ETC/operator.private.json
Environment=OPERATOR_LOG_DIR=/var/log/light-remote-mcp
Environment=OPERATOR_STATE_DIR=/var/lib/light-remote-mcp
Environment=OPERATOR_ACCOUNT_ID=self-hosted-local
Environment=OPERATOR_DEVICE_ID=server-local
Environment=OPERATOR_NODE_ID=server
Environment=OPERATOR_DEVICE_NAME=%H
Environment=OPERATOR_DEVICE_POLICY_PROFILE=self-hosted-owner
Environment=OPERATOR_ENROLLMENT_ACTIVATION_URL=$WALL_URL/enroll
ExecStart=$ROOT/current/runtime/node $ROOT/current/operator-host/executor.mjs
Restart=always
RestartSec=2
TimeoutStopSec=15
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now docker.service >/dev/null 2>&1 || true
systemctl enable --now light-remote-mcp-host.service
sleep 1
systemctl is-active --quiet light-remote-mcp-host.service || { systemctl --no-pager status light-remote-mcp-host.service; exit 1; }
docker compose --env-file "$ETC/server.env" -f "$ETC/docker-compose.yml" up -d --build
sleep 2
docker compose --env-file "$ETC/server.env" -f "$ETC/docker-compose.yml" ps

printf '\nLight Remote MCP Server %s installed.\n' "$VERSION"
printf 'MCP local listener: http://%s:%s (publish through HTTPS at %s)\n' "$MCP_BIND" "$MCP_PORT" "$PUBLIC_MCP_URL"
printf 'Wall listener: %s (enrollment URL base: %s)\n' "$WALL_BIND:$WALL_PORT" "$WALL_URL"
printf 'Wall bootstrap password file: %s\n' "$ETC/wall-bootstrap-password"
printf 'Vercel OPERATOR_PUBLIC_KEYS_JSON value:\n'
tr -d '\n' < "$ETC/operator-public-keys.json"; printf '\n'
printf 'Server config: %s/server.env\n' "$ETC"
