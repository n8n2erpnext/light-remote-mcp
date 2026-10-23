#!/usr/bin/env bash
# Explicit isolated UAT-only WebUI, host bind on NetBird only.
set -euo pipefail
INSTANCE=light-remote-continuity-uat
PORT=5587
DEVICE=continuity-webui-netbird
[[ "$#" == 1 && "$1" == "--explicit-netbird-uat" ]] || { echo EXPLICIT_FLAG_REQUIRED; exit 2; }
[[ "$(git branch --show-current)" == feature/project-continuity-plan-20261023 ]] || exit 2
[[ "$(lxc list "$INSTANCE" --format csv -c s)" == RUNNING ]] || exit 3
lxc exec "$INSTANCE" -- test -f /opt/light-remote-continuity/.uat-installed
NETBIRD_IP="$(ip -o -4 addr show dev wt0 | awk '{split($4,a,"/");print a[1];exit}')"
[[ "$NETBIRD_IP" =~ ^100\.([6-9][0-9]|1[0-1][0-9]|12[0-7])\.[0-9]+\.[0-9]+$ ]] ||
 { echo INVALID_NETBIRD_IP; exit 3; }
[[ "$(lxc config device list "$INSTANCE" | grep -cx "$DEVICE" || true)" == 0 ]] ||
 { echo REFUSE_EXISTING_PROXY; exit 4; }
if ss -H -ltn | awk '{print $4}' | grep -Eq "(:|^)$PORT$"; then
 echo "REFUSE_OCCUPIED_HOST_PORT:$PORT";exit 4
fi
for src in device-agent/project-continuity-uat-web.mjs device-agent/project-continuity-page.mjs device-agent/local-wall-auth.mjs; do
 lxc file push "$src" "$INSTANCE/opt/light-remote-continuity/$src"
 lxc exec "$INSTANCE" -- chmod 0644 "/opt/light-remote-continuity/$src"
done
lxc exec -T "$INSTANCE" -- /bin/bash -s <<'INNER'
set -euo pipefail
install -d -m 0700 -o lr-cont-agent -g lr-continuity-client /var/lib/light-remote-continuity-web
/usr/local/bin/light-remote-continuity-node --input-type=module <<'JS'
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {writeLocalWallAuthConfig} from '/opt/light-remote-continuity/device-agent/local-wall-auth.mjs';
const file='/var/lib/light-remote-continuity-web/auth.json';
if(!fs.existsSync(file)){
 const secret=fs.readFileSync('/root/light-remote-continuity-uat-fixture.secret','utf8').trim();
 writeLocalWallAuthConfig(file,{username:'uat-owner',password:secret,sessionTtlSeconds:3600});
 fs.chownSync(file,Number(execFileSync('id',['-u','lr-cont-agent']).toString().trim()),
  Number(execFileSync('id',['-g','lr-cont-agent']).toString().trim()));
 fs.chmodSync(file,0o600);
}
JS
cat > /etc/systemd/system/light-remote-continuity-web-uat.service <<'UNIT'
[Unit]
Description=Light Remote Project Continuity protected WebUI UAT (loopback only)
After=light-remote-continuity-uat.service
Requires=light-remote-continuity-uat.service
[Service]
Type=simple
User=lr-cont-agent
Group=lr-continuity-client
UMask=0077
WorkingDirectory=/opt/light-remote-continuity
Environment=LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER=1
Environment=LIGHT_REMOTE_CONTINUITY_BROKER_ROOT=/var/lib/light-remote-continuity
Environment=LIGHT_REMOTE_CONTINUITY_UAT_AUTH_FILE=/var/lib/light-remote-continuity-web/auth.json
Environment=LIGHT_REMOTE_CONTINUITY_UAT_WEB_PORT=5587
ExecStart=/usr/local/bin/light-remote-continuity-node /opt/light-remote-continuity/device-agent/project-continuity-uat-web.mjs
Restart=on-failure
RestartSec=2
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX AF_INET
[Install]
WantedBy=multi-user.target
UNIT
chmod 0644 /etc/systemd/system/light-remote-continuity-web-uat.service
systemctl daemon-reload
systemctl enable --now light-remote-continuity-web-uat.service
systemctl is-active --quiet light-remote-continuity-web-uat.service
test "$(stat -c '%a' /var/lib/light-remote-continuity-web/auth.json)" = 600
INNER
lxc config device add "$INSTANCE" "$DEVICE" proxy \
 listen="tcp:$NETBIRD_IP:$PORT" connect="tcp:127.0.0.1:$PORT" bind=host
printf 'WEBUI_NETBIRD_URL=http://%s:%s/projects\n' "$NETBIRD_IP" "$PORT"
echo CONTINUITY_WEBUI_LXD_PROXY_CREATED
