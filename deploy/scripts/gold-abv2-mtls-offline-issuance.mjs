/**
 * T04b8-A2 — split owner-side CA signing from runtime-key CSR generation.
 * No trusted CA key is generated, exported, or installed by this module.
 * Signing is an explicit local-owner operation with a separate offline CA.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const fail=(reason)=>{throw new Error('mtls_offline_issuance_'+reason);};
const DATE_MARGIN=86_400_000;
const ALLOWED_ROLES=new Set(['server','client']);
const checkRole=(role)=>{if(!ALLOWED_ROLES.has(role))fail('invalid_role');};
function checkName(role,name){
  if(typeof name!=='string'||name.length>100||
     !/^[a-zA-Z0-9.-]{3,100}$/.test(name)||
     name.includes('..')||name.startsWith('-')||name.endsWith('.'))fail('invalid_name');
  if(role==='server'&&!/^[a-z0-9.-]+$/.test(name))fail('server_name_invalid');
}
function directory(dir){
  if(typeof dir!=='string'||!path.isAbsolute(dir))fail('invalid_directory');
  let st;
  try{st=fs.lstatSync(dir);}catch{fail('directory_missing');}
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)
    fail('insecure_directory');
}
function regular(file,priv=false){
  let st;
  try{st=fs.lstatSync(file);}catch{fail('missing_input');}
  if(!st.isFile()||st.isSymbolicLink()||st.size<20||st.size>131072||
     (priv&&(st.mode&0o077)!==0))fail('invalid_input_file');
}
function run(args){
  try{return execFileSync('openssl',args,{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:20000,maxBuffer:131072});}
  catch{fail('openssl_operation_failed');}
}
function nextFile(dir,name){
  const f=path.join(dir,name);
  if(fs.existsSync(f))fail('output_exists');
  return f;
}
function safeRemove(file){try{fs.rmSync(file,{force:true});}catch{}}
function assertCsr(csr,role,name){
  regular(csr);
  run(['req','-in',csr,'-noout','-verify']);
  const result=run(['req','-in',csr,'-noout','-subject','-nameopt','RFC2253']).trim();
  // Only simple canonical CNs are accepted, never copy CSR requested extensions.
  if(result!=='subject=CN='+name)fail('csr_subject_mismatch');
  const pkey=crypto.createPublicKey(run(['req','-in',csr,'-noout','-pubkey']));
  if(pkey.asymmetricKeyType!=='rsa'||
     (pkey.asymmetricKeyDetails?.modulusLength??0)<3072)
    fail('csr_key_too_weak');
  checkName(role,name);
}
function validateCA(dir){
  directory(dir);
  const cert=path.join(dir,'ca.crt');
  const key=path.join(dir,'ca.key');
  regular(cert);
  regular(key,true);
  let ca;
  try{
    ca=new crypto.X509Certificate(fs.readFileSync(cert));
    if(!ca.ca||!ca.verify(ca.publicKey)||
       !ca.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(key))))
      fail('invalid_signing_ca');
  }catch{fail('invalid_signing_ca');}
  if(Date.parse(ca.validFrom)>Date.now()||
     Date.parse(ca.validTo)<=Date.now()+DATE_MARGIN)
    fail('signing_ca_expired_or_near_expiry');
  return {cert,key,ca};
}
export function createGoldMtlsCsr({dir,role,name}={}){
  checkRole(role);checkName(role,name);directory(dir);
  const key=nextFile(dir,name+'.key');
  const csr=nextFile(dir,name+'.csr');
  // CSR and private key belong only to the runtime identity owner.
  try{
    run(['req','-new','-newkey','rsa:3072','-sha256','-nodes',
      '-subj','/CN='+name,'-keyout',key,'-out',csr]);
    fs.chmodSync(key,0o600);fs.chmodSync(csr,0o600);
    assertCsr(csr,role,name);
    return {ok:true,operation:'csr_created',role,name,
      csrCreated:true,privateKeyCreated:true,caSigningKeyRead:false};
  }catch(err){safeRemove(csr);safeRemove(key);throw err;}
}
export function signGoldMtlsCsrOffline({
  csr,caDir,out,role,name,days=90
}={}){
  checkRole(role);checkName(role,name);
  if(!Number.isSafeInteger(days)||days<1||days>90)fail('invalid_validity');
  if(typeof csr!=='string'||typeof out!=='string'||
     !path.isAbsolute(csr)||!path.isAbsolute(out))fail('invalid_paths');
  const ca=validateCA(caDir);
  directory(path.dirname(out));
  nextFile(path.dirname(out),path.basename(out));
  assertCsr(csr,role,name);
  const ext=path.join(path.dirname(out),'.mtls-ext-'+crypto.randomBytes(10).toString('hex')+'.cnf');
  if(Date.parse(ca.ca.validTo)-Date.now()<days*DATE_MARGIN)
    fail('ca_expires_before_requested_leaf');
  const extension=role==='server'?
    'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:'+name+'\n':
    'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n';
  try{
    fs.writeFileSync(ext,extension,{encoding:'utf8',mode:0o600,flag:'wx'});
    run(['x509','-req','-in',csr,'-CA',ca.cert,'-CAkey',ca.key,
      '-set_serial','0x'+crypto.randomBytes(16).toString('hex'),
      '-days',String(days),'-sha256','-extfile',ext,'-out',out]);
    fs.chmodSync(out,0o600);
    const leaf=new crypto.X509Certificate(fs.readFileSync(out));
    if(!leaf.checkIssued(ca.ca)||!leaf.verify(ca.ca.publicKey)||
       (role==='server'&&!leaf.checkHost(name))||
       Date.parse(leaf.validTo)>Date.parse(ca.ca.validTo))
      fail('invalid_signed_leaf');
    run(['verify','-CAfile',ca.cert,'-purpose',
      role==='server'?'sslserver':'sslclient',out]);
    const digest=crypto.createHash('sha256').update(leaf.raw).digest('hex');
    return {ok:true,operation:'offline_certificate_signed',
      role,name,days,certificateSha256:digest,expires:leaf.validTo,
      privateKeyEmitted:false,runtimeInstalled:false};
  }catch(err){safeRemove(out);throw err;}
  finally{safeRemove(ext);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2);
  const cmd=args.shift();
  const allow=cmd==='request'?['--dir','--role','--name']:
    cmd==='sign'?['--csr','--ca-dir','--out','--role','--name','--days']:[];
  const values={};
  let valid=allow.length>0&&args.length%2===0;
  for(let i=0;i<args.length;i+=2){
    if(!allow.includes(args[i])||args[i] in values)valid=false;
    else values[args[i]]=args[i+1];
  }
  try{
    if(!valid)fail('usage');
    const common={role:values['--role'],name:values['--name']};
    const result=cmd==='request'?
      createGoldMtlsCsr({...common,dir:values['--dir']}):
      signGoldMtlsCsrOffline({...common,csr:values['--csr'],
        caDir:values['--ca-dir'],out:values['--out'],
        days:values['--days']===undefined?90:Number(values['--days'])});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(err){
    process.stderr.write(String(err?.message?.startsWith('mtls_offline_issuance_')?
      err.message:'mtls_offline_issuance_blocked')+'\n');
    process.exitCode=3;
  }
}
