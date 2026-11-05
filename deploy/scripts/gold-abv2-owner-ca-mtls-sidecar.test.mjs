import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {outgoingHeaders} from './gold-abv2-owner-ca-mtls-sidecar.mjs';

const proof='a'.repeat(64);
const ticket='/account/desktop/v4/wall-sso/ticket';
test('goldabv2 Lab sidecar strips caller-supplied native SSO proof and forwarded identity',()=>{
 const input={
  Host:'goldabv2.light-remote.thaiduy.digital',
  Authorization:'Bearer '+ 'A'.repeat(43),
  'X-Light-Remote-Edge-Proof-V4':'b'.repeat(64),
  'x-forwarded-for':'198.51.100.11',
  'x-forwarded-proto':'http',
  'x-forwarded-port':'9999',
  'x-forwarded-host':'evil.example',
  forwarded:'for=198.51.100.11',
  'x-original-forwarded-for':'198.51.100.12',
  'x-real-ip':'198.51.100.13',
  connection:'keep-alive',
  'content-type':'application/json'
 };
 const headers=outgoingHeaders(input,{method:'POST',url:ticket});
 assert.equal(headers['x-light-remote-edge-proof-v4'],undefined);
 assert.equal(headers['x-forwarded-for'],undefined);
 assert.equal(headers.forwarded,undefined);
 assert.equal(headers['x-real-ip'],undefined);
 assert.equal(headers.connection,undefined);
 assert.equal(headers['x-forwarded-proto'],'https');
 assert.equal(headers['x-forwarded-port'],'443');
 assert.equal(headers['x-forwarded-host'],'goldabv2.light-remote.thaiduy.digital');
 assert.equal(headers.host,'goldabv2.light-remote.thaiduy.digital');
 assert.equal(headers.authorization,input.Authorization);
 assert.equal(headers['content-type'],'application/json');
 assert.equal(input['X-Light-Remote-Edge-Proof-V4'],'b'.repeat(64));
});
test('local proof replaces spoofed input ONLY on exact native POST route',()=>{
 const spoof={
  host:'goldabv2.light-remote.thaiduy.digital',
  'x-light-remote-edge-proof-v4':'b'.repeat(64)
 };
 const issued=outgoingHeaders(spoof,{method:'POST',url:ticket,edgeProof:proof});
 assert.equal(issued['x-light-remote-edge-proof-v4'],proof);
 for(const [method,url] of [
  ['GET',ticket],['POST',ticket+'?debug=1'],
  ['POST',ticket+'/'],['POST','/account/login'],
  ['HEAD',ticket],['POST','/mcp']]){
   const h=outgoingHeaders(spoof,{method,url,edgeProof:proof});
   assert.equal(h['x-light-remote-edge-proof-v4'],undefined,method+' '+url);
 }
});
test('malformed local SSO proof cannot be stamped',()=>{
 for(const edgeProof of ['','b'.repeat(63),'B'.repeat(64),123,{}]){
  assert.throws(()=>outgoingHeaders({host:'example.com'},
    {method:'POST',url:ticket,edgeProof}),/edge_proof_invalid/);
 }
});
test('input header shape invalid fails closed',()=>{
 for(const bad of [null,undefined,42,'headers',[]]){
  assert.throws(()=>outgoingHeaders(bad),/headers_invalid/);
 }
});
test('opaque data, content-length and cookies preserved for normal Plugin endpoints',()=>{
 const h=outgoingHeaders({
  host:'goldabv2.light-remote.thaiduy.digital',
  cookie:'account_session=opaque',
  'content-length':'3',
  'content-type':'application/json',
  'x-correlation-id':'trace-123'
 },{method:'POST',url:'/mcp'});
 assert.equal(h.cookie,'account_session=opaque');
 assert.equal(h['content-length'],'3');
 assert.equal(h['x-correlation-id'],'trace-123');
 assert.equal(h['x-forwarded-proto'],'https');
 assert.equal(h['x-light-remote-edge-proof-v4'],undefined);
});
test('tracked sidecar preserves TLS1.3 client cert checks and loopback boundary',()=>{
 const source=readFileSync(new URL('./gold-abv2-owner-ca-mtls-sidecar.mjs',import.meta.url),'utf8');
 assert.match(source,/minVersion:'TLSv1\.3',maxVersion:'TLSv1\.3'/);
 assert.match(source,/requestCert:true,rejectUnauthorized:true/);
 assert.match(source,/HOST='127\.0\.0\.1',PORT=5584,BACKEND_PORT=5583/);
 assert.match(source,/getPeerCertificate/);
 assert.match(source,/timingSafeEqual/);
 assert.match(source,/server\.on\('upgrade'/);
});
