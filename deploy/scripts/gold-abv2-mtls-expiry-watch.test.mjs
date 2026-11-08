import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectGoldMtlsExpiry} from './gold-abv2-mtls-expiry-watch.mjs';

const DAY=86_400_000;
const here=path.dirname(fileURLToPath(import.meta.url));
const cli=path.join(here,'gold-abv2-mtls-expiry-watch.mjs');
function openssl(...args){
  execFileSync('openssl',args,{stdio:'ignore',timeout:30000});
}
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-mtls-expiry-'));
  const signer=path.join(root,'signer'),dir=path.join(root,'runtime');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(signer,{mode:0o700});
  fs.mkdirSync(dir,{mode:0o700});
  openssl('req','-x509','-newkey','rsa:3072','-nodes','-days','180','-sha256',
    '-subj','/CN=Offline CA','-out',path.join(signer,'ca.crt'),
    '-keyout',path.join(signer,'ca.key'));
  fs.copyFileSync(path.join(signer,'ca.crt'),path.join(dir,'ca.crt'));
  const make=(name)=>{
    const subject=name==='server'?'goldabv2.lab':name+'-client';
    openssl('req','-new','-newkey','rsa:3072','-nodes',
      '-subj','/CN='+subject,'-keyout',path.join(signer,name+'.key'),
      '-out',path.join(signer,name+'.csr'));
    const ext=name==='server'?
      'extendedKeyUsage=serverAuth\nsubjectAltName=DNS:goldabv2.lab\n':
      'extendedKeyUsage=clientAuth\n';
    fs.writeFileSync(path.join(signer,name+'.ext'),ext);
    openssl('x509','-req','-in',path.join(signer,name+'.csr'),
      '-CA',path.join(signer,'ca.crt'),'-CAkey',path.join(signer,'ca.key'),
      '-CAcreateserial','-days','90','-sha256',
      '-extfile',path.join(signer,name+'.ext'),'-out',path.join(dir,name+'.crt'));
  };
  for(const n of ['server','old','next'])make(n);
  return {root,signer,dir,cert:n=>path.join(dir,n+'.crt')};
}
test('T04b8 renewal watch: X509 metadata-only alert and fail-closed policy',async t=>{
  const f=fixture(t);
  const base={dir:f.dir,serverName:'goldabv2.lab'};
  const normal=inspectGoldMtlsExpiry(base);
  await t.test('valid public-cert-only overlap; no keys read',()=>{
    assert.equal(normal.ok,true);
    assert.equal(normal.status,'healthy');
    assert.equal(normal.privateKeysRead,false);
    assert.equal(normal.issuerContacted,false);
    assert.equal(normal.configurationChanged,false);
    assert.deepEqual(normal.certificates.map(x=>x.role),['ca','server','old','next']);
    assert.notEqual(normal.certificates[2].certificateSha256,
      normal.certificates[3].certificateSha256);
    assert.equal(fs.existsSync(path.join(f.dir,'old.key')),false);
  });
  await t.test('30-day warning with only public cert metadata',()=>{
    const date=Date.parse(normal.certificates.find(x=>x.role==='server').notAfter);
    const r=inspectGoldMtlsExpiry({...base,now:date-29*DAY});
    assert.equal(r.status,'renew_soon');
    assert.equal(r.severity,1);
    assert.equal(r.ok,false);
  });
  await t.test('7-day critical alert before expiration',()=>{
    const end=Date.parse(normal.certificates.find(x=>x.role==='server').notAfter);
    const r=inspectGoldMtlsExpiry({...base,now:end-6*DAY});
    assert.equal(r.status,'critical');
    assert.equal(r.severity,2);
  });
  await t.test('expired cert reports invalid without attempting to renew',()=>{
    const end=Math.max(...normal.certificates.map(x=>Date.parse(x.notAfter)));
    const r=inspectGoldMtlsExpiry({...base,now:end+DAY});
    assert.equal(r.status,'invalid_or_expired');
    assert.equal(r.severity,3);
    assert.equal(r.issuerContacted,false);
  });
  await t.test('new-only mode ignores retired OLD and monitors NEXT pin',()=>{
    const p=f.cert('old'),backup=p+'.retired';
    fs.renameSync(p,backup);
    try{
      const r=inspectGoldMtlsExpiry({...base,mode:'new-only'});
      assert.equal(r.status,'healthy');
      assert.deepEqual(r.certificates.map(x=>x.role),['ca','server','next']);
      assert.throws(()=>inspectGoldMtlsExpiry(base),/certificate_missing/);
    }finally{fs.renameSync(backup,p);}
  });
  await t.test('duplicate old/next pin blocks overlap',()=>{
    const original=fs.readFileSync(f.cert('next'));
    try{
      fs.copyFileSync(f.cert('old'),f.cert('next'));
      assert.throws(()=>inspectGoldMtlsExpiry(base),/duplicate_client_pin/);
    }finally{fs.writeFileSync(f.cert('next'),original);}
  });
  await t.test('wrong server hostname denied',()=>{
    assert.throws(()=>inspectGoldMtlsExpiry({...base,serverName:'malicious.invalid'}),
      /server_identity_mismatch/);
  });
  await t.test('signing CA private key forbidden in monitored runtime bundle',()=>{
    fs.copyFileSync(path.join(f.signer,'ca.key'),path.join(f.dir,'ca.key'));
    try{assert.throws(()=>inspectGoldMtlsExpiry(base),/signer_key_in_runtime_bundle/);}
    finally{fs.rmSync(path.join(f.dir,'ca.key'));}
  });
  await t.test('tampered certificate rejected before reporting healthy',()=>{
    const c=f.cert('next'),orig=fs.readFileSync(c);
    try{
      fs.writeFileSync(c,'not a certificate');
      assert.throws(()=>inspectGoldMtlsExpiry(base),/invalid_certificate/);
    }finally{fs.writeFileSync(c,orig);}
  });
  await t.test('wrong EKU is denied',()=>{
    const c=f.cert('next'),orig=fs.readFileSync(c);
    try{
      fs.copyFileSync(f.cert('server'),c);
      assert.throws(()=>inspectGoldMtlsExpiry({...base,mode:'new-only'}),
        /invalid_client_purpose_or_chain/);
    }finally{fs.writeFileSync(c,orig);}
  });
  await t.test('symlink cert and insecure directory denied',()=>{
    const p=f.cert('next');
    fs.renameSync(p,p+'.bak');
    fs.symlinkSync('next.crt.bak',p);
    try{assert.throws(()=>inspectGoldMtlsExpiry(base),/invalid_certificate_file/);}
    finally{fs.unlinkSync(p);fs.renameSync(p+'.bak',p);}
    fs.chmodSync(f.dir,0o755);
    try{assert.throws(()=>inspectGoldMtlsExpiry(base),/insecure_directory/);}
    finally{fs.chmodSync(f.dir,0o700);}
  });
  await t.test('CLI exit0 on healthy certificate bundle, JSON hides private paths',()=>{
    const result=spawnSync(process.execPath,[cli,'--dir',f.dir,
      '--mode','overlap'],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr);
    const obj=JSON.parse(result.stdout);
    assert.equal(obj.status,'healthy');
    assert.equal(result.stdout.includes(f.dir),false);
    assert.equal(result.stdout.includes('PRIVATE KEY'),false);
  });
  await t.test('invalid option or unsupported mode returns blocked exit3',()=>{
    const result=spawnSync(process.execPath,[cli,'--dir',f.dir,
      '--mode','skip-verification'],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,3);
    assert.equal(result.stdout,'');
  });
});
