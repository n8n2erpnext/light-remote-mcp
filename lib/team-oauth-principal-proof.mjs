import crypto from 'node:crypto';

// Ed25519 identity assertion for INTERNAL UAT Team routes. This deliberately
// does not reuse the Operator X25519 envelope: encryption to a public key does
// NOT authenticate the OAuth client that submitted an instruction.
const AUDIENCE='light-remote-operator-team-uat-v1';
const ISSUER='light-remote-verified-oauth-plugin';
const MAX_AGE_MS=30_000;
const MAX_FUTURE_MS=5_000;
const MAX_BODY_BYTES=256*1024;
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class TeamPrincipalProofError extends Error {
  constructor(message,status=403){super(message);this.status=status;}
}
export function teamOAuthAgentId({accountId,clientId}={}){
  // OAuth client_id is a signed JWT (often >160 bytes), not a short ID.
  if(!ID.test(accountId)||typeof clientId!=='string'||clientId.length<1||
     clientId.length>32768)
    throw new TeamPrincipalProofError('team_oauth_identity_required');
  return 'plugin-'+crypto.createHash('sha256')
    .update(String(accountId)+'|'+String(clientId)).digest('hex').slice(0,40);
}
function bodyHash(body){
  if(!body||typeof body!=='object'||Array.isArray(body))
    throw new TeamPrincipalProofError('team_proof_body_invalid',400);
  const encoded=Buffer.from(JSON.stringify(body));
  if(encoded.byteLength>MAX_BODY_BYTES)
    throw new TeamPrincipalProofError('team_proof_body_too_large',413);
  return crypto.createHash('sha256').update(encoded).digest('base64url');
}
function route(method,targetPath){
  const m=String(method||'').toUpperCase(),p=String(targetPath||'');
  if(m!=='POST'||!/^\/v1\/plugin\/team\/(?:access\/(?:request|poll)|dispatch\/preflight|sessions\/uat\/(?:open|[A-Za-z0-9._:-]+\/(?:get|resume|hold|touch|close)))$/.test(p))
    throw new TeamPrincipalProofError('team_proof_route_denied',403);
  return {method:m,path:p};
}

export function mintTeamPrincipalProof({
  identity,method='POST',targetPath,body,privateKey,now=Date.now()
}={}){
  const {method:m,path}=route(method,targetPath);
  if(!privateKey)throw new TeamPrincipalProofError('team_signing_key_unavailable',503);
  const key=privateKey?.type==='private'?privateKey:crypto.createPrivateKey(privateKey);
  if(key.asymmetricKeyType!=='ed25519')
    throw new TeamPrincipalProofError('team_signing_key_wrong_algorithm',503);
  const accountId=String(identity?.accountId||'');
  const clientId=String(identity?.clientId||'');
  const agentId=teamOAuthAgentId({accountId,clientId});
  const iat=Number(now);
  if(!Number.isSafeInteger(iat)||iat<=0)
    throw new TeamPrincipalProofError('team_proof_clock_invalid',500);
  // Never put the raw OAuth client JWT in an Operator header or audit log.
  // The plugin is the trust authority; it signs BOTH the client fingerprint
  // and the legacy-compatible agent derived from the verified token.
  const clientIdSha256=crypto.createHash('sha256').update(clientId).digest('hex');
  const claims={v:1,iss:ISSUER,aud:AUDIENCE,accountId,clientIdSha256,agentId,
    method:m,path,bodySha256:bodyHash(body),iat,exp:iat+MAX_AGE_MS,jti:crypto.randomUUID()};
  const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature=crypto.sign(null,Buffer.from(payload),key).toString('base64url');
  return payload+'.'+signature;
}

export class TeamPrincipalProofVerifier{
  constructor({publicKey,now=()=>Date.now(),maxNonces=10000}={}){
    if(!publicKey)throw new TeamPrincipalProofError('team_verify_key_unavailable',503);
    this.publicKey=publicKey?.type==='public'?publicKey:crypto.createPublicKey(publicKey);
    if(this.publicKey.asymmetricKeyType!=='ed25519')
      throw new TeamPrincipalProofError('team_verify_key_wrong_algorithm',503);
    this.now=now;
    this.maxNonces=maxNonces;
    this.used=new Map();
  }
  verify({proof,method,targetPath,body}={}){
    const {method:m,path}=route(method,targetPath);
    if(typeof proof!=='string'||proof.length>4096||
       !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(proof))
      throw new TeamPrincipalProofError('team_oauth_proof_required');
    const [encoded,sig]=proof.split('.');
    if(!crypto.verify(null,Buffer.from(encoded),this.publicKey,Buffer.from(sig,'base64url')))
      throw new TeamPrincipalProofError('team_oauth_proof_invalid');
    let c;
    try{c=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}
    catch{throw new TeamPrincipalProofError('team_oauth_proof_invalid');}
    const now=this.now();
    if(c?.v!==1||c.iss!==ISSUER||c.aud!==AUDIENCE||
       c.method!==m||c.path!==path||
       c.bodySha256!==bodyHash(body)||
       !UUID.test(c.jti)||!Number.isSafeInteger(c.iat)||
       !Number.isSafeInteger(c.exp)||c.exp!==c.iat+MAX_AGE_MS||
       c.iat>now+MAX_FUTURE_MS||now>=c.exp||c.iat<now-MAX_AGE_MS)
      throw new TeamPrincipalProofError('team_oauth_proof_claims_invalid');
    const accountId=String(c.accountId||'');
    const clientIdSha256=String(c.clientIdSha256||'');
    if(!ID.test(accountId)||!/^[a-f0-9]{64}$/.test(clientIdSha256)||
       !/^plugin-[a-f0-9]{40}$/.test(String(c.agentId||'')))
      throw new TeamPrincipalProofError('team_oauth_agent_binding_invalid');
    for(const [j,expiry] of this.used)if(expiry<=now)this.used.delete(j);
    if(this.used.has(c.jti))
      throw new TeamPrincipalProofError('team_oauth_proof_replayed');
    if(this.used.size>=this.maxNonces)
      throw new TeamPrincipalProofError('team_oauth_replay_capacity_exceeded',503);
    this.used.set(c.jti,c.exp);
    return Object.freeze({accountId,clientIdSha256,agentId:c.agentId});
  }
}

// Operator route adapter: proof identity is the ONLY identity source.
// Never accept actor/agent IDs in request body, even when signed, so later
// integrations cannot accidentally fall back to caller-controlled claims.
export function verifyTeamPrincipalRequest(req,url,body,verifier){
  if(!verifier)throw new TeamPrincipalProofError('team_oauth_verifier_not_configured',503);
  if(Object.hasOwn(body||{},'actorAccountId')||Object.hasOwn(body||{},'agentId')||
     Object.hasOwn(body||{},'deviceOwnerAccountId')||Object.hasOwn(body||{},'billedAccountId'))
    throw new TeamPrincipalProofError('team_caller_identity_fields_forbidden',403);
  return verifier.verify({proof:req?.headers?.['x-light-remote-team-proof'],
    method:req?.method,targetPath:url?.pathname,body});
}
