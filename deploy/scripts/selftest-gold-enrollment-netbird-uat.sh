#!/usr/bin/env bash
# Read-only: native LXD proxy -> ORIGINAL Gold UAT Account/Enroll.
set -euo pipefail
INSTANCE=light-remote-gold-uat
NETBIRD_IP=100.94.184.141
PORT=5588
test "$(ip -4 -o addr show dev wt0 | awk '{split($4,a,"/");print a[1];exit}')" = "$NETBIRD_IP"
test "$(lxc config device get "$INSTANCE" gold-enrollment-netbird listen)" = "tcp:$NETBIRD_IP:$PORT"
test "$(lxc config device get "$INSTANCE" gold-enrollment-netbird connect)" = "tcp:10.192.135.61:5583"
test "$(lxc config device get "$INSTANCE" gold-enrollment-netbird bind)" = host
test "$(ss -H -ltn "( sport = :$PORT )" | awk '{print $4}')" = "$NETBIRD_IP:$PORT"
lxc exec "$INSTANCE" -- systemctl is-active --quiet light-remote-gold-plugin
for path in /account/login /enroll /account/assets/portal.css /account/assets/theme.js;do
 code="$(curl -sS --max-time 6 -o /dev/null -w '%{http_code}' "http://$NETBIRD_IP:$PORT$path")"
 test "$code" = 200 || { echo "UAT_HTTP_FAILED $path $code";exit 4; }
done
invalid="$(curl -sS --max-time 6 -o /dev/null -w '%{http_code}' -H 'Host: forbidden.invalid' "http://$NETBIRD_IP:$PORT/account/login")"
test "$invalid" = 403
echo 'GOLD_UAT_NATIVE_NETBIRD_NAT_LOGIN_ENROLL_ASSETS_PASS'
echo 'GOLD_UAT_INVALID_HOST_REJECTED_PASS'
