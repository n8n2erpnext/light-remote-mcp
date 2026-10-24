#!/usr/bin/env bash
# Existing Gold UAT Account/Enrollment via native NetBird-bound LXD proxy.
# No extra Wall/server, no production changes.
set -euo pipefail
INSTANCE=light-remote-gold-uat
DEVICE=gold-enrollment-netbird
NB_IP=100.94.184.141
NB_PORT=5588
[[ "$#" == 1 && "$1" == "--explicit-netbird-gold-uat" ]] || { echo EXPLICIT_UAT_FLAG_REQUIRED;exit 2; }
[[ "$(git branch --show-current)" == feature/project-continuity-plan-20261023 ]] || exit 2
[[ "$(ip -4 -o addr show dev wt0 | awk '{split($4,a,"/");print a[1];exit}')" == "$NB_IP" ]] || { echo NETBIRD_IP_MISMATCH;exit 3;}
[[ "$(lxc config device get "$INSTANCE" eth0 ipv4.address)" == 10.192.135.61 ]] || exit 3
lxc exec "$INSTANCE" -- systemctl is-active --quiet light-remote-gold-plugin
if lxc config device list "$INSTANCE" | grep -qx "$DEVICE"; then
 echo UAT_NETBIRD_PROXY_ALREADY_EXISTS; exit 0
fi
if ss -H -ltn | awk '{print $4}' | grep -Eq ":$NB_PORT$"; then echo REFUSE_HOST_PORT_COLLISION;exit 4;fi
OLD_HOST="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 4 -H "Host: $NB_IP:$NB_PORT" http://10.192.135.61:5583/account/login)"
[[ "$OLD_HOST" == 403 ]] || { echo EXPECTED_403_NOT_FOUND;exit 4; }
lxc exec -T "$INSTANCE" -- bash -s <<'INNER'
set -euo pipefail
test -d /etc/systemd/system/light-remote-gold-plugin.service.d
test ! -e /etc/systemd/system/light-remote-gold-plugin.service.d/zzzz-netbird-owner-uat.conf
cat > /etc/systemd/system/light-remote-gold-plugin.service.d/zzzz-netbird-owner-uat.conf <<'UNIT'
# Dedicated Gold UAT ONLY. Browser connects over WireGuard NetBird.
[Service]
Environment=LIGHT_REMOTE_PLUGIN_ALLOWED_HOSTS=gold.light-remote.thaiduy.digital,100.94.184.141
UNIT
systemctl daemon-reload
systemctl restart light-remote-gold-plugin.service
for i in $(seq 1 40); do
 if systemctl is-active --quiet light-remote-gold-plugin.service && curl -fsS --max-time 2 -H "Host: 100.94.184.141:5588" http://10.192.135.61:5583/account/login >/dev/null 2>&1; then break; fi
 sleep .25
done
systemctl is-active --quiet light-remote-gold-plugin.service
curl -fsS --max-time 3 -H "Host: 100.94.184.141:5588" http://10.192.135.61:5583/account/login >/dev/null
echo UAT_BROWSER_HOST_ALLOWED
INNER
lxc config device add "$INSTANCE" "$DEVICE" proxy \
 listen="tcp:$NB_IP:$NB_PORT" connect="tcp:10.192.135.61:5583" bind=host
sleep 1
curl -fsS --max-time 5 "http://$NB_IP:$NB_PORT/account/login" >/dev/null
curl -fsS --max-time 5 "http://$NB_IP:$NB_PORT/enroll" >/dev/null
echo "GOLD_UAT_NETBIRD_URL=http://$NB_IP:$NB_PORT/enroll"
echo GOLD_UAT_NATIVE_LXD_NETBIRD_NAT_PASS
