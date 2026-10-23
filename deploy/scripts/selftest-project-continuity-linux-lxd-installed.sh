#!/usr/bin/env bash
# Safe repeatable read-only acceptance for the dedicated installed LXD UAT.
set -euo pipefail
INSTANCE=light-remote-continuity-uat
[[ "$(lxc list "$INSTANCE" --format csv -c n)" == "$INSTANCE" ]] || exit 3
[[ "$(lxc list "$INSTANCE" --format csv -c s)" == RUNNING ]] || exit 3
lxc exec "$INSTANCE" -- test -f /opt/light-remote-continuity/.uat-installed
lxc exec "$INSTANCE" -- systemctl is-enabled --quiet light-remote-continuity-uat.service
lxc exec "$INSTANCE" -- systemctl is-active --quiet light-remote-continuity-uat.service
lxc exec "$INSTANCE" -- sh -c '
 test "$(stat -c %U /var/lib/light-remote-continuity)" = lr-continuity
 test "$(stat -c %a /var/lib/light-remote-continuity/owner-broker.sock)" = 660
 test "$(stat -c %a /var/lib/light-remote-continuity/controller)" = 700
 test "$(stat -c %a /var/lib/light-remote-continuity/private)" = 700
 test "$(stat -c %a /var/lib/light-remote-continuity/private/continuity-owner-private.enc.json)" = 600
 test "$(systemctl show -p User --value light-remote-continuity-uat.service)" = lr-continuity
 test "$(systemctl show -p NoNewPrivileges --value light-remote-continuity-uat.service)" = yes
'
lxc exec "$INSTANCE" -- runuser -u lr-cont-agent -- env \
 LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER=1 \
 LIGHT_REMOTE_CONTINUITY_BROKER_ROOT=/var/lib/light-remote-continuity \
 /usr/local/bin/light-remote-continuity-node \
 /opt/light-remote-continuity/deploy/scripts/uat-project-continuity-linux-lxd-client.mjs verify-revoked
echo LINUX_LXD_INSTALLED_BROKER_FIXED_UID_SOCKET_MEMORY_CONSENT_PASS
