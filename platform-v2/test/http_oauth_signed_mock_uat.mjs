#!/usr/bin/env node
// Real loopback HTTP + actual ephemeral HS256 signatures/PKCE across 2 Node
// processes; replay ledger is a deliberately MOCKED parent Map, NOT PostgreSQL.
// Never claims real app DB integration, never reads a live JWT/signing secret.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {signUatJwt} from './helpers/uat-hs256-token.mjs';

const worker=fileURLToPath(new URL('./helpers/http-oauth-mocked-ledger-uat.mjs',import.meta.url));
const secret=crypto.randomBytes(32).toString('hex');
const signingKey=crypto.randomBytes(32);
const clientId='uat_client_http';
const origin='https://rc50-mcp.thaiduy.digital';
const redirectUri='https://callback.example.invalid/oauth';
const resource=origin+'/mcp';
const verifier=crypto.randomBytes(32).toString('base64url');
const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
const parentMockLedger=new Map();
const children=[];
let ledgerOffline=false;
const ts=Math.floor(Date.now()/1000);

function createClaims(purpose,overrides={}){
  const use=purpose==='authorization_code'?'code':
    purpose==='resume'?'oauth-resume':'refresh';
  const expiration=purpose==='authorization_code'?110:3600;
  return {
    iss:origin,aud:purpose==='resume'?origin+'/oauth/resume':resource,
    token_use:use,client_id:clientId,jti:crypto.randomUUID(),
    exp:ts+expiration,iat:ts,resource,
    ...(purpose==='resume'?{
      response_type:'code',code_challenge_method:'S256',code_challenge:challenge
    }:{
      sub:'uat_owner_http',
      ...(purpose==='authorization_code'?{
        redirect_uri:redirectUri,code_challenge:challenge
      }:{})
    }),...overrides
  };
}
function makeRequest(purpose,overrides={}){
  const claims=createClaims(purpose,overrides);
  return {purpose,clientId,resource,
    token:signUatJwt(claims,{secret:signingKey}),
    ...(purpose==='authorization_code'?{redirectUri,codeVerifier:verifier}:{})};
}
async function start(){
  const child=fork(worker,[],{stdio:['ignore','ignore','pipe','ipc']});
  children.push(child);
  child.stderr.on('data',data=>process.stderr.write(data));
  child.on('message',msg=>{
    if(msg?.kind!=='mock-consume')return;
    const args=msg.args;
    if(ledgerOffline){child.send({kind:'mock-result',id:msg.id,error:'offline'});return;}
    // Deliberately minimal deterministic, synchronized TEST ledger.
    // Never substitute for PostgreSQL atomic insertion or security ACL.
    const identity=String(args?.tokenSha256||'');
    if(!/^[a-f0-9]{64}$/.test(identity)){
      child.send({kind:'mock-result',id:msg.id,error:'invalid'});return;
    }
    const previous=parentMockLedger.has(identity);
    if(!previous)parentMockLedger.set(identity,{
      purpose:args.purpose,accountId:args.accountId,clientId:args.clientId
    });
    child.send({kind:'mock-result',id:msg.id,accepted:!previous});
  });
  const ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('mock_oauth_http_start_timeout')),12000);
    const onMsg=msg=>{
      if(msg?.kind==='ready'){
        clearTimeout(timer);child.off('message',onMsg);
        child.off('exit',onExit);resolve({
          child,pid:msg.pid,port:msg.port,host:msg.host
        });
      }else if(msg?.kind==='fatal'){
        clearTimeout(timer);child.off('message',onMsg);
        reject(Error('mock_oauth_http_start_failed'));
      }
    };
    const onExit=code=>{
      clearTimeout(timer);child.off('message',onMsg);
      reject(Error('mock_oauth_http_exited_'+code));
    };
    child.on('message',onMsg);child.once('exit',onExit);
  });
  child.send({kind:'start',secret,jwtKey:signingKey.toString('hex')});
  return ready;
}
async function request(server,body,{proof=secret}={}){
  const abort=new AbortController();
  const timer=setTimeout(()=>abort.abort(),15000);
  try{
    const response=await fetch('http://127.0.0.1:'+server.port+'/uat/oauth-consume',{
      method:'POST',signal:abort.signal,headers:{
        'x-uat-proof':proof,'content-type':'application/json',
        'x-forwarded-for':'203.0.113.123'
      },body:JSON.stringify(body)
    });
    return {status:response.status,body:await response.json()};
  }finally{clearTimeout(timer);}
}
async function stop(server){
  const child=server?.child;
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  const exited=new Promise(resolve=>{
    child.once('exit',resolve);
    setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},3000).unref();
  });
  child.kill('SIGTERM');await exited;
}
let a,b,replacement;
try{
  a=await start();b=await start();
  assert(a.pid!==b.pid&&a.host==='127.0.0.1'&&b.host==='127.0.0.1');
  console.log('RC50_SIGNED_JWT_TWO_HTTP_REPLICAS_PASS: 2 independent loopback UAT processes');
  assert.equal((await request(a,makeRequest('refresh'),{proof:'not-authorized'})).status,403);
  assert.equal(parentMockLedger.size,0);

  const code=makeRequest('authorization_code');
  const all=await Promise.all(Array.from({length:20},
    (_,i)=>request(i%2?a:b,code)));
  assert.equal(all.filter(x=>x.status===200).length,1);
  assert.equal(all.filter(x=>x.status===409).length,19);
  assert.equal(parentMockLedger.size,1);
  console.log('RC50_HTTP_HS256_PKCE_MOCK_CONSUME_PASS: signed authorization code 1 accepted, 19 mocked replays');

  await stop(a);
  replacement=await start();
  assert.equal((await request(replacement,code)).status,409);
  console.log('RC50_HTTP_MOCK_RESTART_REPLAY_PASS: second process remains blocked after first replaced');

  for(const purpose of ['refresh','resume']){
    const r=makeRequest(purpose);
    const results=await Promise.all(Array.from({length:8},
      (_,i)=>request(i%2?b:replacement,r)));
    assert.equal(results.filter(x=>x.status===200).length,1,purpose);
    assert.equal(results.filter(x=>x.status===409).length,7,purpose);
  }
  assert.equal(parentMockLedger.size,3);
  console.log('RC50_HTTP_HS256_REFRESH_RESUME_MOCK_REPLAY_PASS: each purpose 1 accepted / 7 denied');

  const signed=makeRequest('authorization_code');
  const oldSize=parentMockLedger.size;
  assert.equal((await request(b,{...signed,codeVerifier:'x'.repeat(43)})).status,400);
  assert.equal((await request(b,{...signed,clientId:'wrong_client'})).status,400);
  assert.equal((await request(b,{...signed,redirectUri:'https://evil.example.invalid'})).status,400);
  const pieces=signed.token.split('.');
  const mutated=pieces[0]+'.'+pieces[1]+'.'+(pieces[2][0]==='A'?'B':'A')+pieces[2].slice(1);
  assert.equal((await request(replacement,{...signed,token:mutated})).status,401);
  assert.equal((await request(b,makeRequest('authorization_code',{iss:'https://wrong.invalid'}))).status,401);
  assert.equal((await request(b,makeRequest('authorization_code',{exp:ts-1}))).status,401);
  assert.equal(parentMockLedger.size,oldSize);
  console.log('RC50_HTTP_HS256_PKCE_NEGATIVE_PASS: bad signature, issuer, expiry, client, redirect, PKCE never consume');

  ledgerOffline=true;
  const offline=await request(b,makeRequest('refresh'));
  assert.equal(offline.status,503);
  assert.equal(parentMockLedger.size,oldSize);
  ledgerOffline=false;
  const recovered=await request(replacement,makeRequest('refresh'));
  assert.equal(recovered.status,200);
  console.log('RC50_HTTP_MOCK_LEDGER_OUTAGE_FAIL_CLOSED_PASS: 503 unavailable, then recovery');

  assert([...parentMockLedger.keys()].every(x=>/^[0-9a-f]{64}$/.test(x)));
  assert([...parentMockLedger.values()].every(x=>x.accountId===null||x.accountId==='uat_owner_http'));
  console.log('RC50_HTTP_NO_RAW_JWT_IN_MOCK_LEDGER_PASS');
}finally{
  await Promise.allSettled([a,b,replacement].filter(Boolean).map(stop));
  for(const child of children){
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
  }
  parentMockLedger.clear();
  console.log('RC50_HTTP_SIGNED_JWT_MOCK_CLEANUP_PASS');
}
