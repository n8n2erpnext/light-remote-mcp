#!/usr/bin/env bash
# ONLY for owner-approved restoration of the dedicated Gold LXD UAT.
# This discards all Gold UAT writes AFTER the named offline snapshot.
set -euo pipefail
[[ "$#" == 1 && "$1" == --explicit-discard-post-snapshot-uat-changes ]] || {
 echo 'Explicit irreversible UAT rollback approval required';exit 2;}
INSTANCE=light-remote-gold-uat
SNAP=pre-long-memory-codex-observer-20261024
[[ "$(lxc list "$INSTANCE" -c s --format csv)" == RUNNING ]] || exit 3
lxc info "$INSTANCE" | grep -Fq "$SNAP" || exit 3
[[ "$(lxc storage get default driver)" == btrfs ]] || exit 3
lxc stop "$INSTANCE" --timeout 55
lxc restore "$INSTANCE" "$SNAP"
lxc start "$INSTANCE"
for i in $(seq 1 40);do
 if lxc exec "$INSTANCE" -- systemctl is-active --quiet light-remote-gold-plugin light-remote-gold-operator light-remote-gold-wall light-remote-gold-process-supervisor postgresql redis-server;then
  echo 'GOLD_UAT_ORIGINAL_SNAPSHOT_RESTORED_AND_ALL_SERVICES_ACTIVE';exit 0
 fi
 sleep 2
done
echo 'Gold UAT restored but post-start service investigation required';exit 4
