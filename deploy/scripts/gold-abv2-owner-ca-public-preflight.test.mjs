import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectOwnerGoldCaPublic} from './gold-abv2-owner-ca-public-preflight.mjs';

const script=fileURLToPath(new URL('./gold-abv2-owner-ca-public-preflight.mjs',import.meta.url));
const DAY=86400000;
function buildCa(t,{bits=4096,subject='LightRemote-GoldABV2-Owner-CA-CANDIDATE',
  isCa=true,pathLen='0',withSigning=true}={}){
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'gold-owner-ca-public-'));
  t.after(()=>fs.rmSync(d,{recursive:true,force:true}));
  const key=path.join(d,'signer-only.key');
  const pub=path.join(d,'owner-ca-public.crt');
  const args=['req','-x509','-newkey','rsa:'+bits,'-nodes','-days','90',
    '-sha256','-subj','/CN='+subject,
    '-addext',isCa?'basicConstraints=critical,CA:TRUE,pathlen:'+pathLen:
      'basicConstraints=critical,CA:FALSE',
    '-addext',withSigning?'keyUsage=critical,keyCertSign,cRLSign':
      'keyUsage=critical,digitalSignature',
    '-keyout',key,'-out',pub];
  execFileSync('openssl',args,{stdio:'ignore',timeout:35000});
  const c=new crypto.X509Certificate(fs.readFileSync(pub));
  return {d,pub,key,pin:crypto.createHash('sha256').update(c.raw).digest('hex'),
    ca:c};
}
test('T04b8 Owner Windows CA public gate: public certificate alone NEVER authorizes cutover',async t=>{
  const f=buildCa(t);
  const inspect=(overrides={})=>inspectOwnerGoldCaPublic({
    caFile:f.pub,expectedCaSha256:f.pin,...overrides
  });
  await t.test('valid separately pinned public root is verified, but release HOLD',()=>{
    const result=inspect();
    assert.equal(result.publicCaVerified,true);
    assert.equal(result.releaseApproved,false);
    assert.equal(result.releaseStatus,'HOLD');
    assert.equal(result.caDerSha256,f.pin);
    assert.equal(result.pendingReleaseGates.length,4);
    assert.equal(result.privateKeyRead,false);
    assert.equal(result.trustStoreChanged,false);
    assert.equal(result.publicRouterChanged,false);
  });
  await t.test('missing owner-independent trust SHA256 pin rejected',()=>{
    assert.throws(()=>inspectOwnerGoldCaPublic({caFile:f.pub}),
      /arguments_invalid/);
  });
  await t.test('different pinned public CA certificate rejected',()=>{
    assert.throws(()=>inspect({expectedCaSha256:'0'.repeat(64)}),
      /independent_ca_fingerprint_mismatch/);
  });
  await t.test('wrong expected Owner identity rejected',()=>{
    assert.throws(()=>inspect({expectedSubject:'CN=UnrelatedCA'}),
      /unexpected_ca_subject/);
  });
  await t.test('expiry within 30 days rejected and release stays blocked',()=>{
    const end=Date.parse(f.ca.validTo);
    assert.throws(()=>inspect({now:end-15*DAY}),/invalid_ca_validity/);
  });
  await t.test('not-yet-valid time rejected',()=>{
    const start=Date.parse(f.ca.validFrom);
    assert.throws(()=>inspect({now:start-2*DAY}),/invalid_ca_validity/);
  });
  await t.test('tampered public PEM rejected',()=>{
    const orig=fs.readFileSync(f.pub);
    try{
      fs.writeFileSync(f.pub,'not-valid-public-x509');
      assert.throws(inspect,/invalid_public_ca_file/);
    }finally{fs.writeFileSync(f.pub,orig);}
  });
  await t.test('symlink to public certificate rejected',()=>{
    const link=path.join(f.d,'linked-ca.pem');
    fs.symlinkSync(f.pub,link);
    assert.throws(()=>inspect({caFile:link}),/invalid_public_ca_file/);
  });
  await t.test('CLI exit 2 for correct public identity, NOT release approval',()=>{
    const r=spawnSync(process.execPath,[script,'--ca-file',f.pub,
      '--pin',f.pin],{encoding:'utf8',timeout:15000});
    assert.equal(r.status,2,r.stderr);
    assert.equal(JSON.parse(r.stdout).releaseApproved,false);
    assert.equal(r.stdout.includes(f.d),false);
  });
  await t.test('CLI invalid arguments fail with exit 3 without public disclosure',()=>{
    const r=spawnSync(process.execPath,[script,'--ca-file',f.pub],
      {encoding:'utf8',timeout:15000});
    assert.equal(r.status,3);
    assert.equal(r.stdout,'');
  });
});
test('T04b8 CA profile rejects weak RSA 3072 and incorrect signing constraints',async t=>{
  const weak=buildCa(t,{bits:3072});
  assert.throws(()=>inspectOwnerGoldCaPublic({
    caFile:weak.pub,expectedCaSha256:weak.pin
  }),/unexpected_ca_key_type_or_size/);
  const noSign=buildCa(t,{withSigning:false});
  assert.throws(()=>inspectOwnerGoldCaPublic({
    caFile:noSign.pub,expectedCaSha256:noSign.pin
  }),/(ca_signing_usage_missing|not_trusted_self_signed_root)/);
  const wrongPath=buildCa(t,{pathLen:'1'});
  assert.throws(()=>inspectOwnerGoldCaPublic({
    caFile:wrongPath.pub,expectedCaSha256:wrongPath.pin
  }),/invalid_ca_constraints/);
  const nonCa=buildCa(t,{isCa:false});
  assert.throws(()=>inspectOwnerGoldCaPublic({
    caFile:nonCa.pub,expectedCaSha256:nonCa.pin
  }),/not_trusted_self_signed_root/);
});
