// Synthetic-only HTTP UAT replica, NOT a production OAuth/login endpoint.
// Bind 127.0.0.1 on an OS-assigned port; startup requires trusted parent IPC.
// No real users, passwords, JWTs, forwarded-IP inference or billing.
import http from 'node:http';
import crypto from 'node:crypto';
import {RedisUatAuxiliary} from '../../src/storage/redis.mjs';
import {createRedisCliUatClient} from './redis-cli-uat.mjs';

const HOST='127.0.0.1';
let server,limiter,secret,salt,outage=false;
function safeEquals(a,b){
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&crypto.timingSafeEqual(x,y);
}
function reply(res,status,object,extra={}){
  res.writeHead(status,{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff',
    ...extra
  });
  res.end(JSON.stringify(object));
}
async function readBody(req){
  if(Number(req.headers['content-length']||0)>1024)throw Error('uat_payload_too_large');
  let size=0;const parts=[];
  for await(const chunk of req){
    size+=chunk.length;
    if(size>1024)throw Error('uat_payload_too_large');
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
async function onRequest(req,res){
  if(!safeEquals(req.headers['x-uat-proof'],secret)){
    reply(res,403,{error:'uat_permission_denied'});return;
  }
  let pathname;
  try{pathname=new URL(req.url,'http://127.0.0.1').pathname;}
  catch{reply(res,400,{error:'invalid_url'});return;}
  if(req.method==='GET'&&pathname==='/uat/healthz'){
    reply(res,200,{ok:true,pid:process.pid,uatOnly:true});return;
  }
  if(req.method!=='POST'||!['/uat/synthetic-failure','/uat/synthetic-success'].includes(pathname)){
    reply(res,404,{error:'unknown_uat_route'});return;
  }
  if(!String(req.headers['content-type']||'').startsWith('application/json')){
    reply(res,415,{error:'uat_content_type_required'});return;
  }
  let data;
  try{data=await readBody(req);}catch{
    reply(res,400,{error:'uat_invalid_body'});return;
  }
  if(!data||typeof data.actor!=='string'||!/^uat_actor_[a-z0-9]{20}$/.test(data.actor)){
    reply(res,400,{error:'uat_actor_invalid'});return;
  }
  // Reproduce the important business distinction: valid attempts do not
  // accumulate a FAILED-auth counter.
  if(pathname==='/uat/synthetic-success'){
    reply(res,204,null);return;
  }
  const hash=crypto.createHmac('sha256',salt).update(data.actor).digest('hex').slice(0,32);
  const key='oauthhttp-'+hash;
  try{
    if(outage)throw Error('injected_redis_outage');
    const decision=await limiter.rateHit(key,{limit:12,windowSeconds:60});
    reply(res,decision.allowed?401:429,{
      outcome:decision.allowed?'synthetic_invalid_credentials':'synthetic_rate_limited',
      count:decision.count,remaining:decision.remaining,
      pid:process.pid,uatOnly:true
    },decision.allowed?{}:{'retry-after':String(Math.max(1,decision.retryAfterSeconds))});
  }catch{
    reply(res,503,{error:'uat_rate_backend_unavailable',uatOnly:true});
  }
}
process.on('message',async msg=>{
  if(msg?.kind==='outage'){outage=msg.enabled===true;process.send?.({kind:'outage-set',enabled:outage});return;}
  if(msg?.kind!=='start'||server)return;
  if(!/^[a-f0-9]{64}$/.test(String(msg.secret||''))||
     !/^[a-f0-9]{64}$/.test(String(msg.salt||''))){
    process.send?.({kind:'fatal',error:'invalid_uat_ipc_setup'});process.exit(1);return;
  }
  secret=msg.secret;salt=Buffer.from(msg.salt,'hex');
  const client=createRedisCliUatClient();
  limiter=new RedisUatAuxiliary({client,prefix:'lr:rc50:uat:auth:',allowUat:true});
  server=http.createServer((req,res)=>{void onRequest(req,res).catch(()=>{
    if(!res.headersSent)reply(res,503,{error:'uat_internal_error'});
  });});
  server.requestTimeout=5000;
  server.headersTimeout=6000;
  server.maxRequestsPerSocket=100;
  server.listen(0,HOST,()=>{
    process.send?.({kind:'ready',pid:process.pid,host:HOST,port:server.address().port});
  });
});
process.on('disconnect',()=>server?.close(()=>process.exit(0)));
