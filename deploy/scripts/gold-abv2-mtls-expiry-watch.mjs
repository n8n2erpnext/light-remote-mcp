/**
 * T04b8-A2 read-only mTLS certificate expiry/renewal watchdog.
 * Reads ONLY public X.509 certificates. No private keys, issuance, deployment,
 * automatic renewal or network requests. Suitable for scheduled owner alerts.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const DAY=86_400_000;
const fail=(code)=>{throw new Error('gold_mtls_expiry_watch_'+code);};
function file(dir,name){
  const p=path.join(dir,name);
  let st;
  try{st=fs.lstatSync(p);}catch{fail('certificate_missing');}
  if(!st.isFile()||st.isSymbolicLink()||st.size<20||st.size>131072)
    fail('invalid_certificate_file');
  return p;
}
function cert(p){
  try{return new crypto.X509Certificate(fs.readFileSync(p));}
  catch{fail('invalid_certificate_encoding');}
}
function purpose(caFile,leafFile,role){
  try{
    execFileSync('openssl',['verify','-CAfile',caFile,
      '-purpose',role==='server'?'sslserver':'sslclient',leafFile],
      {stdio:'ignore',timeout:10000});
  }catch{fail('invalid_'+role+'_purpose_or_chain');}
}
function fingerprint(c){
  return crypto.createHash('sha256').update(c.raw).digest('hex');
}
/**
 * mode=overlap: OLD and NEXT are both accepted by Plugin.
 * mode=new-only: OLD retired; only NEXT and server and CA are monitored.
 */
export function inspectGoldMtlsExpiry({
  dir,serverName='goldabv2.lab',mode='overlap',
  renewDays=30,criticalDays=7,now=Date.now()
}={}){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||mode!=='overlap'&&mode!=='new-only'||
     !/^[a-z0-9.-]{3,253}$/.test(serverName)||
     !Number.isInteger(renewDays)||renewDays<1||renewDays>365||
     !Number.isInteger(criticalDays)||criticalDays<0||criticalDays>=renewDays||
     !Number.isFinite(now))fail('invalid_options');
  let st;
  try{st=fs.lstatSync(dir);}catch{fail('certificate_directory_missing');}
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)
    fail('insecure_directory');
  // Signer key is never an acceptable part of a runtime/watch bundle.
  try{fs.lstatSync(path.join(dir,'ca.key'));fail('signer_key_in_runtime_bundle');}
  catch(e){if(e?.code!=='ENOENT')throw e;}
  const slots=mode==='overlap'?['ca','server','old','next']:['ca','server','next'];
  const files=Object.fromEntries(slots.map(n=>[n,file(dir,n+'.crt')]));
  const certs=Object.fromEntries(slots.map(n=>[n,cert(files[n])]));
  const ca=certs.ca;
  if(!ca.ca||!ca.verify(ca.publicKey))fail('invalid_ca');
  if(!certs.server.checkHost(serverName))fail('server_identity_mismatch');
  for(const role of slots.filter(x=>x!=='ca')){
    const leaf=certs[role];
    if(!leaf.checkIssued(ca)||!leaf.verify(ca.publicKey))
      fail('invalid_signature_or_issuer');
    purpose(files.ca,files[role],role==='server'?'server':'client');
  }
  if(mode==='overlap'&&fingerprint(certs.old)===fingerprint(certs.next))
    fail('duplicate_client_pin');
  const details=[];
  let highest=0;
  for(const role of slots){
    const leaf=certs[role];
    const start=Date.parse(leaf.validFrom),end=Date.parse(leaf.validTo);
    if(!Number.isFinite(start)||!Number.isFinite(end))fail('invalid_certificate_dates');
    const daysRemaining=Math.floor((end-now)/DAY);
    let state='healthy',severity=0;
    if(start>now+300000||end<=now){state='invalid_or_expired';severity=3;}
    else if(end-now<=criticalDays*DAY){state='critical';severity=2;}
    else if(end-now<=renewDays*DAY){state='renew_soon';severity=1;}
    if(severity>highest)highest=severity;
    details.push({role,state,daysRemaining,notAfter:new Date(end).toISOString(),
      certificateSha256:fingerprint(leaf)});
  }
  const caEnd=Date.parse(ca.validTo);
  if(slots.slice(1).some(n=>Date.parse(certs[n].validTo)>caEnd))
    fail('leaf_outlives_ca');
  return Object.freeze({
    ok:highest===0,
    status:['healthy','renew_soon','critical','invalid_or_expired'][highest],
    severity:highest,mode,renewDays,criticalDays,
    serverName,certificates:details,
    privateKeysRead:false,issuerContacted:false,configurationChanged:false
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),kv={};
  let valid=args.length%2===0;
  const allowed=new Set(['--dir','--name','--mode','--renew-days','--critical-days']);
  for(let i=0;i<args.length;i+=2){
    if(!allowed.has(args[i])||args[i] in kv||!args[i+1])valid=false;
    else kv[args[i]]=args[i+1];
  }
  try{
    if(!valid)fail('usage');
    const r=inspectGoldMtlsExpiry({
      dir:kv['--dir'],serverName:kv['--name']??'goldabv2.lab',
      mode:kv['--mode']??'overlap',
      renewDays:Number(kv['--renew-days']??'30'),
      criticalDays:Number(kv['--critical-days']??'7')
    });
    process.stdout.write(JSON.stringify(r,null,2)+'\n');
    // 0 healthy, 2 renewal due, 3 critical/expired/audit failure.
    process.exitCode=r.severity===0?0:r.severity===1?2:3;
  }catch(e){
    process.stderr.write(String(e?.message?.startsWith('gold_mtls_expiry_watch_')?
      e.message:'gold_mtls_expiry_watch_blocked')+'\n');
    process.exitCode=3;
  }
}
