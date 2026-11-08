/**
 * rc50 disposable UAT ONLY. Persistent private-network verifier ingress.
 * Ephemeral HMAC producer credential, replay cache, and scoped SCRAM reader.
 * Deliberately cannot mint grants, sign origin, or authorize OS side effects.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {verifyViaSyntheticDb} from './synthetic-owner-channel-verifier-pg.mjs';
import {SyntheticReplayJournal} from './synthetic-durable-nonce-journal.mjs';
import {SyntheticSingleInstanceLease} from './synthetic-single-instance-lease.mjs';

const PORT=39071;
const HASH=/^[a-f0-9]{64}$/;
const NONCE=/^[a-f0-9]{32}$/;
const MAX_BODY=24000;
const WINDOW_MS=30000;
// Refuse to boot without a pre-provisioned owner-only durable state mount.
// NEVER automatically reset the journal after a crash or permission failure.
const replayJournalPath='/var/lib/lr-rc50-uat/nonce-journal';
let replayJournal;
let replayLease;
const send=(res,status,obj)=>{
 res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',
   'x-content-type-options':'nosniff'});
 res.end(JSON.stringify(obj)+'\n');
};
function key(){
 const fd=fs.openSync('/tmp/lr_rc50_uat_ingress_hmac',
    fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let hex;
 try{
  const st=fs.fstatSync(fd);
  if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid()||
      (st.mode&0o077)!==0||st.size>128)
   throw Error('INGRESS_KEY_FILE_UNTRUSTED');
  hex=fs.readFileSync(fd,'utf8').trim();
 }finally{fs.closeSync(fd);}
 if(!HASH.test(hex))throw Error('MISSING_INGRESS_IDENTITY');
 return Buffer.from(hex,'hex');
}
function authenticate(body,headers){
 try{
  const ts=headers['x-uat-time'],nonce=headers['x-uat-nonce'];
  const provided=headers['x-uat-signature'];
  if(!/^\d{13}$/.test(ts??'')||!NONCE.test(nonce??'')||
      !HASH.test(provided??''))return 401;
  const num=Number(ts);
  if(Math.abs(Date.now()-num)>WINDOW_MS)return 401;
  const sha=crypto.createHash('sha256').update(body).digest('hex');
  const mac=crypto.createHmac('sha256',key())
     .update(ts+':'+nonce+':'+sha).digest();
  if(!crypto.timingSafeEqual(mac,Buffer.from(provided,'hex')))return 401;
  if(!replayLease.owns())return 503;
  return replayJournal.claim(nonce);
 }catch{return 503;}
}
const server=http.createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/health'){
  try{
   key();fs.accessSync('/tmp/lr_rc50_origin_reader_secret',fs.constants.R_OK);
   if(!replayLease.owns()||replayJournal.failed||
      replayJournal.seen.size>=replayJournal.limit)
    throw Error('REPLAY_JOURNAL_UNAVAILABLE');
   return send(res,200,{ready:true,production:false});
  }
  catch{return send(res,503,{ready:false,production:false});}
 }
 if(req.method!=='POST'||req.url!=='/v1/verify'){
   return send(res,404,{decision:'DENY'});}
 let chunks=[],len=0,over=false;
 req.on('data',data=>{
  len+=data.length;
  if(len>MAX_BODY){over=true;chunks=[];}else if(!over)chunks.push(data);
 });
 req.on('end',()=>{
  if(over)return send(res,413,{decision:'DENY',reason:'BODY_TOO_LARGE'});
  const body=Buffer.concat(chunks);
  const auth=authenticate(body,req.headers);
  if(auth!==200)return send(res,auth,{decision:'DENY',reason:'INGRESS_NOT_AUTHORIZED'});
  let input;
  try{input=JSON.parse(body.toString('utf8'));}
  catch{return send(res,400,{decision:'DENY',reason:'INPUT_INVALID'});}
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).sort().join(',')!=='envelope'){
    return send(res,400,{decision:'DENY',reason:'UNTRUSTED_CONTEXT_FORBIDDEN'});}
  const output=verifyViaSyntheticDb(input.envelope);
  return send(res,200,output);
 });
 req.on('error',()=>send(res,400,{decision:'DENY',reason:'STREAM_ERROR'}));
});
if(process.argv.slice(2).join(' ')!=='--synthetic-service'||
   process.env.LR_RC50_UAT_ONLY!=='1'){
 process.stderr.write('rc50_synthetic_service_requires_optin\n');
 process.exit(3);
}
try{
 // This deliberate fail-closed gate also blocks startup on any torn record.
 key();
 replayLease=new SyntheticSingleInstanceLease(replayJournalPath);
 replayJournal=new SyntheticReplayJournal(replayJournalPath);
}catch{
 process.stderr.write('rc50_synthetic_replay_journal_not_ready\n');
 process.exit(5);
}
server.requestTimeout=8000;
server.headersTimeout=6000;
server.on('close',()=>{
 try{replayJournal?.close();replayLease?.release();}
 catch{process.exitCode=6;}
});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close());
server.listen(PORT,'0.0.0.0',()=>process.stdout.write('RC50_UAT_NODE_VERIFIER_LISTENING\n'));
