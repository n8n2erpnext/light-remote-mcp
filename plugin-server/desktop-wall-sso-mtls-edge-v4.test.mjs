import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createDesktopWallSsoMtlsEdgeV4} from './desktop-wall-sso-mtls-edge-v4.mjs';

const PREFIX='LR_GOLD_ABV2_DESKTOP_WALL_SSO_';
function config(root){
  return {
    [PREFIX+'MTLS_EDGE_V4']:'1',
    [PREFIX+'MTLS_PORT_V4']:'15584',
    [PREFIX+'MTLS_CERT_PATH_V4']:path.join(root,'server.crt'),
    [PREFIX+'MTLS_KEY_PATH_V4']:path.join(root,'server.key'),
    [PREFIX+'MTLS_CLIENT_CA_PATH_V4']:path.join(root,'ca.crt'),
    [PREFIX+'MTLS_CLIENT_SHA256_V4']:'a'.repeat(64)
  };
}
function openssl(...args){
  execFileSync('openssl',args,{stdio:'ignore',timeout:10000});
}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-t04b8-mtls-'));
  const p=(f)=>path.join(dir,f);
  const ext=(f,text)=>fs.writeFileSync(p(f),text,{mode:0o600});
  openssl('req','-x509','-newkey','rsa:2048','-nodes','-days','1',
    '-subj','/CN=Gold Test CA','-keyout',p('ca.key'),'-out',p('ca.crt'));
  openssl('req','-newkey','rsa:2048','-nodes',
    '-subj','/CN=goldabv2-edge.lab','-keyout',p('server.key'),
    '-out',p('server.csr'));
  ext('server.ext','subjectAltName=DNS:goldabv2-edge.lab\nextendedKeyUsage=serverAuth\n');
  openssl('x509','-req','-in',p('server.csr'),'-CA',p('ca.crt'),
    '-CAkey',p('ca.key'),'-CAcreateserial','-out',p('server.crt'),
    '-days','1','-extfile',p('server.ext'));
  openssl('req','-newkey','rsa:2048','-nodes','-subj','/CN=Gold Traefik Lab',
    '-keyout',p('client.key'),'-out',p('client.csr'));
  ext('client.ext','extendedKeyUsage=clientAuth\n');
  openssl('x509','-req','-in',p('client.csr'),'-CA',p('ca.crt'),
    '-CAkey',p('ca.key'),'-CAserial',p('ca.srl'),'-out',p('client.crt'),
    '-days','1','-extfile',p('client.ext'));
  openssl('req','-newkey','rsa:2048','-nodes','-subj','/CN=Unpinned Lab Client',
    '-keyout',p('other.key'),'-out',p('other.csr'));
  openssl('x509','-req','-in',p('other.csr'),'-CA',p('ca.crt'),
    '-CAkey',p('ca.key'),'-CAserial',p('ca.srl'),'-out',p('other.crt'),
    '-days','1','-extfile',p('client.ext'));
  const fingerprint=crypto.createHash('sha256')
    .update(new crypto.X509Certificate(fs.readFileSync(p('client.crt'))).raw)
    .digest('hex');
  return {dir,p,env:{...config(dir),[PREFIX+'MTLS_CLIENT_SHA256_V4']:fingerprint}};
}
async function request(port,options={}){
  return await new Promise((resolve,reject)=>{
    const req=https.request({
      hostname:'127.0.0.1',port,servername:'goldabv2-edge.lab',
      path:'/healthz',method:'GET',timeout:2000,
      ...options
    },res=>{
      let body='';
      res.on('data',chunk=>body+=chunk);
      res.on('end',()=>resolve({status:res.statusCode,body}));
    });
    req.on('timeout',()=>req.destroy(new Error('tls_timeout')));
    req.on('error',reject);
    req.end();
  });
}
test('T04b8 A2 mTLS OFF by default and never reads certificate paths',()=>{
  assert.deepEqual(createDesktopWallSsoMtlsEdgeV4(),{enabled:false,server:null});
});
test('T04b8 A2 rejects missing certs, malformed port, and mixed proxy allowlist',()=>{
  const root='/not/existing';
  const mock=()=>{throw new Error('must not be called');};
  for(const changes of [
    {[PREFIX+'MTLS_PORT_V4']:'65536'},
    {[PREFIX+'MTLS_PORT_V4']:'80'},
    {[PREFIX+'MTLS_CERT_PATH_V4']:'relative-cert.pem'},
    {[PREFIX+'MTLS_CLIENT_SHA256_V4']:'not-a-fingerprint'},
    {[PREFIX+'MTLS_CLIENT_SHA256_V4']:undefined},
    {[PREFIX+'MTLS_CLIENT_SHA256_NEXT_V4']:''},
    {[PREFIX+'MTLS_CLIENT_SHA256_NEXT_V4']:'bad'},
    {[PREFIX+'MTLS_CLIENT_SHA256_NEXT_V4']:'A'.repeat(64)},
    {[PREFIX+'MTLS_CLIENT_SHA256_NEXT_V4']:'a'.repeat(64)},
    {[PREFIX+'PROXY_PEERS_V4']:'127.0.0.1'}
  ]){
    assert.throws(()=>createDesktopWallSsoMtlsEdgeV4({
      env:{...config(root),...changes},app:()=>{},readFile:mock
    }),/desktop_wall_sso_mtls_edge_unavailable/);
  }
  assert.throws(()=>createDesktopWallSsoMtlsEdgeV4({
    env:config(root),app:()=>{},readFile:mock
  }),/desktop_wall_sso_mtls_edge_unavailable/);
});
test('T04b8 A2 real TLS1.3 handshake requires trusted client cert; binds loopback only',async(t)=>{
  const f=fixture();
  t.after(()=>fs.rmSync(f.dir,{recursive:true,force:true}));
  let calls=0;
  const app=(_req,res)=>{calls++;res.writeHead(200);res.end('owner-transport-only');};
  const edge=createDesktopWallSsoMtlsEdgeV4({env:f.env,app});
  assert.equal(edge.host,'127.0.0.1');
  assert.equal(edge.port,15584);
  assert.equal(edge.enabled,true);
  await new Promise((resolve,reject)=>{
    edge.server.once('error',reject);
    edge.server.listen(0,edge.host,resolve);
  });
  t.after(()=>new Promise(resolve=>edge.server.close(resolve)));
  const port=edge.server.address().port;
  const ca=fs.readFileSync(f.p('ca.crt'));
  const result=await request(port,{
    ca,cert:fs.readFileSync(f.p('client.crt')),
    key:fs.readFileSync(f.p('client.key'))
  });
  assert.deepEqual(result,{status:200,body:'owner-transport-only'});
  assert.equal(calls,1);
  await assert.rejects(request(port,{ca}));
  assert.equal(calls,1,'Missing mTLS identity must not reach Express');
  const other=await request(port,{
    ca,cert:fs.readFileSync(f.p('other.crt')),
    key:fs.readFileSync(f.p('other.key'))
  });
  assert.equal(other.status,403,'Valid CA but unpinned leaf is denied');
  assert.equal(calls,1,'Unpinned client must never reach Express');
  await assert.rejects(request(port,{
    ca,cert:fs.readFileSync(f.p('server.crt')),
    key:fs.readFileSync(f.p('server.key'))
  }));
  assert.equal(calls,1,'Certificate for serverAuth must not pass clientAuth');
});

