#!/usr/bin/env bash
# Explicit setup for a NEW isolated UAT device to talk only to sibling Gold UAT.
# No enrollment, owner grant, production secret or API write in this script.
set -euo pipefail
INSTANCE=light-remote-continuity-uat
[[ "$#" == 1 && "$1" == "--explicit-gold-uat-only" ]] || { echo EXPLICIT_UAT_ONLY_REQUIRED; exit 2; }
[[ "$(git branch --show-current)" == feature/project-continuity-plan-20261023 ]] || exit 2
[[ "$(lxc config device get "$INSTANCE" eth0 ipv4.address)" == 10.192.135.62 ]] || exit 3
[[ "$(lxc config device get light-remote-gold-uat eth0 ipv4.address)" == 10.192.135.61 ]] || exit 3
lxc exec "$INSTANCE" -- systemctl is-active --quiet light-remote-gold-continuity-agent-uat.service
lxc exec "$INSTANCE" -- systemctl is-active --quiet light-remote-continuity-uat.service
lxc exec -T "$INSTANCE" -- bash -s <<'INNER'
set -euo pipefail
test "$(ip -4 -o addr show eth0 | grep -c '10.192.135.62/24')" -eq 1
test -z "$(ip route show default)"
hostname=gold.light-remote.thaiduy.digital
if ! grep -Eq '^10\.192\.135\.61[[:space:]]+gold\.light-remote\.thaiduy\.digital([[:space:]]|$)' /etc/hosts;then
 test -z "$(grep -E '[[:space:]]gold\.light-remote\.thaiduy\.digital([[:space:]]|$)' /etc/hosts || true)" || { echo REFUSE_UNEXPECTED_EXISTING_GOLD_ALIAS;exit 4; }
 printf '\n# Explicit LXD-only Gold UAT Operator route; no WAN route\n10.192.135.61 gold.light-remote.thaiduy.digital\n' >> /etc/hosts
fi
test "$(getent ahostsv4 "$hostname" | awk 'NR==1{print $1}')" = 10.192.135.61
curl -fsS --max-time 5 http://gold.light-remote.thaiduy.digital:5583/healthz | \
 grep -q '"ok":true'
status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 4 \
 -H 'Content-Type: application/json' \
 -d '{"action":"__uat_unsupported_readonly_probe__","payload":{}}' \
 http://gold.light-remote.thaiduy.digital:5583/api/operator)
test "$status" = 403
install -d -m 0755 /etc/systemd/system/light-remote-gold-continuity-agent-uat.service.d
cat > /etc/systemd/system/light-remote-gold-continuity-agent-uat.service.d/offline-no-production-enrollment.conf <<'UNIT'
# This local DNS name is pinned to 10.192.135.61 in THIS UAT LXD.
# It never resolves over external DNS; no default route is installed.
[Service]
Environment=OPERATOR_AGENT_BASE_URL=http://gold.light-remote.thaiduy.digital:5583
Environment=OPERATOR_AGENT_HUB_URL=http://gold.light-remote.thaiduy.digital:5583
UNIT
systemctl daemon-reload
systemctl restart light-remote-gold-continuity-agent-uat.service
systemctl is-active --quiet light-remote-gold-continuity-agent-uat.service
echo GOLD_UAT_ONLY_ENDPOINT_NOT_ENROLLED_PASS
INNER
lxc exec "$INSTANCE" -- sh -c 'ip route; systemctl is-active light-remote-gold-continuity-agent-uat.service'
echo PRIVATE_GOLD_UAT_OPERATOR_ENDPOINT_READY_NO_ENROLLMENT_YET
