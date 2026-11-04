import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {auditGoldMtlsCertificateBundle} from './gold-abv2-mtls-certificate-gate.mjs';
import {createGoldMtlsCsr,signGoldMtlsCsrOffline} from './gold-abv2-mtls-offline-issuance.mjs';

function fixture(t){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gold-mtls-issuer-'));
  t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const dirs={};
  for(const n of ['signer','req','runtime']){
    dirs[n]=path.join(tmp,n);fs.mkdirSync(dirs[n],{mode:0o700});
  }
  const cert=path.join(dirs.signer,'ca.crt'),key=path.join(dirs.signer,'ca.key');
  execFileSync('openssl',['req','-x509','-newkey','rsa:3072','-nodes',
    '-days','180','-sha256','-subj','/CN=Offline Test Signing CA',
    '-keyout',key,'-out',cert],{stdio:'ignore',timeout:30000});
  fs.chmodSync(key,0o600);
  fs.copyFileSync(cert,path.join(dirs.runtime,'ca.crt'));
  return dirs;
}
function issue(f,role,name,destName){
  const csr=createGoldMtlsCsr({dir:f.req,role,name});
  assert.equal(csr.caSigningKeyRead,false);
  const output=path.join(f.runtime,destName+'.crt');
  const result=signGoldMtlsCsrOffline({
    csr:path.join(f.req,name+'.csr'),caDir:f.signer,out:output,
    role,name,days:90
  });
  fs.copyFileSync(path.join(f.req,name+'.key'),
    path.join(f.runtime,destName+'.key'));
  fs.chmodSync(path.join(f.runtime,destName+'.key'),0o600);
  assert.equal(result.privateKeyEmitted,false);
  assert.equal(result.runtimeInstalled,false);
  return result;
}
test('T04b8 issuer: offline CSR split and no-signing-key runtime acceptance',async t=>{
  const f=fixture(t);
  await t.test('three roles and distinct old/next pins pass existing certificate gate',()=>{
    issue(f,'server','goldabv2.lab','server');
    const old=issue(f,'client','GoldLab-old-client','old');
    const next=issue(f,'client','GoldLab-next-client','next');
    assert.notEqual(old.certificateSha256,next.certificateSha256);
    const audited=auditGoldMtlsCertificateBundle({
      dir:f.runtime,serverName:'goldabv2.lab',minRemainingDays:30
    });
    assert.equal(audited.ok,true);
    assert.equal(audited.oldClientSha256,old.certificateSha256);
    assert.equal(audited.nextClientSha256,next.certificateSha256);
    assert.equal(fs.existsSync(path.join(f.runtime,'ca.key')),false);
  });
  await t.test('CSRs cannot overwrite existing key or CSR',()=>{
    assert.throws(()=>createGoldMtlsCsr({
      dir:f.req,role:'client',name:'GoldLab-old-client'
    }),/output_exists/);
  });
  await t.test('untrusted CSR CN cannot be relabelled as a different service',()=>{
    assert.throws(()=>signGoldMtlsCsrOffline({
      csr:path.join(f.req,'GoldLab-old-client.csr'),caDir:f.signer,
      out:path.join(f.runtime,'forged.crt'),
      role:'server',name:'goldabv2.lab',days:90
    }),/csr_subject_mismatch/);
    assert.equal(fs.existsSync(path.join(f.runtime,'forged.crt')),false);
  });
  await t.test('requested duration >90d denied before signing',()=>{
    assert.throws(()=>signGoldMtlsCsrOffline({
      csr:path.join(f.req,'GoldLab-next-client.csr'),caDir:f.signer,
      out:path.join(f.runtime,'toolong.crt'),
      role:'client',name:'GoldLab-next-client',days:91
    }),/invalid_validity/);
  });
  await t.test('wrong CA private key cannot sign as trusted CA',()=>{
    const wrongDir=path.join(path.dirname(f.signer),'wrong-ca');
    fs.mkdirSync(wrongDir,{mode:0o700});
    fs.copyFileSync(path.join(f.signer,'ca.crt'),
      path.join(wrongDir,'ca.crt'));
    execFileSync('openssl',['genrsa','-out',path.join(wrongDir,'ca.key'),
      '3072'],{stdio:'ignore',timeout:20000});
    fs.chmodSync(path.join(wrongDir,'ca.key'),0o600);
    assert.throws(()=>signGoldMtlsCsrOffline({
      csr:path.join(f.req,'GoldLab-next-client.csr'),
      caDir:wrongDir,out:path.join(f.runtime,'badca.crt'),
      role:'client',name:'GoldLab-next-client',days:30
    }),/invalid_signing_ca/);
  });
  await t.test('client key too weak is rejected even if CSR signature valid',()=>{
    const key=path.join(f.req,'weak.key');
    const csr=path.join(f.req,'weak.csr');
    execFileSync('openssl',['req','-new','-newkey','rsa:2048','-nodes',
      '-subj','/CN=GoldLab-weak','-keyout',key,'-out',csr],
    {stdio:'ignore',timeout:20000});
    fs.chmodSync(key,0o600);
    assert.throws(()=>signGoldMtlsCsrOffline({
      csr,caDir:f.signer,out:path.join(f.runtime,'weak.crt'),
      role:'client',name:'GoldLab-weak',days:30
    }),/csr_key_too_weak/);
  });
  await t.test('signing requires secure offline key directory',()=>{
    fs.chmodSync(f.signer,0o755);
    try{
      assert.throws(()=>signGoldMtlsCsrOffline({
        csr:path.join(f.req,'GoldLab-next-client.csr'),
        caDir:f.signer,out:path.join(f.runtime,'badperm.crt'),
        role:'client',name:'GoldLab-next-client',days:30
      }),/insecure_directory/);
    }finally{fs.chmodSync(f.signer,0o700);}
  });
  await t.test('renewal issuance new leaf is fresh and does not replace old identity',()=>{
    const renew=issue(f,'client','GoldLab-renewed','renewed');
    const old=fs.readFileSync(path.join(f.runtime,'old.crt'));
    assert.equal(renew.certificateSha256.length,64);
    assert.notEqual(renew.certificateSha256,
      auditGoldMtlsCertificateBundle({dir:f.runtime}).oldClientSha256);
    assert.deepEqual(fs.readFileSync(path.join(f.runtime,'old.crt')),old);
    assert.equal(fs.existsSync(path.join(f.runtime,'ca.key')),false);
  });
});
