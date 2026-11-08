#!/usr/bin/env bash
# Run INSIDE the isolated Gold UAT LXD; never touches production.
# Stage an immutable Git archive beside the active service, without restart.
set -euo pipefail
umask 077
SHA="${G3_GOLD_SOURCE_SHA:?git source SHA required}"
ARCHIVE="${G3_GOLD_SOURCE_ARCHIVE:-/tmp/g3-source-prepare-20261020/source.tar.gz}"
LIVE="/opt/light-remote-gold-uat"
RELEASES="/opt/light-remote-gold-uat-candidates"
if [[ ! "$SHA" =~ ^[a-f0-9]{40}$ ]]; then echo G3_GOLD_INVALID_SOURCE_SHA >&2; exit 2; fi
if [[ ! -f "$ARCHIVE" ]];then echo G3_GOLD_ARCHIVE_NOT_FOUND >&2; exit 2;fi
if [[ ! -f "$LIVE/package-lock.json" || ! -d "$LIVE/node_modules" ]];then echo G3_GOLD_LIVE_RUNTIME_MISSING >&2;exit 2;fi
TARGET="$RELEASES/$SHA"
if [[ -e "$TARGET" ]];then echo G3_GOLD_RELEASE_ALREADY_STAGED >&2;exit 3;fi
mkdir -p "$RELEASES"
# Candidate code is traversable by gold-uat, while secrets remain protected.
chmod 0755 "$RELEASES"
STAGING="$(mktemp -d "$RELEASES/.staging-XXXXXX")"
cleanup(){ [[ -d "$STAGING" ]] && rm -rf "$STAGING"; }
trap cleanup EXIT
tar -xzf "$ARCHIVE" -C "$STAGING" --no-same-owner
for f in package-lock.json operator-host/executor.mjs operator-host/fleet-router.mjs operator-host/executor-routes-device-channel.mjs plugin-server/server.mjs device-agent/operator-agent.mjs lib/executor-readiness-probe.mjs;do
 [[ -s "$STAGING/$f" ]]||{ echo "G3_GOLD_SOURCE_FILE_MISSING:$f" >&2;exit 4; }
done
if ! cmp -s "$STAGING/package-lock.json" "$LIVE/package-lock.json";then echo G3_GOLD_DEPENDENCY_LOCK_DRIFT >&2;exit 4;fi
# Link existing node deps and secrets only inside this private LXD.
ln -s "$LIVE/node_modules" "$STAGING/node_modules"
ln -s "$LIVE/plugin-server/node_modules" "$STAGING/plugin-server/node_modules"
ln -s "$LIVE/secrets" "$STAGING/secrets"
for f in operator-host/executor.mjs operator-host/fleet-router.mjs operator-host/executor-routes-device-channel.mjs plugin-server/server.mjs device-agent/operator-agent.mjs;do
 node --check "$STAGING/$f"
done
node "$STAGING/deploy/scripts/selftest-g3-strict-executor-admission.mjs" >/dev/null
node "$STAGING/deploy/scripts/selftest-g3-live-readiness-evidence.mjs" >/dev/null
printf '%s\n' "$SHA" > "$STAGING/.git-source-sha"
chown -R root:root "$STAGING"
find "$STAGING" -type d -exec chmod 0755 {} +
# Staging never overwrites the live installation. Move atomically.
mv "$STAGING" "$TARGET"
trap - EXIT
echo "G3_GOLD_CANDIDATE_STAGED=PASS"
echo "G3_GOLD_CANDIDATE_SHA=$SHA"
echo "G3_GOLD_PACKAGE_LOCK_PARITY=PASS"
echo "G3_GOLD_LIVE_SERVICES_UNTOUCHED=PASS"
