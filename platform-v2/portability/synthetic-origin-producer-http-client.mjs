/** rc50 synthetic-only ingress producer; no owner identity or real signing. */
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
const mode=process.argv[2];
const modes=new Set(['--single','--replay','--bad-signature','--tamper-body','--extra-trusted']);
if(!modes.has(mode)||process.env.LR_RC50_UAT_ONLY!=='1'){
 process.exit(3);
}
let raw='';
for await(const part of process.stdin){
 raw+=part.toString('utf8');
 if(raw.length>24000)process.exit(4);
}
let input;
try{
 input=JSON.parse(raw);
 if(!input||Object.keys(input).join(',')!=='envelope')throw Error('input');
}catch{process.exit(4);}
const nonce=crypto.randomBytes(16).toString('hex');
const timestamp=String(Date.now());
const keyhex=fs.readFileSync('/tmp/lr_rc50_uat_ingress_hmac','utf8').trim();
if(!/^[a-f0-9]{64}$/.test(keyhex))process.exit(5);
const original=JSON.stringify(mode==='--extra-trusted'?
  {...input,trusted:{grantId:'uat_forged'}}:input);
const digest=crypto.createHash('sha256').update(original).digest('hex');
let signature=crypto.createHmac('sha256',Buffer.from(keyhex,'hex'))
 .update(timestamp+':'+nonce+':'+digest).digest('hex');
if(mode==='--bad-signature')signature='0'.repeat(64);
const body=mode==='--tamper-body'?original+' ':original;
async function sendOnce(){
 return new Promise((resolve,reject)=>{
  const req=http.request({
   hostname:'verifier',port:39071,path:'/v1/verify',method:'POST',
   timeout:8000,headers:{
    'content-type':'application/json','content-length':Buffer.byteLength(body),
    'x-uat-time':timestamp,'x-uat-nonce':nonce,'x-uat-signature':signature
   }},r=>{
    let body='';
    r.on('data',b=>{body+=b.toString('utf8');if(body.length>16000)r.destroy();});
    r.on('end',()=>{try{resolve({status:r.statusCode,body:JSON.parse(body)});}
      catch{reject(Error('BAD_RESPONSE'));}});
  });
  req.on('timeout',()=>req.destroy(Error('TIMEOUT')));
  req.on('error',reject);
  req.end(body);
 });
}
try{
 const a=await sendOnce();
 if(mode==='--replay'){
  const b=await sendOnce();
  process.stdout.write(JSON.stringify({first:a.status,second:b.status})+'\n');
 }else process.stdout.write(JSON.stringify(a)+'\n');
}catch{process.stderr.write('SYNTHETIC_PRODUCER_FAILED\n');process.exitCode=6;}
