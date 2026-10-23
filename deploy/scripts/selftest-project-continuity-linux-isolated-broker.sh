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
cp device-agent/project-continuity-owner-broker{,-cli}.mjs device-agent/project-continuity-owner-grants.mjs device-agent/project-continuity-store.mjs device-agent/project-continuity-client.mjs "$SOURCES/"
chmod 0644 "$SOURCES"/*.mjs
mkdir -m 0755 "$ROOT/lib"
cp lib/project-continuity-session-proof.mjs "$ROOT/lib/"
chmod 0644 "$ROOT/lib/"*.mjs
RELAY_PRIVATE="$ROOT/relay-sign-private.pem"
RELAY_PUBLIC="$ROOT/lib/relay-sign-public.pem"
RELAY_PRIVATE="$RELAY_PRIVATE" RELAY_PUBLIC="$RELAY_PUBLIC" node --input-type=module -e "import crypto from 'node:crypto';import fs from 'node:fs';const k=crypto.generateKeyPairSync('ed25519');fs.writeFileSync(process.env.RELAY_PRIVATE,k.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});fs.writeFileSync(process.env.RELAY_PUBLIC,k.publicKey.export({type:'spki',format:'pem'}),{mode:0o644});"
chmod 0644 "$RELAY_PUBLIC"
mkdir "$BROKER"
sudo -n chown nobody:"$(id -gn)" "$BROKER"
sudo -n chmod 2710 "$BROKER"
# Only the broker identity can read or write key material.
printf '{"password":"isolated-linux-broker-test-only-passphrase-2026"}\n' \
 | sudo -n -u nobody node "$SOURCES/project-continuity-owner-broker-cli.mjs" bootstrap --root "$BROKER" >/dev/null
[[ ! -r "$BROKER/private/continuity-owner-private.enc.json" ]] || { echo "ISOLATION_VIOLATION_PRIVATE_READ"; exit 5; }
[[ ! -r "$BROKER/owner-authority-public.pem" ]] || { echo "ISOLATION_VIOLATION_TRUST_ANCHOR_READ"; exit 5; }
sudo -n -u nobody node "$SOURCES/project-continuity-owner-broker-cli.mjs" trust-operator --root "$BROKER" --account-id account-linux-test --device-id device-linux-test --public-key-file "$RELAY_PUBLIC" >/dev/null
[[ ! -r "$BROKER/trusted-operator-relay.json" ]] || { echo "ISOLATION_VIOLATION_OPERATOR_TRUST_READ"; exit 5; }
sudo -n -u nobody node "$SOURCES/project-continuity-owner-broker-cli.mjs" serve --root "$BROKER" --controller 1 \
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
BROKER_ROOT="$BROKER" BROKER_MODULE="$SOURCES/project-continuity-owner-broker.mjs" BROKER_CLIENT="$SOURCES/project-continuity-client.mjs" PROOF_MODULE="$ROOT/lib/project-continuity-session-proof.mjs" RELAY_PRIVATE="$RELAY_PRIVATE" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
const {ownerBrokerRequest}=await import(process.env.BROKER_MODULE);
const {createProjectReadDelegation}=await import(process.env.PROOF_MODULE);
const {projectContinuityRequest,projectContinuityOwnerConsent}=await import(process.env.BROKER_CLIENT);
process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER='1';
process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT=process.env.BROKER_ROOT;

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
assert.equal(fs.existsSync(runtimeDir+'/controller/continuity.db'),false);
assert.equal(fs.existsSync(runtimeDir+'/controller/owner-authority-public.pem'),false);
const brokerOp=(action,data={})=>ownerBrokerRequest({runtimeDir,action:'controller',data:{action,data}});
const created=await projectContinuityRequest('createProject',{name:'Isolated project memory fixture'});
assert.equal(created.memory_enabled,0);
await projectContinuityRequest('setModules',{projectId:created.id,memory:true,expectedRevision:1});
await projectContinuityRequest('memoryPut',{projectId:created.id,body:'ISOLATED_CANARY_IN_PRIVATE_DB_2070',sourceRef:'fixture:signed'});
const local=await projectContinuityRequest('contextBrief',{projectId:created.id,maxChars:2000});
assert.match(local.content,/ISOLATED_CANARY_IN_PRIVATE_DB_2070/);
await assert.rejects(brokerOp('remoteBrief',{projectId:created.id}),/continuity_broker_controller_action_denied/);
await assert.rejects(projectContinuityRequest('remoteBrief',{projectId:created.id}),/continuity_remote_delegation_required/);
await assert.rejects(projectContinuityRequest('applySignedOwnerConsent',{projectId:created.id}),/continuity_broker_signature_direct_use_denied/);
await assert.rejects(brokerOp('applySignedOwnerConsent',{projectId:created.id,proof:{}}),/continuity_broker_controller_action_denied/);
await assert.rejects(brokerOp('transition',{sectionId:'arbitrary'}),/continuity_broker_controller_action_denied/);
await assert.rejects(ownerBrokerRequest({runtimeDir,action:'ownerConsent',
 data:{projectId:created.id,enabled:true,revision:2,principal:'owner',password:'wrong-password'}}),
 /continuity_broker_owner_verification_failed/);
const enabled=await projectContinuityOwnerConsent({
 projectId:created.id,enabled:true,expectedRevision:2,principal:'owner',
 password:'isolated-linux-broker-test-only-passphrase-2026'});
assert.equal(enabled.remoteReadEnabled,true);
assert.equal((await brokerOp('getProject',{projectId:created.id})).remote_read_enabled,1);
const relayRequestId=crypto.randomUUID();
const relayProof=createProjectReadDelegation({
 privateKey:fs.readFileSync(process.env.RELAY_PRIVATE),
 accountId:'account-linux-test',deviceId:'device-linux-test',agentId:'agent-linux-test',
 sessionId:'s_linux-uat',projectId:created.id,requestId:relayRequestId,
 query:'',maxChars:1600
});
const read=await projectContinuityRequest('remoteBrief',{
 projectId:created.id,requestId:relayRequestId,query:'',maxChars:1600,proof:relayProof
});
assert.match(read.content,/ISOLATED_CANARY_IN_PRIVATE_DB_2070/);
await assert.rejects(projectContinuityRequest('remoteBrief',{
 projectId:created.id,requestId:relayRequestId,query:'',maxChars:1600,proof:relayProof
}),/continuity_remote_read_denied/);
console.log('LINUX_SERVER_SIGNED_OPERATOR_REMOTE_READ_REAL_TWO_UID_PASS');
await assert.rejects(ownerBrokerRequest({runtimeDir,action:'ownerConsent',data:{
 projectId:created.id,enabled:false,revision:2,principal:'owner',
 password:'isolated-linux-broker-test-only-passphrase-2026'}}),/continuity_broker_owner_verification_failed/);
const revoked=await ownerBrokerRequest({runtimeDir,action:'ownerConsent',data:{
 projectId:created.id,enabled:false,revision:3,principal:'owner',
 password:'isolated-linux-broker-test-only-passphrase-2026'}});
assert.equal(revoked.remoteReadEnabled,false);
assert.equal((await brokerOp('getProject',{projectId:created.id})).remote_read_enabled,0);
console.log('LINUX_SERVER_DEVICE_AGENT_OPTIN_BROKER_AND_REMOTE_DENY_PASS');
console.log('LINUX_SERVER_BROKER_CONTROLLER_PROTECTED_SQLITE_AND_TRUST_ANCHOR_PASS');
console.log('LINUX_SERVER_BROKER_OWNER_CONSENT_ATOMIC_REVOKE_PASS');
// Cannot use an IPC token or just an arbitrary caller identity to sign.
await assert.rejects(ownerBrokerRequest({runtimeDir,action:'signConsent',data:{...input,password:undefined}}),/continuity_broker_owner_verification_failed/);
await assert.rejects(ownerBrokerRequest({runtimeDir,action:'setRemoteReadConsent',data:input}),/continuity_broker_action_denied/);
// Several prior failed requests plus three changed principals.
for(let i=0;i<4;i++){
 await assert.rejects(ownerBrokerRequest({runtimeDir,action:'signConsent',data:{...input,
  principal:'changed-identity-'+i,password:'wrong-password'}}),/continuity_broker_owner_verification_failed/);
}
await assert.rejects(ownerBrokerRequest({runtimeDir,action:'signConsent',data:input}),/continuity_broker_rate_limited/);
console.log('LINUX_SERVER_BROKER_GLOBAL_OWNER_GUESS_RATE_LIMIT_PASS');
console.log('LINUX_SERVER_BROKER_SEPARATE_UID_PRIVATE_KEY_DENIED_PASS');
console.log('LINUX_SERVER_BROKER_GROUP_SOCKET_SIGNATURE_PASS');
JS
if grep -Eq 'ISOLATED_CANARY|test-only-passphrase|BEGIN PRIVATE KEY' "$ROOT/broker-output.log"; then
 echo "BROKER_SENSITIVE_OUTPUT_LEAK"
 exit 6
fi
echo 'LINUX_SERVER_NO_GOLD_UAT_MUTATION_ACCEPTANCE_PASS'
