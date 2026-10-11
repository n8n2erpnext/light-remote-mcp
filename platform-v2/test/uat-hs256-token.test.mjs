import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {signUatJwt,makeUatJwtVerifier} from './helpers/uat-hs256-token.mjs';

const key=Buffer.alloc(32,0xa4);
const other=Buffer.alloc(32,0x07);
const now=Date.UTC(2026,9,11,15,0,0);
const options={issuer:'https://uat.example.invalid',
  audience:'https://uat.example.invalid/mcp',tokenUse:'code'};
const claim=(overrides={})=>({
  iss:options.issuer,aud:options.audience,token_use:'code',
  iat:Math.floor(now/1000),exp:Math.floor(now/1000)+90,
  client_id:'uat_client',jti:'uat_test_jti_123',...overrides
});
test('signed synthetic JWT succeeds only under matching HMAC key and context',async()=>{
 const token=signUatJwt(claim(),{secret:key});
 assert.equal((await makeUatJwtVerifier({secret:key,now:()=>now})(token,options)).jti,
   'uat_test_jti_123');
 await assert.rejects(()=>makeUatJwtVerifier({secret:other,now:()=>now})(token,options),
   /jwt_signature_rejected/);
 await assert.rejects(()=>makeUatJwtVerifier({secret:key,now:()=>now})(token,{
   ...options,audience:'https://wrong.invalid'
 }),/jwt_claims_rejected/);
});
test('rejects alg=none, invalid header, payload tampering and expired token',async()=>{
 const valid=signUatJwt(claim(),{secret:key});
 const bits=valid.split('.');
 const none=Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url');
 await assert.rejects(()=>makeUatJwtVerifier({secret:key,now:()=>now})(
   [none,bits[1],bits[2]].join('.'),options),/jwt_algorithm_rejected/);
 const p=Buffer.from(JSON.stringify(claim({sub:'attacker'}))).toString('base64url');
 await assert.rejects(()=>makeUatJwtVerifier({secret:key,now:()=>now})(
   [bits[0],p,bits[2]].join('.'),options),/jwt_signature_rejected/);
 await assert.rejects(()=>makeUatJwtVerifier({secret:key,now:()=>now})(
   signUatJwt(claim({exp:Math.floor(now/1000)}),{secret:key}),options),
   /jwt_claims_rejected/);
});
test('rejects future nbf and iat and structurally malformed JWT',async()=>{
 const verify=makeUatJwtVerifier({secret:key,now:()=>now});
 for(const changes of [{nbf:Math.floor(now/1000)+300},
   {iat:Math.floor(now/1000)+300}]){
   await assert.rejects(()=>verify(signUatJwt(claim(changes),{secret:key}),options),
      /jwt_claims_rejected/);
 }
 await assert.rejects(()=>verify('garbage.jwt',options),/jwt_bad_format/);
 await assert.rejects(()=>verify('not-a-json.zzz.'+'A'.repeat(43),options),/jwt_bad_json|jwt_bad_encoding/);
 assert.throws(()=>makeUatJwtVerifier({secret:Buffer.alloc(12)}),/uat_jwt_test_secret_required/);
});
