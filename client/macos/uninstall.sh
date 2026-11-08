#!/bin/bash
set -euo pipefail

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo 'Light Remote uninstaller must run as administrator.' >&2; exit 2; }
FROM_TRAY=0
[[ "${1:-}" == '--from-tray' ]] && FROM_TRAY=1
ROOT='/Library/Application Support/Light Remote'
APP='/Applications/Light Remote.app'
AGENT_PLIST='/Library/LaunchAgents/com.lightremote.agent.plist'
TRAY_PLIST='/Library/LaunchAgents/com.lightremote.tray.plist'
UPDATER_PLIST='/Library/LaunchDaemons/com.lightremote.updater.plist'

console_user="$(/usr/bin/stat -f '%Su' /dev/console 2>/dev/null || true)"
console_uid=''
if [[ -n "$console_user" && "$console_user" != root && "$console_user" != loginwindow ]]; then
  console_uid="$(/usr/bin/id -u "$console_user")"
  /bin/launchctl bootout "gui/$console_uid/com.lightremote.agent" >/dev/null 2>&1 || true
fi
/bin/launchctl bootout system/com.lightremote.updater >/dev/null 2>&1 || true

/bin/rm -f "$AGENT_PLIST" "$UPDATER_PLIST"
/bin/rm -rf "$ROOT"
for receipt in com.lightremote.client.macos-x64 com.lightremote.client.macos-arm64; do
  /usr/sbin/pkgutil --forget "$receipt" >/dev/null 2>&1 || true
done
if [[ -x /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister ]]; then
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$APP" >/dev/null 2>&1 || true
fi
/bin/rm -rf "$APP"

# Stop the tray last so an uninstall launched from the tray can finish cleanup.
/bin/rm -f "$TRAY_PLIST"
if [[ -n "$console_uid" && "$FROM_TRAY" -eq 0 ]]; then
  /bin/launchctl bootout "gui/$console_uid/com.lightremote.tray" >/dev/null 2>&1 || true
fi

echo 'Light Remote application, runtime, services, updater, and package receipts removed.'
echo 'Device identity in ~/.config/gpt-operator-agent is preserved for safe reinstall continuity.'
exit 0
