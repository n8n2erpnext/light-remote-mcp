// Synthetic-only signed-JWT UAT HTTP replica.
// The parent process implements a deliberately MOCKED atomic consume ledger,
// NOT PostgreSQL. No production secrets, real OAuth routes or DB logins.
import http from 'node:http';
import crypto from 'node:crypto';
import {OAuthReplayGateUat} from '../../src/identity/oauth-replay-uat.mjs';
import {makeUatJwtVerifier} from './uat-hs256-token.mjs';

let gate,server,proof;
let sequence=0;
const pending=new Map();
function sendToParent(args){
  return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{
      pending.delete(id);reject(Error('uat_mock_ledger_timeout'));
    },5000);
    pending.set(id,{resolve,reject,timer});
    process.send({kind:'mock-consume',id,args});
  });
}
function constantEquals(a,b){
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&crypto.timingSafeEqual(x,y);
}
function respond(res,status,body){
  res.writeHead(status,{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'
  });
  res.end(JSON.stringify(body));
}
async function readBody(req){
  const max=17000;
  if(Number(req.headers['content-length']||0)>max)throw Error('oversized_payload');
  let total=0;const parts=[];
  for await(const chunk of req){
    total+=chunk.length;
    if(total>max)throw Error('oversized_payload');
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
async function onRequest(req,res){
  if(!constantEquals(req.headers['x-uat-proof'],proof)){
    respond(res,403,{error:'uat_forbidden'});return;
  }
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(req.method==='GET'&&path==='/uat/oauth-health'){
    respond(res,200,{uatOnly:true,ready:Boolean(gate),pid:process.pid});return;
  }
  if(req.method!=='POST'||path!=='/uat/oauth-consume'){
    respond(res,404,{error:'uat_route_not_found'});return;
  }
  if(!String(req.headers['content-type']||'').startsWith('application/json')){
    respond(res,415,{error:'content_type_required'});return;
  }
  let body;
  try{body=await readBody(req);}
  catch{respond(res,400,{error:'invalid_json_payload'});return;}
  if(!body||typeof body!=='object'||Array.isArray(body)){
    respond(res,400,{error:'invalid_request'});return;
  }
  try{
    const accepted=await gate.consume({
      token:body.token,purpose:body.purpose,clientId:body.clientId,
      resource:body.resource,redirectUri:body.redirectUri,
      codeVerifier:body.codeVerifier
    });
    respond(res,accepted?200:409,accepted?
      {result:'uat_mock_consumed',pid:process.pid,ledger:'parent-memory-mock'}:
      {error:'uat_mock_replay',pid:process.pid,ledger:'parent-memory-mock'});
  }catch(error){
    const message=String(error?.message||'');
    if(message.startsWith('jwt_')){
      respond(res,401,{error:'synthetic_invalid_jwt'});return;
    }
    if(message==='uat_mock_ledger_offline'||message==='uat_mock_ledger_timeout'){
      respond(res,503,{error:'synthetic_ledger_unavailable'});return;
    }
    respond(res,400,{error:'synthetic_oauth_validation_failed'});
  }
}
process.on('message',async msg=>{
  if(msg?.kind==='mock-result'){
    const waiter=pending.get(msg.id);
    if(!waiter)return;
    pending.delete(msg.id);clearTimeout(waiter.timer);
    if(msg.error)waiter.reject(Error('uat_mock_ledger_offline'));
    else waiter.resolve(msg.accepted===true);
    return;
  }
  if(msg?.kind!=='start'||server)return;
  if(!/^[a-f0-9]{64}$/.test(String(msg.secret||''))||
    !/^[a-f0-9]{64}$/.test(String(msg.jwtKey||''))){
    process.send?.({kind:'fatal',reason:'bad_uat_parent_configuration'});return;
  }
  proof=msg.secret;
  const verifier=makeUatJwtVerifier({secret:Buffer.from(msg.jwtKey,'hex')});
  // Test stub reports a pretend UAT PG role strictly to exercise GATE contract.
  // It does NOT open a PostgreSQL connection or grant any DB privilege.
  const store={
    verifyTarget:async()=>({
      database:'light_remote_rc50_uat',role:'lr_rc50_oauth_replay',superuser:false
    }),
    consume:sendToParent
  };
  gate=new OAuthReplayGateUat({store,verifyJwt:verifier,allowUat:true});
  try{await gate.initialize();}
  catch{process.send?.({kind:'fatal',reason:'mock_gate_init_failed'});return;}
  server=http.createServer((req,res)=>{void onRequest(req,res).catch(()=>{
    if(!res.headersSent)respond(res,503,{error:'uat_internal_error'});
  });});
  server.headersTimeout=6000;server.requestTimeout=5000;
  server.listen(0,'127.0.0.1',()=>{
    process.send?.({kind:'ready',pid:process.pid,host:'127.0.0.1',port:server.address().port});
  });
});
process.on('disconnect',()=>{
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('uat_mock_ledger_offline'));}
  pending.clear();server?.close(()=>process.exit(0));
});
