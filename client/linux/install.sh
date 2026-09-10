#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/gpt-operator-agent
MANIFEST_URL="${GPT_OPERATOR_UPDATE_MANIFEST_URL:-https://github.com/n8n2erpnext/light-remote-mcp/releases/latest/download/client-update.json}"
SIGNATURE_URL="${GPT_OPERATOR_UPDATE_SIGNATURE_URL:-https://github.com/n8n2erpnext/light-remote-mcp/releases/latest/download/client-update.json.sig}"
BUNDLE=""
DEV_BUNDLE=0
TARGET_USER="${SUDO_USER:-${USER:-}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle) BUNDLE="$2"; DEV_BUNDLE=1; shift 2;;
    --user) TARGET_USER="$2"; shift 2;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done

[[ -n "$TARGET_USER" ]] || { echo "Unable to determine target user" >&2; exit 2; }
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
[[ -n "$TARGET_HOME" ]] || { echo "Unable to determine home for $TARGET_USER" >&2; exit 2; }

for cmd in curl openssl python3 tar sha256sum sudo systemctl; do command -v "$cmd" >/dev/null || { echo "Missing required command: $cmd" >&2; exit 2; }; done
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
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
  echo "Installing local development bundle $VERSION"
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
sudo cp -a "$TMP/package/." "$ROOT/releases/$VERSION/"
sudo install -m 0644 "$TMP/update-public.pem" "$ROOT/update-public.pem"
sudo ln -sfn "$ROOT/releases/$VERSION" "$ROOT/current.next"
sudo mv -Tf "$ROOT/current.next" "$ROOT/current"
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
NoNewPrivileges=false
RestrictSUIDSGID=false
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
ExecStart=$ROOT/current/runtime/node $ROOT/current/client/linux/updater.mjs
UNIT
sudo tee /etc/systemd/system/gpt-operator-agent-update.timer >/dev/null <<'UNIT'
[Unit]
Description=Periodic GPT Operator signed client update check

[Timer]
OnBootSec=5min
OnUnitActiveSec=6h
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

STATE_FILE="$TARGET_HOME/.config/gpt-operator-agent/device.json"
if [[ ! -f "$STATE_FILE" ]]; then
  echo
  echo "This Linux user is not enrolled yet. Starting device enrollment..."
  sudo -u "$TARGET_USER" env HOME="$TARGET_HOME" "$ROOT/current/runtime/node" "$ROOT/current/device-agent/operator-agent.mjs" login
fi

sudo systemctl daemon-reload
sudo systemctl enable --now gpt-operator-device-agent.service
sudo systemctl enable --now gpt-operator-agent-update.timer
sleep 2
systemctl --no-pager --full status gpt-operator-device-agent.service | sed -n '1,12p'
echo
printf 'GPT Operator installed: version=%s user=%s\n' "$VERSION" "$TARGET_USER"
echo 'The terminal can now be closed; systemd owns the connection.'
echo 'Signed update checks run automatically every ~6 hours.'
