#!/usr/bin/env bash
set -euo pipefail
# One-off ephemeral Linux Server acceptance using pre-existing unprivileged
# nobody identity. Changes NO systemd units, accounts, Gold services or UAT DB.
ROOT="$(mktemp -d /tmp/lr-owner-broker-isolation.XXXXXX)"
BROKER="$ROOT/broker"
SOURCES="$ROOT/sources"
BROKER_PID=""
# Temporary parent is only a traversal container; private data lives under
# the separately owned broker directory, never in this parent.
chmod 0755 "$ROOT"
cleanup(){
 if [[ -n "$BROKER_PID" ]]; then sudo -n kill "$BROKER_PID" 2>/dev/null || true; wait "$BROKER_PID" 2>/dev/null || true; fi
 sudo -n rm -rf -- "$BROKER"
 rm -rf -- "$ROOT"
}
trap cleanup EXIT
[[ "$(id -u)" != "0" ]] || { echo "REFUSE_ROOT_LINUX_BROKER_TEST"; exit 2; }
command -v sudo >/dev/null
sudo -n -u nobody id -u >/dev/null
[[ "$(getent passwd nobody | cut -d: -f3)" = "65534" ]]
mkdir -m 0755 "$SOURCES"
cp device-agent/project-continuity-owner-broker{,-cli}.mjs device-agent/project-continuity-owner-grants.mjs "$SOURCES/"
chmod 0644 "$SOURCES"/*.mjs
mkdir "$BROKER"
sudo -n chown nobody:"$(id -gn)" "$BROKER"
sudo -n chmod 2710 "$BROKER"
# Only the broker identity can read or write key material.
printf '{"password":"isolated-linux-broker-test-only-passphrase-2026"}\n' \
 | sudo -n -u nobody node "$SOURCES/project-continuity-owner-broker-cli.mjs" bootstrap --root "$BROKER" >/dev/null
[[ ! -r "$BROKER/private/continuity-owner-private.enc.json" ]] || { echo "ISOLATION_VIOLATION_PRIVATE_READ"; exit 5; }
[[ ! -r "$BROKER/owner-authority-public.pem" ]] || { echo "ISOLATION_VIOLATION_TRUST_ANCHOR_READ"; exit 5; }
sudo -n -u nobody node "$SOURCES/project-continuity-owner-broker-cli.mjs" serve --root "$BROKER" \
 > "$ROOT/broker-output.log" 2>&1 &
BROKER_PID=$!
for i in $(seq 1 80); do
 [[ -S "$BROKER/owner-broker.sock" ]] && break
 sleep 0.05
done
[[ -S "$BROKER/owner-broker.sock" ]]
[[ "$(stat -c '%a' "$BROKER/owner-broker.sock")" = "660" ]]
# The client is a different OS user (the invoking account) and can access
# only the broker socket; credentials still required for signing.
BROKER_ROOT="$BROKER" BROKER_MODULE="$SOURCES/project-continuity-owner-broker.mjs" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
const {ownerBrokerRequest}=await import(process.env.BROKER_MODULE);
const runtimeDir=process.env.BROKER_ROOT;
const health=await ownerBrokerRequest({runtimeDir,action:'health'});
assert.equal(health.ready,true);
const pub=await ownerBrokerRequest({runtimeDir,action:'publicKey'});
const key=crypto.createPublicKey(pub.publicKeyPem);
const projectId=crypto.randomUUID();
const input={projectId,enabled:true,revision:2,principal:'linux-actual-owner',
 password:'isolated-linux-broker-test-only-passphrase-2026'};
await assert.rejects(ownerBrokerRequest({runtimeDir,action:'signConsent',data:{...input,password:'wrong-password'}}),/continuity_broker_owner_verification_failed/);
const signed=await ownerBrokerRequest({runtimeDir,action:'signConsent',data:input});
assert.equal(signed.grant.projectId,projectId);
assert.equal(crypto.verify(null,Buffer.from(JSON.stringify(signed.grant)),key,
 Buffer.from(signed.signature,'base64url')),true);
assert.equal(fs.existsSync(runtimeDir+'/private/continuity-owner-private.enc.json'),false);
// Cannot use an IPC token or just an arbitrary caller identity to sign.
await assert.rejects(ownerBrokerRequest({runtimeDir,action:'signConsent',data:{...input,password:undefined}}),/continuity_broker_owner_verification_failed/);
await assert.rejects(ownerBrokerRequest({runtimeDir,action:'setRemoteReadConsent',data:input}),/continuity_broker_action_denied/);
// One earlier missing-password failure plus four distinct claimed principals.
for(let i=0;i<4;i++){
 await assert.rejects(ownerBrokerRequest({runtimeDir,action:'signConsent',data:{...input,
  principal:'changed-identity-'+i,password:'wrong-password'}}),/continuity_broker_owner_verification_failed/);
}
await assert.rejects(ownerBrokerRequest({runtimeDir,action:'signConsent',data:input}),/continuity_broker_rate_limited/);
console.log('LINUX_SERVER_BROKER_GLOBAL_OWNER_GUESS_RATE_LIMIT_PASS');
console.log('LINUX_SERVER_BROKER_SEPARATE_UID_PRIVATE_KEY_DENIED_PASS');
console.log('LINUX_SERVER_BROKER_GROUP_SOCKET_SIGNATURE_PASS');
JS
[[ "$(wc -c < "$ROOT/broker-output.log")" -eq 0 ]] || {
 echo "BROKER_UNEXPECTED_OUTPUT_DIAGNOSTICS_SUPPRESSED"
 exit 6
}
echo 'LINUX_SERVER_NO_GOLD_UAT_MUTATION_ACCEPTANCE_PASS'
