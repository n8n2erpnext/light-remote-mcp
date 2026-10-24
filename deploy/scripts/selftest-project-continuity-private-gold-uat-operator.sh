#!/usr/bin/env bash
# Read-only isolated private Gold Operator UAT verification.
# Never starts enrollment, changes policy, or sends account credentials.
set -euo pipefail
INSTANCE=light-remote-continuity-uat
GOLD=light-remote-gold-uat
test "$(lxc config device get "$INSTANCE" eth0 ipv4.address)" = 10.192.135.62
test "$(lxc config device get "$GOLD" eth0 ipv4.address)" = 10.192.135.61
lxc exec "$INSTANCE" -- systemctl is-active --quiet light-remote-gold-continuity-agent-uat.service
lxc exec "$INSTANCE" -- systemctl is-active --quiet light-remote-continuity-uat.service
lxc exec "$INSTANCE" -- /bin/bash -c '
set -euo pipefail
test "$(ip -4 -o addr show eth0 | grep -c 10.192.135.62/24)" = 1
test -z "$(ip -4 route show default)"
test "$(getent ahostsv4 gold.light-remote.thaiduy.digital | awk "NR==1{print \$1}")" = 10.192.135.61
test "$(systemctl show -p Environment --value light-remote-gold-continuity-agent-uat.service | grep -o "OPERATOR_AGENT_BASE_URL=http://gold.light-remote.thaiduy.digital:5583")" = OPERATOR_AGENT_BASE_URL=http://gold.light-remote.thaiduy.digital:5583
curl -fsS --max-time 6 http://gold.light-remote.thaiduy.digital:5583/healthz | grep -q "\"ok\":true"
status="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 -H "Content-Type: application/json" -d "{\"action\":\"__unsupported_private_uat_probe__\",\"payload\":{}}" http://gold.light-remote.thaiduy.digital:5583/api/operator)"
test "$status" = 403

'
lxc exec "$INSTANCE" -- /usr/local/bin/light-remote-continuity-node -e '
const s=require("/var/lib/light-remote-continuity-web/device.json");
if(!s.pendingEnrollment?.enrollmentId&&!s.enrollment?.deviceId)process.exit(6);
console.log("UAT_DEVICE_ENROLLMENT_STATUS="+(s.enrollment?.deviceId?"OWNER_APPROVED":"OWNER_APPROVAL_PENDING_OR_EXPIRED"));
'
test "$(lxc config device list "$INSTANCE" | grep -c continuity-webui-netbird || true)" = 0
test "$(ss -H -ltn '( sport = :5587 )' | wc -l)" = 0
echo 'GOLD_UAT_PRIVATE_OPERATOR_PINNED_DNS_NO_WAN_NO_PUBLIC_WALL_PASS'
echo 'GOLD_UAT_BOOTSTRAP_ROUTE_REJECTS_UNKNOWN_ACTION_PASS'
