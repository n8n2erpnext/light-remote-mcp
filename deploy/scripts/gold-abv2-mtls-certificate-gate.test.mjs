import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {auditGoldMtlsCertificateBundle} from './gold-abv2-mtls-certificate-gate.mjs';

function run(...args){
  execFileSync('openssl',args,{stdio:'ignore',timeout:15000});
}
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-mtls-gate-'));
  const signer=path.join(root,'offline-signer');
  const dir=path.join(root,'runtime-bundle');
  fs.mkdirSync(signer,{mode:0o700});
  fs.mkdirSync(dir,{mode:0o700});
  const sign=(n)=>path.join(signer,n);
  const file=(n)=>path.join(dir,n);
  run('req','-x509','-newkey','rsa:2048','-nodes','-days','180',
    '-subj','/CN=Offline Lab CA','-keyout',sign('ca.key'),'-out',sign('ca.crt'));
  fs.copyFileSync(sign('ca.crt'),file('ca.crt'));
  for(const name of ['server','old','next']){
    run('req','-newkey','rsa:2048','-nodes','-subj','/CN=Gold Lab '+name,
      '-keyout',file(name+'.key'),'-out',file(name+'.csr'));
    fs.chmodSync(file(name+'.key'),0o600);
    fs.writeFileSync(file(name+'.ext'),
      name==='server'?
      'subjectAltName=DNS:goldabv2.lab\nextendedKeyUsage=serverAuth\n':
      'extendedKeyUsage=clientAuth\n');
    run('x509','-req','-in',file(name+'.csr'),
      '-CA',sign('ca.crt'),'-CAkey',sign('ca.key'),'-CAcreateserial',
      '-days','90','-sha256','-extfile',file(name+'.ext'),
      '-out',file(name+'.crt'));
  }
  return {root,signer,dir,file};
}
function error(fn,pattern){assert.throws(fn,pattern);}
test('T04b8 mTLS bundle gate: offline CA, exact old and next identities and renew checks',async(t)=>{
  const f=fixture();
  t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
  const valid=()=>auditGoldMtlsCertificateBundle({dir:f.dir,serverName:'goldabv2.lab',minRemainingDays:30});
  await t.test('valid offline signing, CA/key/identity chain: safe SHA only',()=>{
    const result=valid();
    assert.equal(result.ok,true);
    assert.equal(result.caPrivateKeyRead,false);
    assert.equal(result.configurationChanged,false);
    assert.equal(result.oldClientSha256.length,64);
    assert.equal(result.nextClientSha256.length,64);
    assert.notEqual(result.oldClientSha256,result.nextClientSha256);
    assert.equal(fs.existsSync(f.file('ca.key')),false);
  });
  await t.test('renewal warning blocks certificates with insufficient remaining validity',()=>{
    error(()=>auditGoldMtlsCertificateBundle({dir:f.dir,minRemainingDays:100}),
      /invalid_or_expiring_/);
  });
  await t.test('wrong server SAN cannot be shipped',()=>{
    error(()=>auditGoldMtlsCertificateBundle({dir:f.dir,serverName:'evil.invalid'}),
      /server_identity_mismatch/);
  });
  await t.test('mismatched private key is rejected without emitting PEM',()=>{
    const orig=fs.readFileSync(f.file('server.key'));
    try{
      fs.copyFileSync(f.file('old.key'),f.file('server.key'));
      error(valid,/mismatched_private_key_server/);
    }finally{fs.writeFileSync(f.file('server.key'),orig,{mode:0o600});}
  });
  await t.test('symlink private key is rejected, even if pointing inside same directory',()=>{
    const p=f.file('next.key');
    fs.renameSync(p,f.file('next.key.bak'));
    fs.symlinkSync('next.key.bak',p);
    try{error(valid,/invalid_file/);}
    finally{fs.unlinkSync(p);fs.renameSync(f.file('next.key.bak'),p);}
  });
  await t.test('insecure key file permissions rejected',()=>{
    const p=f.file('next.key');
    fs.chmodSync(p,0o644);
    try{error(valid,/insecure_private_key_permissions/);}
    finally{fs.chmodSync(p,0o600);}
  });
  await t.test('CA signing key in runtime bundle is always rejected',()=>{
    fs.copyFileSync(path.join(f.signer,'ca.key'),f.file('ca.key'));
    try{error(valid,/signing_ca_private_key_in_runtime_bundle/);}
    finally{fs.rmSync(f.file('ca.key'));}
  });
  await t.test('wrong EKU clientAuth (server cert reused as client) denied',()=>{
    const origC=fs.readFileSync(f.file('next.crt'));
    const origK=fs.readFileSync(f.file('next.key'));
    try{
      fs.copyFileSync(f.file('server.crt'),f.file('next.crt'));
      fs.copyFileSync(f.file('server.key'),f.file('next.key'));
      error(valid,/invalid_purpose_or_chain_next/);
    }finally{
      fs.writeFileSync(f.file('next.crt'),origC);
      fs.writeFileSync(f.file('next.key'),origK,{mode:0o600});
    }
  });
  await t.test('duplicate old and next fingerprints are forbidden',()=>{
    const origC=fs.readFileSync(f.file('next.crt'));
    const origK=fs.readFileSync(f.file('next.key'));
    try{
      fs.copyFileSync(f.file('old.crt'),f.file('next.crt'));
      fs.copyFileSync(f.file('old.key'),f.file('next.key'));
      error(valid,/duplicate_rotation_identity/);
    }finally{
      fs.writeFileSync(f.file('next.crt'),origC);
      fs.writeFileSync(f.file('next.key'),origK,{mode:0o600});
    }
  });
  await t.test('wrong CA signature is rejected',()=>{
    const orig=fs.readFileSync(f.file('ca.crt'));
    try{
      fs.copyFileSync(f.file('server.crt'),f.file('ca.crt'));
      error(valid,/invalid_ca/);
    }finally{fs.writeFileSync(f.file('ca.crt'),orig);}
  });
});
