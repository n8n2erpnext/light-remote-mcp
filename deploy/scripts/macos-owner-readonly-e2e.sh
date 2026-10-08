#!/bin/bash
# Must be run by the owner in a *graphical* macOS Terminal.
# Starts ONLY an isolated test helper. No installed Light Remote files modified.
set -euo pipefail
BASE="$HOME/Library/Caches/LightRemote-RMV2-Experimental"
HELPER="$BASE/LightRemoteRealRemoteAX"
NODE="/Library/Application Support/Light Remote/current/runtime/node"
if [ ! -x "$NODE" ]; then NODE="$(command -v node || true)"; fi
if [ ! -x "$HELPER" ] || [ ! -x "$NODE" ]; then
  echo 'Missing isolated helper or Node runtime';exit 3
fi
CHECK="$("$HELPER" --self-test)"
printf 'TCC: %s\n' "$CHECK"
printf '%s' "$CHECK" | "$NODE" -e "let b='';process.stdin.on('data',c=>b+=c).on('end',()=>{let d=JSON.parse(b);if(!d.screenRecording||!d.accessibility){console.error('Owner TCC permission not ready');process.exit(4)}})"
SOCKDIR="$(mktemp -d /tmp/lightremote-rmv2-XXXXXXXX)"
SOCK="$SOCKDIR/owner.sock"
PID=""
cleanup(){
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -f "$SOCK"
  rmdir "$SOCKDIR" 2>/dev/null || true
}
trap cleanup EXIT
"$HELPER" --socket "$SOCK" &
PID="$!"
"$NODE" "$BASE/owner-readonly-e2e.mjs" "$SOCK"
