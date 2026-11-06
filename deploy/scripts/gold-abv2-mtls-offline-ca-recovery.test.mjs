import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {backupOfflineGoldCa,restoreOfflineGoldCa}
  from './gold-abv2-mtls-offline-ca-recovery.mjs';
import {createGoldMtlsCsr,signGoldMtlsCsrOffline}
  from './gold-abv2-mtls-offline-issuance.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const cli=path.join(here,'gold-abv2-mtls-offline-ca-recovery.mjs');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-mtls-ca-recovery-'));
  const dir=n=>path.join(root,n);
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const n of ['signer','backup','restored','csr','issued'])
    fs.mkdirSync(dir(n),{mode:0o700});
  execFileSync('openssl',['req','-x509','-newkey','rsa:3072',
    '-nodes','-days','180','-sha256',
    '-subj','/CN=DISPOSABLE-OFFLINE-CA-TEST',
    '-keyout',path.join(dir('signer'),'ca.key'),
    '-out',path.join(dir('signer'),'ca.crt')],
    {stdio:'ignore',timeout:30000});
  fs.chmodSync(path.join(dir('signer'),'ca.key'),0o600);
  const pass=dir('owner-password.secret');
  fs.writeFileSync(pass,crypto.randomBytes(40).toString('hex'),{mode:0o600});
  return {root,dir,pass};
}
test('T04b8 encrypted offline CA custody backup and recovery: fail closed',async t=>{
  const f=fixture(t);
  const base={caDir:f.dir('signer'),backupDir:f.dir('backup'),passphraseFile:f.pass};
  const result=backupOfflineGoldCa(base);
  await t.test('backup is encrypted PKCS8, no plaintext CA key in backup',()=>{
    assert.equal(result.ok,true);
    const files=fs.readdirSync(f.dir('backup')).sort();
    assert.deepEqual(files,['ca-backup.json','ca.crt','ca.key.pk8']);
    assert.equal(fs.existsSync(path.join(f.dir('backup'),'ca.key')),false);
    const encrypted=fs.readFileSync(path.join(f.dir('backup'),'ca.key.pk8'),'utf8');
    assert.match(encrypted,/^-----BEGIN ENCRYPTED PRIVATE KEY-----/);
    assert.equal(encrypted.includes('BEGIN PRIVATE KEY-----\n'),false);
    assert.equal(result.keyPlaintextInBackup,false);
    assert.equal(result.productionDeployed,false);
    assert.equal(fs.statSync(path.join(f.dir('backup'),'ca.key.pk8')).mode&0o077,0);
  });
  await t.test('recovery with correct passphrase matches trusted CA identity',()=>{
    const restored=restoreOfflineGoldCa({
      backupDir:f.dir('backup'),restoreDir:f.dir('restored'),
      passphraseFile:f.pass,expectedCaSha256:result.caSha256
    });
    assert.equal(restored.ok,true);
    assert.equal(restored.caSha256,result.caSha256);
    const ca=new crypto.X509Certificate(fs.readFileSync(
      path.join(f.dir('restored'),'ca.crt')));
    const key=crypto.createPrivateKey(fs.readFileSync(
      path.join(f.dir('restored'),'ca.key')));
    assert.equal(ca.checkPrivateKey(key),true);
    assert.equal(fs.statSync(path.join(f.dir('restored'),'ca.key')).mode&0o077,0);
  });
  await t.test('restored offline signer can issue disposable leaf with explicit CSR',()=>{
    createGoldMtlsCsr({dir:f.dir('csr'),role:'client',name:'GoldLab-Recovered'});
    const leaf=signGoldMtlsCsrOffline({
      csr:path.join(f.dir('csr'),'GoldLab-Recovered.csr'),
      caDir:f.dir('restored'),
      out:path.join(f.dir('issued'),'client.crt'),
      role:'client',name:'GoldLab-Recovered',days:30
    });
    assert.equal(leaf.ok,true);
    const issued=new crypto.X509Certificate(fs.readFileSync(
      path.join(f.dir('issued'),'client.crt')));
    const ca=new crypto.X509Certificate(fs.readFileSync(
      path.join(f.dir('signer'),'ca.crt')));
    assert.equal(issued.verify(ca.publicKey),true);
    assert.equal(leaf.privateKeyEmitted,false);
  });
  await t.test('backup cannot overwrite previous encrypted archive',()=>{
    assert.throws(()=>backupOfflineGoldCa(base),/output_exists/);
  });
  await t.test('restore cannot overwrite existing signer key',()=>{
    assert.throws(()=>restoreOfflineGoldCa({
      backupDir:f.dir('backup'),restoreDir:f.dir('restored'),
      passphraseFile:f.pass,expectedCaSha256:result.caSha256
    }),/output_exists/);
  });
  await t.test('tampered encrypted backup is refused before decryption',()=>{
    const key=path.join(f.dir('backup'),'ca.key.pk8');
    const original=fs.readFileSync(key);
    const empty=f.dir('tamper-out');
    fs.mkdirSync(empty,{mode:0o700});
    try{
      const changed=Buffer.from(original);
      changed[Math.floor(changed.length/2)]=(changed[Math.floor(changed.length/2)]+1)%256;
      fs.writeFileSync(key,changed,{mode:0o600});
      assert.throws(()=>restoreOfflineGoldCa({
        backupDir:f.dir('backup'),restoreDir:empty,
        passphraseFile:f.pass,expectedCaSha256:result.caSha256
      }),/encrypted_backup_integrity_mismatch/);
      assert.deepEqual(fs.readdirSync(empty),[]);
    }finally{fs.writeFileSync(key,original,{mode:0o600});}
  });
  await t.test('wrong passphrase fails without leaving decrypted key',()=>{
    const wrong=f.dir('owner-wrong.secret');
    fs.writeFileSync(wrong,crypto.randomBytes(40).toString('hex'),{mode:0o600});
    const empty=f.dir('wrong-out');
    fs.mkdirSync(empty,{mode:0o700});
    assert.throws(()=>restoreOfflineGoldCa({
      backupDir:f.dir('backup'),restoreDir:empty,
      passphraseFile:wrong,expectedCaSha256:result.caSha256
    }),/openssl_failed/);
    assert.deepEqual(fs.readdirSync(empty),[]);
  });
  await t.test('password file symlink, weak mode or too short denied',()=>{
    const link=f.dir('passlink');
    fs.symlinkSync(f.pass,link);
    try{assert.throws(()=>backupOfflineGoldCa({...base,passphraseFile:link}),
      /unsafe_passphrase_file/);}
    finally{fs.unlinkSync(link);}
    fs.chmodSync(f.pass,0o644);
    try{assert.throws(()=>backupOfflineGoldCa(base),/unsafe_passphrase_file/);}
    finally{fs.chmodSync(f.pass,0o600);}
    const short=f.dir('short-pass');
    fs.writeFileSync(short,'weak',{mode:0o600});
    assert.throws(()=>backupOfflineGoldCa({...base,passphraseFile:short}),
      /unsafe_passphrase_file/);
  });
  await t.test('password stored inside CA or archive directory denied',()=>{
    const p=path.join(f.dir('backup'),'passphrase');
    fs.copyFileSync(f.pass,p);
    fs.chmodSync(p,0o600);
    assert.throws(()=>backupOfflineGoldCa({...base,passphraseFile:p}),
      /passphrase_must_be_independent/);
  });
  await t.test('insecure archive directory or symlink refused',()=>{
    fs.chmodSync(f.dir('backup'),0o755);
    try{assert.throws(()=>backupOfflineGoldCa(base),/unsafe_private_directory/);}
    finally{fs.chmodSync(f.dir('backup'),0o700);}
    const shortcut=f.dir('backup-link');
    fs.symlinkSync(f.dir('backup'),shortcut);
    try{assert.throws(()=>backupOfflineGoldCa({...base,backupDir:shortcut}),
      /unsafe_private_directory/);}
    finally{fs.unlinkSync(shortcut);}
  });
  await t.test('recovery requires independently trusted CA SHA-256 pin',()=>{
    const isolated=f.dir('untrusted-out');
    fs.mkdirSync(isolated,{mode:0o700});
    const opts={backupDir:f.dir('backup'),restoreDir:isolated,
      passphraseFile:f.pass};
    assert.throws(()=>restoreOfflineGoldCa(opts),
      /trusted_ca_fingerprint_required/);
    assert.throws(()=>restoreOfflineGoldCa({
      ...opts,expectedCaSha256:'0'.repeat(64)
    }),/trusted_ca_fingerprint_mismatch/);
    assert.deepEqual(fs.readdirSync(isolated),[]);
  });
  await t.test('CLI refuses unknown operation with exit3 and no output',()=>{
    const r=spawnSync(process.execPath,[cli,'auto-restore'],{
      encoding:'utf8',timeout:10000});
    assert.equal(r.status,3);
    assert.equal(r.stdout,'');
    assert.equal(r.stderr.includes(f.pass),false);
  });
});
