#!/usr/bin/env bash
# GoldABV2 *isolated Lab* exact Traefik->mTLS backend rule keeper.
# Runs as ubuntu through the existing lingering user systemd timer.
# Does NOT change persistent root firewall files, mount flags or other rules.
set -euo pipefail

readonly BRIDGE=br-2b4f73f607d5
readonly SOURCE=172.30.0.10/32
readonly DEST=172.30.0.1/32
readonly PORT=15584
readonly CONFIG=/home/ubuntu/netbird/traefik-dynamic.yaml
readonly LAB=light-remote-abv2-lab-20261101

# Fail closed: don't restore access when Traefik is no longer assigned to
# this exact mTLS-only backend, or when the original topology has changed.
python3 - "$CONFIG" <<'PY'
import sys,yaml
try:
    cfg=yaml.safe_load(open(sys.argv[1],encoding='utf8'))
    lb=cfg['http']['services']['goldabv2-plugin']['loadBalancer']
    assert lb['servers']==[{'url':'https://172.30.0.1:15584'}]
    assert lb['serversTransport']=='goldabv2-public-mtls'
    tr=cfg['http']['serversTransports']['goldabv2-public-mtls']
    assert tr['serverName']=='goldabv2.lab'
    assert tr['rootCAs']==['/letsencrypt/lr-goldabv2-lab-mtls-20261105/ca.crt']
    assert tr['certificates']==[{
       'certFile':'/letsencrypt/lr-goldabv2-lab-mtls-20261105/client.crt',
       'keyFile':'/letsencrypt/lr-goldabv2-lab-mtls-20261105/client.key'
    }]
except Exception as e:
    raise SystemExit('SKIP: goldabv2 config no longer exact mTLS candidate')
PY
ip link show "$BRIDGE" >/dev/null
runtime_ips="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' netbird-traefik)"
if [[ " $runtime_ips " != *" 172.30.0.10 "* ]]; then
  echo 'NOT_READY: original Traefik container address changed; no firewall edit' >&2
  exit 21
fi
lxc config device show "$LAB" | grep -q '^abv2-public-mtls-traefik:$'
if sudo -n /usr/sbin/iptables -C INPUT -i "$BRIDGE" -s "$SOURCE" -d "$DEST" -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; then
  echo 'GOLDABV2_MTLS_RULE_PRESENT'
  exit 0
fi
# Local authorized sudo is required; final device policy still applies.
sudo -n /usr/sbin/iptables -I INPUT 1 -i "$BRIDGE" -s "$SOURCE" -d "$DEST" -p tcp --dport "$PORT" -j ACCEPT
sudo -n /usr/sbin/iptables -C INPUT -i "$BRIDGE" -s "$SOURCE" -d "$DEST" -p tcp --dport "$PORT" -j ACCEPT
echo 'GOLDABV2_MTLS_RULE_RESTORED_EXACT_SCOPE'
