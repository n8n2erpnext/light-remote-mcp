import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
// This worktree intentionally does not install the Plugin's Express runtime.
 // The HTTP harness below emulates the scoped parser; source tests separately
 // assert Express mounts the real 2-KiB middleware ahead of its 12-MiB parser.
import {
  registerDesktopWallSsoNativeIssuerV4,
  desktopWallSsoIssuerEnabledV4,
  DESKTOP_WALL_SSO_TICKET_PATH_V4,
  DESKTOP_WALL_SSO_MAX_BODY_BYTES_V4,
  DESKTOP_WALL_SSO_INTERNAL_ISSUE_V4
} from './desktop-wall-sso-native-router-v4.mjs';
import {DESKTOP_WALL_SSO_OPERATOR_REQUIRED_FLAGS,
  DESKTOP_WALL_SSO_ISSUER_FLAG_V4}
  from '../operator-host/desktop-wall-sso-operator-gate-v4.mjs';
import {handleDeviceChannelRoutes}
  from '../operator-host/executor-routes-device-channel.mjs';

const TOKEN='A'.repeat(43),DEVICE='dev_t04b7b_actual_transport';
const TICKET='T'.repeat(43),PUBLIC='goldabv2.light-remote.thaiduy.digital';
const EDGE_PROOF='b'.repeat(64);
const enabledEnv=()=>({
  ...Object.fromEntries(DESKTOP_WALL_SSO_OPERATOR_REQUIRED_FLAGS
    .map(k=>[k,'1'])),
  [DESKTOP_WALL_SSO_ISSUER_FLAG_V4]:'1'
});
const listen=(server,option)=>new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(option,()=>{server.off('error',reject);resolve(server.address());});
});
const close=server=>new Promise(resolve=>server.close(()=>resolve()));
const reply=(res,status,data)=>{
  res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(data));
  return data;
};
const readJson=async req=>{
  const chunks=[];
  for await(const c of req)chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
function request({port,host='127.0.0.1',socketPath,endpoint,body,headers={}}){
  const payload=Buffer.from(typeof body==='string'?body:JSON.stringify(body||{}));
  return new Promise((resolve,reject)=>{
    const q=http.request({
      ...(socketPath?{socketPath}:{host,port}),
      path:endpoint,method:'POST',
      headers:{'content-type':'application/json',
        'content-length':payload.length,...headers}
    },resp=>{
      const chunks=[];
      resp.on('data',c=>chunks.push(c));
      resp.on('end',()=>{
        const raw=Buffer.concat(chunks).toString('utf8');
        let result=null;
        try{result=JSON.parse(raw)}catch{}
        resolve({status:resp.statusCode,result,headers:resp.headers});
      });
    });
    q.on('error',reject);
    q.end(payload);
  });
}
async function withTransport(fn,{enablePlugin=true,enableOperator=true,
  proxyPeers=['127.0.0.1']}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-t04b7b-'));
  const unixPath=path.join(dir,'operator.sock');
  let operatorCalls=0,privateBodyReads=0;
  const operator=http.createServer(async(req,res)=>{
    try{
      await handleDeviceChannelRoutes(req,res,
        new URL(req.url,'http://operator.local'),{
          readJson:async r=>{privateBodyReads++;return readJson(r);},
          sendJson:reply,
          desktopWallSsoInternalIssue:enableOperator
            ?async({accessToken,deviceId})=>{
              operatorCalls++;
              if(accessToken!==TOKEN||deviceId!==DEVICE)
                throw Error('Owner not verified');
              return {ticket:TICKET,deviceId,
                expiresAt:Date.now()+40_000,
                purpose:'desktop_wall_sso_v4'};
            }:undefined
        });
      if(!res.writableEnded)reply(res,404,{ok:false,error:'not_found'});
    }catch{if(!res.writableEnded)reply(res,500,{ok:false,error:'fail_closed'});}
  });
  let web=null;
  try{
    await listen(operator,unixPath);
    const socketCall=async(method,endpoint,body)=>{
      assert.equal(method,'POST');
      assert.equal(endpoint,DESKTOP_WALL_SSO_INTERNAL_ISSUE_V4);
      const result=await request({socketPath:unixPath,endpoint,body});
      if(result.status!==200)
        throw Error('Operator_denied');
      return result.result;
    };
    const handlers=new Map();
    const app={post(route,handler){handlers.set(route,handler);}};
    const route=registerDesktopWallSsoNativeIssuerV4(app,{
      env:enablePlugin?enabledEnv():{},
      publicOrigin:'https://'+PUBLIC,
      operatorCall:socketCall,proxyPeers,edgeProofSecret:EDGE_PROOF
    });
    // Real HTTP and Unix-socket transport, but minimal native Node harness
    // instead of Express. It enforces the same 2-KiB JSON parsing ceiling.
    web=http.createServer(async(req,res)=>{
      try{
        if(req.method!=='POST'||
           req.url!==DESKTOP_WALL_SSO_TICKET_PATH_V4||
           !handlers.has(DESKTOP_WALL_SSO_TICKET_PATH_V4))
          return reply(res,404,{ok:false,error:'not_found'});
        let bytes=0;
        const chunks=[];
        for await(const chunk of req){
          bytes+=chunk.length;
          if(bytes>DESKTOP_WALL_SSO_MAX_BODY_BYTES_V4)
            return reply(res,413,{ok:false,error:'request_rejected'});
          chunks.push(chunk);
        }
        const decoded=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))
          return reply(res,400,{ok:false,error:'request_invalid'});
        req.body=decoded;
        req.originalUrl=req.url;
        req.secure=req.socket.remoteAddress==='127.0.0.1'&&
          req.headers['x-forwarded-proto']==='https';
        res.set=(key,value)=>{res.setHeader(key,value);return res;};
        res.status=value=>{res.statusCode=value;return res;};
        res.json=data=>{
          res.setHeader('content-type','application/json');
          res.end(JSON.stringify(data));
          return res;
        };
        await handlers.get(DESKTOP_WALL_SSO_TICKET_PATH_V4)(req,res);
      }catch{
        if(!res.headersSent)reply(res,400,{ok:false,error:'request_invalid'});
      }
    });
    const address=await listen(web,{host:'127.0.0.1',port:0});
    const call=async(payload={device_id:DEVICE},options={})=>
      request({port:address.port,endpoint:DESKTOP_WALL_SSO_TICKET_PATH_V4,
        body:payload,
        headers:{
          host:PUBLIC,'x-forwarded-proto':'https',
          authorization:'Bearer '+TOKEN,
          'x-light-remote-edge-proof-v4':EDGE_PROOF,
          ...options.headers
        }});
    await fn({call,route,operatorCalls:()=>operatorCalls,
      privateBodyReads:()=>privateBodyReads});
  }finally{
    if(web)await close(web);
    await close(operator);
    fs.rmSync(dir,{recursive:true,force:true});
  }
}

