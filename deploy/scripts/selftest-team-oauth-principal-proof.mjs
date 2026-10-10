import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  mintTeamPrincipalProof,TeamPrincipalProofVerifier,teamOAuthAgentId,
  verifyTeamPrincipalRequest
} from '../../lib/team-oauth-principal-proof.mjs';

let now=Date.now();
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const {publicKey:otherPublicKey,privateKey:otherPrivateKey}=crypto.generateKeyPairSync('ed25519');
const {privateKey:rsaKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const verifier=new TeamPrincipalProofVerifier({publicKey,now:()=>now,maxNonces:3});
const identity={accountId:'member',clientId:'oauth-client-A'};
const path='/v1/plugin/team/access/request';
const body={deviceId:'device',label:'team-request'};
const sign=(p=path,b=body,i=identity,k=privateKey,t=now)=>mintTeamPrincipalProof({
  identity:i,method:'POST',targetPath:p,body:b,privateKey:k,now:t
});
const check=(proof,p=path,b=body,ver=verifier)=>
  verifyTeamPrincipalRequest({method:'POST',headers:{'x-light-remote-team-proof':proof}},
    new URL('http://local'+p),b,ver);

assert.throws(()=>check(),/team_oauth_proof_required/);
assert.throws(()=>check('bogus.payload'),/team_oauth_proof_invalid/);
const valid=sign();
assert.throws(()=>mintTeamPrincipalProof({identity,method:'POST',
  targetPath:path,body,privateKey:rsaKey,now}),/team_signing_key_wrong_algorithm/);
const verified=check(valid);
assert.equal(verified.accountId,identity.accountId);
assert.equal(verified.clientIdSha256,crypto.createHash('sha256').update(identity.clientId).digest('hex'));
assert.equal(verified.agentId,teamOAuthAgentId(identity));
assert(Object.isFrozen(verified));
assert.throws(()=>check(valid),/team_oauth_proof_replayed/);
assert.throws(()=>check(sign(),path,{deviceId:'another-device',label:'team-request'}),
  /team_oauth_proof_claims_invalid/);
assert.throws(()=>check(sign(),'/v1/plugin/team/access/poll'),
  /team_oauth_proof_claims_invalid/);
const wrongAccount={accountId:'another-account',clientId:'oauth-client-A'};
assert.notEqual(teamOAuthAgentId(wrongAccount),verified.agentId);
const othersProof=sign(path,body,wrongAccount);
assert.equal(check(othersProof).accountId,wrongAccount.accountId);
assert.throws(()=>check(sign(path,body,identity,otherPrivateKey)),
  /team_oauth_proof_invalid/);
assert.throws(()=>check(sign(),path,body,new TeamPrincipalProofVerifier({
  publicKey:otherPublicKey,now:()=>now
})),/team_oauth_proof_invalid/);
assert.throws(()=>check(sign(),path,{...body,actorAccountId:'owner'}),
  /team_caller_identity_fields_forbidden/);
assert.throws(()=>check(sign(),path,{...body,agentId:'owner-agent'}),
  /team_caller_identity_fields_forbidden/);
assert.throws(()=>check(sign(),path,{...body,deviceOwnerAccountId:'owner'}),
  /team_caller_identity_fields_forbidden/);
assert.throws(()=>check(sign(),path,body,null),/team_oauth_verifier_not_configured/);
assert.throws(()=>sign('/v1/admin/license',body),/team_proof_route_denied/);
assert.throws(()=>mintTeamPrincipalProof({
  identity,method:'GET',targetPath:path,body,privateKey,now
}),/team_proof_route_denied/);

const tooManyProofs=[sign(),sign()];
check(tooManyProofs[0]); // third jti allowed
assert.throws(()=>check(tooManyProofs[1]),/team_oauth_replay_capacity_exceeded/);
now+=31_000;
assert.throws(()=>check(sign(path,body,identity,privateKey,now-31_000)),
  /team_oauth_proof_claims_invalid/);
const fresh=sign();
assert.equal(check(fresh).accountId,'member','expired nonces must be pruned');
assert.throws(()=>check(sign(path,body,identity,privateKey,now+6_000)),
  /team_oauth_proof_claims_invalid/);
const sessionPath='/v1/plugin/team/sessions/uat/s_test_001/touch';
assert.equal(check(sign(sessionPath,{action:'preview'}),sessionPath,
  {action:'preview'}).clientIdSha256,verified.clientIdSha256);
// Real OAuth client_id is a long signed JWT. Never truncate or expose it.
const longClient={accountId:'member',clientId:'eyJhbGciOiJIUzI1NiJ9.'+'x'.repeat(2300)+'.signature'};
const longVerifier=new TeamPrincipalProofVerifier({publicKey,now:()=>now});
const longProof=mintTeamPrincipalProof({identity:longClient,method:'POST',
  targetPath:path,body,privateKey,now});
assert(longProof.length<4096,'JWT must be fingerprinted, not embedded');
assert.equal(check(longProof,path,body,longVerifier).agentId,teamOAuthAgentId(longClient));
assert(!longProof.includes(longClient.clientId));
console.log('team_long_jwt_client_id_compatible_and_never_exposed=PASS');
console.log('team_ed25519_authenticity_and_exact_oauth_binding=PASS');
console.log('team_proof_body_path_method_audience_and_expiry=PASS');
console.log('team_replay_bounded_capacity_and_ttl=PASS');
console.log('team_no_caller_supplied_identity_and_no_public_routes=PASS');
console.log('team_no_operator_key_or_production_default_dependency=PASS');
