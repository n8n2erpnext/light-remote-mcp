#!/usr/bin/env bash
# Explicit rollback only for ephemeral GOLD UAT NetBird publishing.
set -euo pipefail
[[ "$#" == 1 && "$1" == --explicit-rollback-gold-uat-netbird ]] || exit 2
[[ "$(git branch --show-current)" == feature/project-continuity-plan-20261023 ]] || exit 2
INSTANCE=light-remote-gold-uat
DROPIN=/etc/systemd/system/light-remote-gold-plugin.service.d/zzzz-netbird-owner-uat.conf
test "$(lxc config device get "$INSTANCE" gold-enrollment-netbird listen)" = tcp:100.94.184.141:5588
test "$(lxc config device get "$INSTANCE" gold-enrollment-netbird connect)" = tcp:10.192.135.61:5583
lxc exec "$INSTANCE" -- test -e "$DROPIN"
lxc config device remove "$INSTANCE" gold-enrollment-netbird
lxc exec -T "$INSTANCE" -- bash -s <<'INNER'
set -euo pipefail
file=/etc/systemd/system/light-remote-gold-plugin.service.d/zzzz-netbird-owner-uat.conf
grep -q '^Environment=LIGHT_REMOTE_PLUGIN_ALLOWED_HOSTS=gold.light-remote.thaiduy.digital,100.94.184.141$' "$file"
rm -f "$file"
systemctl daemon-reload
systemctl restart light-remote-gold-plugin.service
systemctl is-active --quiet light-remote-gold-plugin.service
INNER
echo GOLD_UAT_NETBIRD_BROWSER_NAT_REVOKED
