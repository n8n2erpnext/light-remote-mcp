// GitHub Issue #3 — Windows FileShare.None across two separately owned
// native managed-process launches. Never uses -enc/-EncodedCommand or IEX.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWindowsAdapter} from '../../device-agent/platform-adapters/windows.mjs';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';

if(process.platform!=='win32'){
  console.log('ISSUE_3_WINDOWS_FILELOCK=SKIP_NON_WINDOWS');
  process.exit(0);
}
const owner={accountId:'issue3-gold',deviceId:'issue3-win-ci',sessionId:'issue3-owned-test',agentId:'issue3-agent'};
const registry=new NativeProcessRegistry({maxProcesses:8,stopGraceMs:150});
const root=await fsp.mkdtemp(path.join(os.tmpdir(),'lightremote-gold-issue3-'));
const fixture=path.join(root,'filelock-test.ps1'),target=path.join(root,'synthetic-exclusive.lock');
const adapter=createWindowsAdapter({commandExists:name=>name==='powershell.exe'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const powershell=`param([ValidateSet('Hold','Probe')][string]$Action,[string]$FilePath)
$ErrorActionPreference = 'Stop'
$stream = $null
try {
  try {
    $stream = [System.IO.File]::Open($FilePath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  } catch [System.IO.IOException] {
    [Console]::Out.WriteLine('ISSUE3_LOCK_DENIED_WHILE_OWNED')
    exit 73
  }
  if ($Action -eq 'Probe') {
    [Console]::Out.WriteLine('ISSUE3_LOCK_ACQUIRED_BY_PROBE')
    exit 0
  }
  [Console]::Out.WriteLine('ISSUE3_LOCK_ACQUIRED_BY_HOLDER')
  [Console]::Out.Flush()
  $command = [Console]::ReadLine()
  if ($command -ne 'release') { [Console]::Error.WriteLine('ISSUE3_UNEXPECTED_HOLDER_INPUT'); exit 78 }
  [Console]::Out.WriteLine('ISSUE3_HOLDER_NORMAL_RELEASE')
} finally {
  if ($null -ne $stream) { $stream.Dispose() }
}
`;
const started=[];
const run=(action)=>{
 const command=`& ${quote(fixture)} -Action ${action} -FilePath ${quote(target)}`;
 assert.equal(adapter.hardDeny(command),null,'plain PowerShell script must pass unchanged Windows hard-deny');
 const caps=adapter.inferRequiredCapabilities(command,{shell:'powershell'});
 assert.ok(caps.includes('filesystem')&&caps.includes('powershell'));
 const result=registry.start({...owner,cwd:root,script:command,spawnSpec:text=>adapter.commandFor(text,{shell:'powershell'}),timeoutMs:20000});
 started.push(result.processId);
 return result.processId;
};
const text=id=>registry.output(id,owner,{stream:'stdout',offset:0,limit:4096}).output.text;
const wait=async (id,predicate,label,limitMs=13000)=>{
 const end=Date.now()+limitMs;
 while(Date.now()<end){
  const row=registry.view(id,owner),output=text(id);
  if(predicate(row,output))return {row,output};
  await sleep(65);
 }
 throw Error('ISSUE3_TIMEOUT_'+label+' '+JSON.stringify(registry.view(id,owner))+' stdout='+text(id));
};
const probe=async expected=>{
 const id=run('Probe');
 const result=await wait(id,(row,out)=>row.finishedAt!==null&&(expected==='denied'?out.includes('ISSUE3_LOCK_DENIED_WHILE_OWNED'):out.includes('ISSUE3_LOCK_ACQUIRED_BY_PROBE')),'probe_'+expected);
 if(expected==='denied'){
  // powershell.exe -Command can normalize script exit 73 to process exit 1.
  // The explicit IOException sharing-violation marker plus nonzero exit is
  // the verifiable contract, not a shell-specific numeric exit code.
  assert.notEqual(result.row.exitCode,0,'sharing violation must fail');
  assert.match(result.output,/ISSUE3_LOCK_DENIED_WHILE_OWNED/);
 }else assert.equal(result.row.exitCode,0);
 return result;
};
try {
 await fsp.writeFile(fixture,powershell,{encoding:'utf8'});
 assert.equal(adapter.hardDeny('powershell.exe -EncodedCommand AAA'),'windows_encoded_powershell_denied');
 console.log('ISSUE3_ENCODED_COMMAND_HARD_DENY_UNCHANGED=PASS');
 const holder1=run('Hold');
 const a=await wait(holder1,(row,out)=>out.includes('ISSUE3_LOCK_ACQUIRED_BY_HOLDER')&&row.state==='running','holder_normal');
 assert.equal(a.row.state,'running');
 console.log('ISSUE3_A_EXCLUSIVE_FILESHARE_NONE=PASS');
 await probe('denied');
 console.log('ISSUE3_B_DENIED_WHILE_A_HOLDS_LOCK=PASS');
 registry.input(holder1,owner,{data:'release\n',eof:true});
 const released=await wait(holder1,(row,out)=>row.finishedAt!==null&&out.includes('ISSUE3_HOLDER_NORMAL_RELEASE'),'normal_release');
 assert.equal(released.row.exitCode,0);
 await probe('acquired');
 console.log('ISSUE3_NORMAL_RELEASE_AND_B_ACQUIRE=PASS');

 const holder2=run('Hold');
 await wait(holder2,(row,out)=>out.includes('ISSUE3_LOCK_ACQUIRED_BY_HOLDER')&&row.state==='running','holder_crash');
 await probe('denied');
 const stopped=registry.stop(holder2,owner,{force:true});
 assert.equal(stopped.stopRequested,true);
 const afterCrash=await wait(holder2,(row)=>row.finishedAt!==null,'holder_force_stop');
 assert.notEqual(afterCrash.row.state,'running');
 console.log('ISSUE3_TEST_OWNED_A_TERMINATED=PASS');
 await probe('acquired');
 console.log('ISSUE3_CRASH_RECOVERY_B_ACQUIRE=PASS');
} finally {
 registry.close();
 for(const id of started){try{const row=registry.view(id,owner);if(!row.finishedAt)registry.stop(id,owner,{force:true});}catch{}}
 await sleep(350);
 await fsp.rm(root,{force:true,recursive:true,maxRetries:12,retryDelay:100});
 assert.equal(fs.existsSync(root),false,'test-owned temporary staging must be removed');
 console.log('ISSUE3_ALL_SYNTHETIC_STAGING_AND_PROCESS_CLEANUP=PASS');
}