test('T04b8 rotation: only old+next pinned client leaves during overlap, then old denied',async(t)=>{
  const f=fixture();
  t.after(()=>fs.rmSync(f.dir,{recursive:true,force:true}));
  const ca=fs.readFileSync(f.p('ca.crt'));
  const oldCert=fs.readFileSync(f.p('client.crt'));
  const oldKey=fs.readFileSync(f.p('client.key'));
  const nextCert=fs.readFileSync(f.p('other.crt'));
  const nextKey=fs.readFileSync(f.p('other.key'));
  const nextPin=crypto.createHash('sha256')
    .update(new crypto.X509Certificate(nextCert).raw).digest('hex');
  let allowed=0;
  const app=(_req,res)=>{allowed++;res.writeHead(200);res.end('allowed');};
  async function start(env){
    const edge=createDesktopWallSsoMtlsEdgeV4({env,app});
    await new Promise((resolve,reject)=>{
      edge.server.once('error',reject);
      edge.server.listen(0,edge.host,resolve);
    });
    t.after(()=>new Promise(resolve=>edge.server.close(resolve)));
    return edge.server.address().port;
  }
  const overlappingPort=await start({
    ...f.env,[PREFIX+'MTLS_CLIENT_SHA256_NEXT_V4']:nextPin
  });
  assert.equal((await request(overlappingPort,{ca,cert:oldCert,key:oldKey})).status,200);
  assert.equal((await request(overlappingPort,{ca,cert:nextCert,key:nextKey})).status,200);
  assert.equal(allowed,2);
  await assert.rejects(request(overlappingPort,{ca}));
  assert.equal(allowed,2);
  // Once the next leaf is promoted and the overlap pin removed, old must fail.
  const finalPort=await start({...f.env,
    [PREFIX+'MTLS_CLIENT_SHA256_V4']:nextPin
  });
  assert.equal((await request(finalPort,{ca,cert:oldCert,key:oldKey})).status,403);
  assert.equal((await request(finalPort,{ca,cert:nextCert,key:nextKey})).status,200);
  assert.equal(allowed,3);
});
