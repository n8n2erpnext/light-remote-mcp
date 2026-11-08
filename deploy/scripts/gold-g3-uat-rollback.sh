#!/usr/bin/env bash
# Recover the *original* Gold UAT services by removing ONLY G3 override
# snippets. Never touches production or replaces database contents.
set -euo pipefail
[[ "${G3_GOLD_ROLLBACK:-}" == "1" ]] || { echo G3_GOLD_ROLLBACK_OPT_IN_REQUIRED >&2;exit 2; }
LIVE=/opt/light-remote-gold-uat
ROOT=/etc/systemd/system
SOCK=/run/light-remote-gold-uat/operator.sock
for service in operator plugin wall;do
  unit="light-remote-gold-$service"
  test -f "$ROOT/$unit.service" || { echo G3_GOLD_WRONG_TARGET >&2;exit 3; }
done
systemctl stop light-remote-gold-wall || :
systemctl stop light-remote-gold-plugin || :
for service in operator plugin wall;do
  rm -f "$ROOT/light-remote-gold-$service.service.d/90-g3-candidate.conf"
done
systemctl daemon-reload
systemctl restart light-remote-gold-operator
for i in {1..20};do
  if systemctl is-active --quiet light-remote-gold-operator &&
    curl -fsS --max-time 2 --unix-socket "$SOCK" http://localhost/v1/fleet >/dev/null 2>&1;then break;fi
  sleep 1
done
systemctl start light-remote-gold-plugin
systemctl start light-remote-gold-wall
for i in {1..20};do
  if systemctl is-active --quiet light-remote-gold-operator &&
    systemctl is-active --quiet light-remote-gold-plugin &&
    systemctl is-active --quiet light-remote-gold-wall;then break;fi
  sleep 1
done
for service in operator plugin wall;do
  unit="light-remote-gold-$service"
  systemctl is-active --quiet "$unit" || { echo "G3_GOLD_ROLLBACK_UNIT_FAILED:$unit" >&2;exit 4; }
  systemctl show "$unit" -p ExecStart --value | grep -F "$LIVE/" >/dev/null || {
    echo "G3_GOLD_ROLLBACK_ENTRYPOINT_MISMATCH:$unit" >&2;exit 4;
  }
done
curl -fsS --max-time 3 --unix-socket "$SOCK" http://localhost/v1/fleet >/dev/null
echo G3_GOLD_ORIGINAL_RUNTIME_RESTORED=PASS
echo G3_GOLD_ROLLBACK_DID_NOT_RESTORE_DATABASE=no-schema-change
