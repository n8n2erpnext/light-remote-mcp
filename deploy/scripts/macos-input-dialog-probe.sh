#!/bin/bash
set -euo pipefail
BASE="$HOME/Library/Caches/LightRemote-RMV2-Experimental"
H="$BASE/LightRemoteRealRemoteAX"
NODE="/Library/Application Support/Light Remote/current/runtime/node"
if [ ! -x "$NODE" ]; then echo 'Node runtime missing';exit 2; fi
SOCK="/tmp/lightremote-rmv2-$$-canary.sock"
umask 077
cleanup() {
  if [ -n "${HPID:-}" ]; then kill "$HPID" 2>/dev/null || true; wait "$HPID" 2>/dev/null || true; fi
  rm -f "$SOCK"
}
trap cleanup EXIT
"$H" --socket "$SOCK" &
HPID=$!
"$NODE" "$BASE/input-dialog-probe.mjs" "$SOCK"
