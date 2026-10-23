#!/usr/bin/env bash
# Explicit dedicated UAT-only installer. Refuses Gold and other containers.
set -euo pipefail
INSTANCE="light-remote-continuity-uat"
[[ "$#" == 1 && "$1" == "--explicit-uat-install" ]] || { echo 'EXPLICIT_UAT_FLAG_REQUIRED'; exit 2; }
[[ "$(git branch --show-current)" == "feature/project-continuity-plan-20261023" ]] ||
 { echo 'REFUSE_NON_CONTINUITY_BRANCH'; exit 2; }
[[ "$(lxc list "$INSTANCE" --format csv -c n)" == "$INSTANCE" ]] ||
 { echo 'DEDICATED_LXD_UAT_NOT_FOUND'; exit 3; }
[[ "$(lxc list "$INSTANCE" --format csv -c s)" == "RUNNING" ]] ||
 { echo 'DEDICATED_LXD_UAT_NOT_RUNNING'; exit 3; }
if lxc exec "$INSTANCE" -- test -e /opt/light-remote-continuity/.uat-installed; then
 echo 'REFUSE_ALREADY_INSTALLED_MUST_RUN_UPDATE_WORKFLOW'; exit 4
fi
HOST_TEMP="$(mktemp -d /home/ubuntu/light-remote-continuity-stage.XXXXXX)"
trap 'rm -rf -- "$HOST_TEMP"' EXIT
tar -czf "$HOST_TEMP/continuity-source.tar.gz" \
 device-agent/project-continuity-owner-broker.mjs \
 device-agent/project-continuity-owner-broker-cli.mjs \
 device-agent/project-continuity-owner-grants.mjs \
 device-agent/project-continuity-store.mjs \
 device-agent/project-continuity-client.mjs \
 lib/project-continuity-session-proof.mjs
gzip -c /usr/bin/node > "$HOST_TEMP/node22-aarch64.gz"
# Only our two known partial-install staging paths; never touch private DB/keys.
lxc exec "$INSTANCE" -- rm -f /tmp/continuity-source.tar.gz /tmp/node22-aarch64.gz
lxc file push "$HOST_TEMP/continuity-source.tar.gz" "$INSTANCE/tmp/continuity-source.tar.gz"
lxc file push "$HOST_TEMP/node22-aarch64.gz" "$INSTANCE/tmp/node22-aarch64.gz"
lxc exec -T "$INSTANCE" -- /bin/bash -s <<'INNER'
set -euo pipefail
test "$(uname -m)" = aarch64
test ! -e /opt/light-remote-continuity/.uat-installed
getent group lr-continuity-client >/dev/null || groupadd --system lr-continuity-client
id -u lr-continuity >/dev/null 2>&1 || useradd --system --home-dir /var/lib/light-remote-continuity --no-create-home --shell /usr/sbin/nologin \
 --gid lr-continuity-client lr-continuity
id -u lr-cont-agent >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin \
 --groups lr-continuity-client lr-cont-agent
install -d -m 0755 -o root -g root /opt/light-remote-continuity
tar -xzf /tmp/continuity-source.tar.gz -C /opt/light-remote-continuity
chown -R root:root /opt/light-remote-continuity
chmod -R go-w /opt/light-remote-continuity
find /opt/light-remote-continuity -type d -exec chmod 0755 {} +
find /opt/light-remote-continuity -type f -name '*.mjs' -exec chmod 0644 {} +
# The product source remains root-owned but group/world readable for the broker.
# Never chmod the broker's private database/key directory here.
gunzip -c /tmp/node22-aarch64.gz > /usr/local/bin/light-remote-continuity-node
chmod 0755 /usr/local/bin/light-remote-continuity-node
/usr/local/bin/light-remote-continuity-node --version | grep -q '^v22\.'
install -d -m 2710 -o lr-continuity -g lr-continuity-client /var/lib/light-remote-continuity
umask 077
if [ ! -e /root/light-remote-continuity-uat-fixture.secret ]; then
 openssl rand -hex 24 > /root/light-remote-continuity-uat-fixture.secret
fi
python3 - <<'PY'
import json,subprocess
password=open('/root/light-remote-continuity-uat-fixture.secret').read().strip()
command=['runuser','-u','lr-continuity','--','/usr/local/bin/light-remote-continuity-node',
'/opt/light-remote-continuity/device-agent/project-continuity-owner-broker-cli.mjs',
'bootstrap','--root','/var/lib/light-remote-continuity']
p=subprocess.run(command,input=json.dumps({'password':password})+'\n',
 text=True,capture_output=True,timeout=25) if not __import__('os').path.exists('/var/lib/light-remote-continuity/owner-authority-public.pem') else subprocess.CompletedProcess(command,0,'','')
assert p.returncode==0,(p.stderr or 'bootstrap failed')
PY
cat > /etc/systemd/system/light-remote-continuity-uat.service <<'UNIT'
[Unit]
Description=Isolated Light Remote Project Continuity UAT broker
After=local-fs.target
[Service]
Type=simple
User=lr-continuity
Group=lr-continuity-client
UMask=0007
ExecStart=/usr/local/bin/light-remote-continuity-node /opt/light-remote-continuity/device-agent/project-continuity-owner-broker-cli.mjs serve --root /var/lib/light-remote-continuity --controller 1 --recover-stale 1
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
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX
ReadWritePaths=/var/lib/light-remote-continuity
[Install]
WantedBy=multi-user.target
UNIT
chmod 0644 /etc/systemd/system/light-remote-continuity-uat.service
# The cached Ubuntu LXD image waits indefinitely for a degraded virtual NIC;
# the offline-first broker must not depend on network-online.target. UAT ONLY.
systemctl disable --now systemd-networkd-wait-online.service >/dev/null 2>&1 || true
systemctl mask systemd-networkd-wait-online.service >/dev/null 2>&1 || true
systemctl daemon-reload
systemctl enable --now light-remote-continuity-uat.service
test "$(systemctl is-active light-remote-continuity-uat.service)" = active
touch /opt/light-remote-continuity/.uat-installed
rm -f /tmp/continuity-source.tar.gz /tmp/node22-aarch64.gz
echo 'LINUX_LXD_FIXED_SERVICE_INSTALL_PASS'
INNER
echo 'DEDICATED_ISOLATED_UAT_INSTALLED'