test('T04b7b Node HTTP simulated trusted-proxy ingress to real Unix socket returns ticket only',async()=>{
  await withTransport(async({call,route,operatorCalls,privateBodyReads})=>{
    assert.equal(route.enabled,true);
    const result=await call();
    assert.equal(result.status,200);
    assert.equal(result.result.ok,true);
    assert.equal(result.result.ticket,TICKET);
    assert.equal(result.result.deviceId,DEVICE);
    assert.equal('refreshToken' in result.result,false);
    assert.equal('familyId' in result.result,false);
    assert.equal(JSON.stringify(result.result).includes(TOKEN),false);
    assert.equal(operatorCalls(),1);
    assert.equal(privateBodyReads(),1);
  });
});
test('T04b7b default OFF produces 404 without contacting Unix Operator',async()=>{
  await withTransport(async({call,route,operatorCalls})=>{
    assert.equal(route.enabled,false);
    const result=await call();
    assert.equal(result.status,404);
    assert.equal(operatorCalls(),0);
  },{enablePlugin:false});
});
test('T04b7b 2 KiB pre-parser rejects oversized JSON before Unix call',async()=>{
  await withTransport(async({call,operatorCalls,privateBodyReads})=>{
    const result=await call({
      device_id:DEVICE,filler:'A'.repeat(2300)
    });
    assert.equal(result.status,413);
    assert.equal(operatorCalls(),0);
    assert.equal(privateBodyReads(),0);
  });
});
test('T04b7b actual Unix Operator denies when independent issuer OFF',async()=>{
  await withTransport(async({call,operatorCalls,privateBodyReads})=>{
    const result=await call();
    assert.equal(result.status,403);
    assert.equal(result.result.error,'desktop_wall_sso_issue_denied');
    assert.equal(operatorCalls(),0);
    assert.equal(privateBodyReads(),0);
  },{enableOperator:false});
});
test('T04b7b trusted forward-proxy allowlist is required for native HTTP ingress',async()=>{
  await withTransport(async({call,operatorCalls})=>{
    const result=await call();
    assert.equal(result.status,403);
    assert.equal(operatorCalls(),0);
  },{proxyPeers:[]});
});

test('T04b8 actual Node HTTP -> Unix socket rejects a direct backend HTTPS-header spoof',async()=>{
  await withTransport(async({call,operatorCalls,privateBodyReads})=>{
    const spoof=await call({device_id:DEVICE},{headers:{
      'x-forwarded-proto':'https',
      'x-light-remote-edge-proof-v4':''
    }});
    assert.equal(spoof.status,403);
    assert.deepEqual(spoof.result,{ok:false,error:'desktop_wall_sso_native_required'});
    assert.equal(operatorCalls(),0);
    assert.equal(privateBodyReads(),0);
  });
});
test('T04b8 actual Node HTTP -> Unix socket rejects incorrect edge proof',async()=>{
  await withTransport(async({call,operatorCalls})=>{
    const bad=await call({device_id:DEVICE},{headers:{
      'x-light-remote-edge-proof-v4':'c'.repeat(64)
    }});
    assert.equal(bad.status,403);
    assert.equal(operatorCalls(),0);
  });
});
