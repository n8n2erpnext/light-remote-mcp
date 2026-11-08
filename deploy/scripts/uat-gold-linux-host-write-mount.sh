#!/usr/bin/env bash
set -euo pipefail
# Run on the owner-authorized VPS-ARM; target is hard-coded to isolated Gold LXD.
# Does not reconfigure the Gold Agent, public production or HOMESV.
TARGET=light-remote-gold-uat
APPROVED=/var/lib/lr-gold-host-write-allowed
DENIED=/var/lib/lr-gold-host-write-denied
RUN_ID="goldhw-$$"
cleanup(){
  lxc exec "$TARGET" -- rm -f "$APPROVED/scoped-written" "$APPROVED/must-not-exist" "$DENIED/must-not-exist" 2>/dev/null || true
  lxc exec "$TARGET" -- rmdir "$APPROVED" "$DENIED" 2>/dev/null || true
}
trap cleanup EXIT
lxc exec "$TARGET" -- install -d -m 0755 -o root -g root "$APPROVED" "$DENIED"
lxc exec "$TARGET" -- systemd-run --quiet --wait --collect --pipe --unit="${RUN_ID}-baseline" \
  -p User=root -p ProtectSystem=strict -p PrivateTmp=yes \
  /bin/sh -c 'if touch /var/lib/lr-gold-host-write-allowed/must-not-exist 2>/dev/null; then exit 17; fi; findmnt -T /etc -no OPTIONS | grep -q ro; echo GOLD_MOUNT_DEFAULT_RO_PASS'
lxc exec "$TARGET" -- systemd-run --quiet --wait --collect --pipe --unit="${RUN_ID}-scoped" \
  -p User=root -p ProtectSystem=strict -p PrivateTmp=yes \
  -p ReadWritePaths="$APPROVED" \
  /bin/sh -c 'touch /var/lib/lr-gold-host-write-allowed/scoped-written || exit 18; if touch /var/lib/lr-gold-host-write-denied/must-not-exist 2>/dev/null; then exit 19; fi; findmnt -T /etc -no OPTIONS | grep -q ro; echo GOLD_MOUNT_ALLOWLIST_WRITE_AND_OTHER_DENIED_PASS'
lxc exec "$TARGET" -- test -f "$APPROVED/scoped-written"
lxc exec "$TARGET" -- test ! -f "$DENIED/must-not-exist"
lxc exec "$TARGET" -- systemctl is-active --quiet light-remote-gold-wall
lxc exec "$TARGET" -- systemctl is-active --quiet light-remote-gold-operator
echo GOLD_SYSTEMD_REAL_MOUNT_ACCEPTANCE_PASS
