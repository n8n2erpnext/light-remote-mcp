import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyF16Installer} from './f16-owner-uat-artifact-preflight.mjs';
const SRC='a'.repeat(40);
const sha=b=>createHash('sha256').update(b).digest('hex');
const script=fileURLToPath(new URL('./f16-owner-uat-artifact-preflight.mjs',import.meta.url));
const sample=()=>{
 const out=Buffer.alloc(1024,0);
 out.write('MZ',0,'ascii');out.writeUInt32LE(128,0x3c);
 Buffer.from([0x50,0x45,0,0]).copy(out,128);
 out.write('TEST_SYNTHETIC_WINDOWS_PE_NO_REAL_INSTALLER',260);
 return out;
};
async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'lr-f16-intake-'));
 t.after(async()=>{await rm(dir,{recursive:true,force:true})});
 const installer=path.join(dir,'Light-Remote-MCP-Setup-x64.exe');
 const checksums=path.join(dir,'SHA256SUMS.txt');
 const data=sample();
 await writeFile(installer,data);
 await writeFile(checksums,sha(data)+'  Light-Remote-MCP-Setup-x64.exe\n');
 return {dir,installer,checksums,data,args:{installer,checksums,sourceSha:SRC}};
}
test('F16 accepts only exact single complete setup + checksum; never claims B or signing',async(t)=>{
 const f=await fixture(t);
 const before=[(await stat(f.installer)).mtimeMs,(await stat(f.checksums)).mtimeMs];
 const r=await verifyF16Installer(f.args);
 assert.deepEqual([r.installerName,r.installerBytes,r.installerSha256],
  ['Light-Remote-MCP-Setup-x64.exe',1024,sha(f.data)]);
 assert.equal(r.sourceShaDeclared,SRC);
 for(const k of ['sourceShaCryptographicallyProven','authenticodeSignatureVerified',
  'publisherIdentityVerified','ownerBApproved','existingInstallationBackedUp',
  'updateFeedActivated','physicalWindowsAccepted'])assert.equal(r[k],false);
 assert.equal(r.readOnly,true);
 assert.equal(r.disposition,'artifact_integrity_only_not_physical_acceptance');
 assert.ok(!JSON.stringify(r).includes(f.dir),"do not leak machine path");
 assert.deepEqual([(await stat(f.installer)).mtimeMs,(await stat(f.checksums)).mtimeMs],before);
});
test('F16 refuses mismatched checksums, not merely format of the sidecar',async(t)=>{
 const f=await fixture(t);
 await writeFile(f.installer,Buffer.concat([f.data,Buffer.from('tampered')]));
 await assert.rejects(verifyF16Installer(f.args),/checksum_mismatch/);
});
test('F16 refuses arbitrary files and malformed PE even if checksum matches',async(t)=>{
 const f=await fixture(t);
 const invalid=Buffer.alloc(1024,0x41);
 await writeFile(f.installer,invalid);
 await writeFile(f.checksums,sha(invalid)+'  Light-Remote-MCP-Setup-x64.exe\n');
 await assert.rejects(verifyF16Installer(f.args),/pe_dos_header_invalid/);
});
test('F16 rejects inconsistent, duplicate or unrelated checksum lines',async(t)=>{
 const f=await fixture(t);
 for(const value of [
  sha(f.data)+'  Light-Remote-MCP-Setup-x64.exe\n'+sha(f.data)+'  Light-Remote-MCP-Setup-x64.exe\n',
  sha(f.data)+'  Light-Remote-MCP-Compact-Setup-x64.exe\n',
  sha(f.data).toUpperCase()+'  Light-Remote-MCP-Setup-x64.exe\n',
  sha(f.data)+' *Light-Remote-MCP-Setup-x64.exe\n'
 ]){
  await writeFile(f.checksums,value);
  await assert.rejects(verifyF16Installer(f.args),/checksum_/);
 }
});
test('F16 exact declared source SHA and same installer sidecar directory are mandatory',async(t)=>{
 const f=await fixture(t);
 for(const x of ['unknown','b'.repeat(41),'a'.repeat(39),'AA'.repeat(20)]){
  await assert.rejects(verifyF16Installer({...f.args,sourceSha:x}),/source_sha_invalid/);
 }
 await mkdir(path.join(f.dir,'other'));
 const second=path.join(f.dir,'other','SHA256SUMS.txt');
 await writeFile(second,sha(f.data)+'  Light-Remote-MCP-Setup-x64.exe\n');
 await assert.rejects(verifyF16Installer({...f.args,checksums:second}),/directory_mismatch/);
});
test('F16 CLI takes only the three explicit read-only inputs, emits no paths and has no install switch',async(t)=>{
 const f=await fixture(t);
 const cmd=(args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
 const good=cmd(['--installer',f.installer,'--checksums',f.checksums,'--source-sha',SRC]);
 assert.equal(good.status,0,good.stderr);
 assert.equal(JSON.parse(good.stdout).physicalWindowsAccepted,false);
 assert.equal(JSON.parse(good.stdout).installerSha256,sha(f.data));
 const bad=cmd(['--installer',f.installer,'--checksums',f.checksums,'--install',SRC]);
 assert.equal(bad.status,1);
 assert.match(bad.stderr,/f16_intake_arguments_invalid/);
 assert.ok(!bad.stderr.includes(f.dir));
});
test('F16 symlinked setup is rejected rather than trusting a redirected file',async(t)=>{
 if(process.platform==='win32')return t.skip('Windows unprivileged symlink creation not guaranteed');
 const f=await fixture(t);
 const physical=path.join(f.dir,'real-setup.exe');
 await writeFile(physical,f.data);
 await rm(f.installer);
 await symlink(physical,f.installer);
 await assert.rejects(verifyF16Installer(f.args),/file_type_invalid/);
});
