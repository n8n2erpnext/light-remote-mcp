import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {
 createLocalWallInstanceProof,loadOrCreateWallInstanceKey,wallInstanceMessage
} from '../../device-agent/local-wall-instance-proof.mjs';
import {loadCanonicalEndpoints} from '../../lib/canonical-endpoints.mjs';

const root=fileURLToPath(new URL('../../config/endpoints.json',import.meta.url));
const config=loadCanonicalEndpoints(root);
assert.equal(config.configRevision,2);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'goldabv2-instance-proof-'));
const keyFile=path.join(dir,'profile','wall-instance.key');
let wall;
try{
 const opts={
  keyFile,routePath:config.routeCatalog.wallInstanceProof.path,
  productId:config.productId,profile:config.selectedProfile,revision:config.configRevision
 };
 const signed=createLocalWallInstanceProof(opts);
 assert.equal(loadOrCreateWallInstanceKey(keyFile).length,32);
 assert.deepEqual(createLocalWallInstanceProof(opts).respond('a'.repeat(64)),
                   signed.respond('a'.repeat(64)),'key stable between restarts');
 if(process.platform!=='win32')assert.equal(fs.statSync(keyFile).mode&0o777,0o600);
 wall=startLocalWall({
  host:'127.0.0.1',port:0,instanceProof:signed,
  auth:{enabled:true,identity:()=>null,csrfForRequest:()=>'',verifyRequestCsrf:()=>false},
  getLocalStatus:async()=>({enrolled:false})
 });
 if(!wall.server.listening)await new Promise(r=>wall.server.once('listening',r));
 const base='http://127.0.0.1:'+wall.server.address().port;
 const nonce=crypto.randomBytes(32).toString('hex');
 const proofUrl=base+config.routeCatalog.wallInstanceProof.path;
 const response=await fetch(proofUrl+'?nonce='+nonce,{redirect:'manual'});
 assert.equal(response.status,200);
 const json=await response.json();
 const vector=crypto.createHmac('sha256',Buffer.alloc(32,0x11))
  .update(wallInstanceMessage({nonce:'aa'.repeat(32),pid:4242,
   productId:config.productId,profile:config.selectedProfile,
   revision:config.configRevision})).digest('hex');
 assert.equal(vector,'f747cc842827747022d75f5a889c7a34e55db1deefd08e5a98b0757abe510329');
 const expected=crypto.createHmac('sha256',loadOrCreateWallInstanceKey(keyFile))
   .update(wallInstanceMessage({nonce,pid:json.pid,productId:config.productId,
      profile:config.selectedProfile,revision:config.configRevision})).digest('hex');
 assert.equal(json.mac,expected);
 assert.equal(json.pid,process.pid);
 assert.equal(json.productId,'goldabv2-desktop-v4');
 assert.equal(json.profile,'goldabv2-lab');
 assert.equal(json.configRevision,config.configRevision);
 // Raw same-host native clients do not support redirects or chunked JSON.
 const raw=await new Promise((resolve,reject)=>{
  const parts=[];
  const socket=net.connect(wall.server.address().port,'127.0.0.1');
  socket.setTimeout(2000,()=>socket.destroy(Error('proof_raw_timeout')));
  socket.on('connect',()=>socket.write(
   'GET '+config.routeCatalog.wallInstanceProof.path+'?nonce='+nonce+
   ' HTTP/1.1\r\nHost: 127.0.0.1:'+wall.server.address().port+
   '\r\nConnection: close\r\n\r\n'));
  socket.on('data',data=>parts.push(data));
  socket.on('end',()=>resolve(Buffer.concat(parts).toString('utf8')));
  socket.on('error',reject);
 });
 assert.match(raw,/^HTTP\/1\.1 200 /);
 assert.match(raw,/content-length: \d+/i);
 assert.doesNotMatch(raw,/transfer-encoding: chunked/i);
 assert.equal(JSON.parse(raw.split('\r\n\r\n')[1]).mac,expected);
 assert.ok(!JSON.stringify(json).includes(loadOrCreateWallInstanceKey(keyFile).toString('hex')),
   'key must never appear in HTTP response');
 assert.equal((await fetch(proofUrl+'?nonce=INVALID')).status,403);
 assert.equal((await fetch(proofUrl+'?nonce='+nonce+'&other=x')).status,403);
 assert.equal((await fetch(proofUrl+'?nonce='+nonce,{
  method:'POST'})).status,403);
 const hostDenied=await new Promise((resolve,reject)=>{
  const req=http.get(proofUrl+'?nonce='+nonce,
    {headers:{host:'unrelated.example'}},res=>{
      res.resume();resolve(res.statusCode);
    });
  req.on('error',reject);
 });
 assert.equal(hostDenied,403,'mismatched Host must fail closed');
 const locked=await fetch(base+'/api/status',{redirect:'manual'});
 assert.equal(locked.status,401,'instance proof must not unlock Owner session or /api/status');
 await wall.close();wall=null;
 const noProof=startLocalWall({host:'127.0.0.1',port:0,
  auth:{enabled:true,identity:()=>null},
  getLocalStatus:async()=>({enrolled:false})});
 wall=noProof;
 if(!wall.server.listening)await new Promise(r=>wall.server.once('listening',r));
 const noProofBase='http://127.0.0.1:'+wall.server.address().port;
 assert.equal((await fetch(noProofBase+config.routeCatalog.wallInstanceProof.path+'?nonce='+nonce)).status,401,
   'regular Gold Wall must not expose GoldABV2 proof');
 await wall.close();wall=null;
 fs.writeFileSync(keyFile,'corrupt-key');
 assert.throws(()=>createLocalWallInstanceProof(opts),/local_instance_key_invalid/,
   'corrupt key cannot fall back or silently rotate');
 console.log('T11_GOLDABV2_LOCAL_INSTANCE_FRESH_HMAC_LOOPBACK_HTTP_OWNER_GATE_NO_BEARER_PASS');
}finally{
 if(wall)await wall.close();
 fs.rmSync(dir,{recursive:true,force:true});
}
