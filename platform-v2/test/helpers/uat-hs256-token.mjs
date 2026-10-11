// TEST-ONLY HS256 JWT sign/verify. Never import production OAuth secrets.
// This is a narrow synthetic verifier for real-signature HTTP harness tests,
// not a replacement for the production jose verifier.
import crypto from 'node:crypto';

const err=code=>{throw new Error(code)};
function normalizedJsonPart(text){
  if(typeof text!=='string'||!/^[A-Za-z0-9_-]+$/.test(text))err('jwt_bad_base64url');
  const raw=Buffer.from(text,'base64url');
  if(raw.toString('base64url')!==text||raw.length>8192)err('jwt_bad_encoding');
  try{return JSON.parse(raw.toString('utf8'));}
  catch{err('jwt_bad_json');}
}
const expectedMac=(signed,secret)=>crypto.createHmac('sha256',secret).update(signed).digest();
export function signUatJwt(claims,{secret}={}){
  if(!Buffer.isBuffer(secret)||secret.length!==32)err('uat_jwt_test_secret_required');
  const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  const prefix=head+'.'+payload;
  return prefix+'.'+expectedMac(prefix,secret).toString('base64url');
}
export function makeUatJwtVerifier({secret,now=()=>Date.now()}={}){
  if(!Buffer.isBuffer(secret)||secret.length!==32)err('uat_jwt_test_secret_required');
  return async(token,{issuer,audience,tokenUse}={})=>{
    if(typeof token!=='string'||token.length>18000)err('jwt_bad_format');
    const pieces=token.split('.');
    if(pieces.length!==3)err('jwt_bad_format');
    const [a,b,c]=pieces;
    const header=normalizedJsonPart(a);
    if(header?.alg!=='HS256'||header?.typ!=='JWT')err('jwt_algorithm_rejected');
    if(!/^[A-Za-z0-9_-]{43}$/.test(c))err('jwt_bad_mac_encoding');
    const sig=Buffer.from(c,'base64url'),computed=expectedMac(a+'.'+b,secret);
    if(sig.length!==computed.length||!crypto.timingSafeEqual(sig,computed))
      err('jwt_signature_rejected');
    const payload=normalizedJsonPart(b);
    const n=Math.floor(now()/1000);
    if(payload?.iss!==issuer||payload?.aud!==audience||payload?.token_use!==tokenUse||
      !Number.isSafeInteger(payload?.exp)||payload.exp<=n||
      !Number.isSafeInteger(payload?.iat)||payload.iat>n+30||
      (payload.nbf!==undefined&&(!Number.isSafeInteger(payload.nbf)||payload.nbf>n)))
      err('jwt_claims_rejected');
    return payload;
  };
}
