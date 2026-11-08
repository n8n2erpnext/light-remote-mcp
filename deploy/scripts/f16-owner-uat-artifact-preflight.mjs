// T11-F16: offline, READ-ONLY integrity intake for the unified Windows installer.
// No install/launch, update, endpoint contact, account read, B approval, or state mutation.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,open,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const INSTALLER='Light-Remote-MCP-Setup-x64.exe';
const SUMS='SHA256SUMS.txt';
const DIGEST=/^[a-f0-9]{64}$/;
const SHA=/^[a-f0-9]{40}$/;
function fail(code){throw Error('f16_intake_'+code);}
async function fileInfo(target,expectedName){
 if(typeof target!=='string'||!path.isAbsolute(target)||
    path.basename(target)!==expectedName)fail('path_invalid');
 const st=await lstat(target).catch(()=>fail('file_missing'));
 if(!st.isFile()||st.isSymbolicLink())fail('file_type_invalid');
 const resolved=await realpath(target);
 // Windows realpath may return extended-length or short-name aliases for
 // an ordinary file; spelling equality with path.resolve is NOT a safe Win32
 // symlink test. lstat above rejects a symlinked *file* on both platforms.
 // Keep strict resolved equality on POSIX, and compare resolved directories
 // for the EXE+sidecar pair below on all platforms.
 if(process.platform!=='win32'&&resolved!==path.resolve(target))
  fail('redirected_path');
 return {size:st.size,path:resolved};
}
async function verifyPe(target,size){
 if(size<512)fail('pe_too_small');
 const fd=await open(target,'r');
 try{
  const dos=Buffer.alloc(64);
  if((await fd.read(dos,0,64,0)).bytesRead!==64||dos.toString('ascii',0,2)!=='MZ')
   fail('pe_dos_header_invalid');
  const offset=dos.readUInt32LE(0x3c);
  if(offset<64||offset>size-4||offset>1024*1024)fail('pe_offset_invalid');
  const pe=Buffer.alloc(4);
  if((await fd.read(pe,0,4,offset)).bytesRead!==4||
     !pe.equals(Buffer.from([0x50,0x45,0,0])))
   fail('pe_signature_invalid');
 }finally{await fd.close();}
}
async function hashFile(target){
 const h=createHash('sha256');
 for await(const chunk of createReadStream(target))h.update(chunk);
 return h.digest('hex');
}
export async function verifyF16Installer({installer,checksums,sourceSha}={}){
 if(!SHA.test(String(sourceSha||'')))fail('source_sha_invalid');
 const exe=await fileInfo(installer,INSTALLER);
 const sums=await fileInfo(checksums,SUMS);
 if(path.dirname(exe.path)!==path.dirname(sums.path))fail('directory_mismatch');
 if(!Number.isSafeInteger(exe.size)||exe.size<512||exe.size>4*1024**3||
    !Number.isSafeInteger(sums.size)||sums.size<64||sums.size>256)
  fail('size_invalid');
 const data=await readFile(sums.path,'utf8');
 const lines=data.trimEnd().split(/\r?\n/);
 if(lines.length!==1)fail('checksum_lines_invalid');
 const match=/^([a-f0-9]{64})  Light-Remote-MCP-Setup-x64\.exe$/.exec(lines[0]);
 if(!match||!DIGEST.test(match[1]))fail('checksum_format_invalid');
 await verifyPe(exe.path,exe.size);
 const actual=await hashFile(exe.path);
 if(actual!==match[1])fail('checksum_mismatch');
 return Object.freeze({
  schema:'light-remote-f16-offline-intake-v1',
  disposition:'artifact_integrity_only_not_physical_acceptance',
  sourceShaDeclared:sourceSha,
  sourceShaCryptographicallyProven:false,
  installerName:INSTALLER,
  installerBytes:exe.size,
  installerSha256:actual,
  checksumsName:SUMS,
  checksumsSha256:await hashFile(sums.path),
  peHeader:'MZ/PE',
  readOnly:true,
  authenticodeSignatureVerified:false,
  publisherIdentityVerified:false,
  ownerBApproved:false,
  existingInstallationBackedUp:false,
  updateFeedActivated:false,
  physicalWindowsAccepted:false
 });
}
function args(argv){
 const accepted=new Set(['--installer','--checksums','--source-sha']);
 const parsed={};
 if(argv.length!==6)fail('arguments_invalid');
 for(let i=0;i<argv.length;i+=2){
  if(!accepted.has(argv[i])||typeof argv[i+1]!=='string'||
     Object.hasOwn(parsed,argv[i]))fail('arguments_invalid');
  parsed[argv[i]]=argv[i+1];
 }
 if(Object.keys(parsed).length!==3)fail('arguments_invalid');
 return {installer:parsed['--installer'],checksums:parsed['--checksums'],
  sourceSha:parsed['--source-sha']};
}
const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 try{
  const result=await verifyF16Installer(args(process.argv.slice(2)));
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(e){
  // Never echo operator paths, environment variables, package profile or secrets.
  process.stderr.write((/^f16_intake_[a-z_]+$/.test(e?.message||'')?
    e.message:'f16_intake_unavailable')+'\n');
  process.exitCode=1;
 }
}
