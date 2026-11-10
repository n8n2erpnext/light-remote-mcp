// Windows CI only: real packaged node-pty -> registry -> authenticated Wall HTTP.
// A disposable shell prints synthetic markers, exits, and never uses enrollment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {NativeTerminalRegistry} from '../../lib/native-terminal.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
assert.equal(process.platform,'win32','Run the real ConPTY proof on the Windows Actions runner');
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const installed=path.resolve(arg('--install-root')),evidence=path.resolve(arg('--evidence'));
assert.ok(fs.existsSync(path.join(installed,'agent/package.json'))||fs.existsSync(path.join(installed,'agent/VERSION')));
const require=createRequire(path.join(installed,'agent/package.json'));
const provider=require('node-pty'),root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-conpty-wall-'));
const owner={accountId:'fixture-account',deviceId:'fixture-device',sessionId:'s-fixture',agentId:'fixture-agent'};
const terminals=new NativeTerminalRegistry({ptyProvider:provider,platform:'win32'});let wall;
try{
 const shell=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 const t=terminals.start({...owner,shellSpec:{file:shell,args:['-NoLogo','-NoProfile'],shell:'powershell'},cwd:root,
  env:{PSModulePath:path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/Modules')},cols:120,rows:32});
 terminals.input(t.terminalId,owner,{data:"Write-Output 'LR_WALL_CONPTY_NATIVE'; Write-Output 'LR_UNICODE_đã_xong'; exit 0\r"});
 const began=Date.now();
 while(!terminals.view(t.terminalId,owner).finishedAt&&Date.now()-began<15000)await new Promise(r=>setTimeout(r,100));
 const terminal=terminals.view(t.terminalId,owner);assert.ok(terminal.finishedAt,'isolated PowerShell must exit');assert.ok(terminal.exitEvidence==='onExit'&&terminal.exitCode===0||terminal.exitEvidence==='pid_disappeared'&&terminal.exitCode===null,'missing ConPTY callback keeps exit code unknown');
 wall=startLocalWall({host:'127.0.0.1',port:0,modules:null,
  auth:{enabled:true,identity:req=>req.headers['x-fixture-owner']==='yes'?{username:'fixture@example.invalid'}:null,csrfForRequest:()=> 'fixture-csrf'},
  getLocalStatus:async()=>({deviceName:'Fixture',cloudDesiredConnected:false,cloudState:'dormant'}),
  getLocalTerminals:async()=>terminals.list(owner),
  readLocalTerminal:async(id,opts)=>terminals.output(id,owner,opts)});
 if(!wall.server.listening)await new Promise(r=>wall.server.once('listening',r));
 const base='http://127.0.0.1:'+wall.server.address().port,headers={'x-fixture-owner':'yes'};
 assert.equal((await fetch(base+'/api/pty/sessions')).status,401);
 const list=await (await fetch(base+'/api/pty/sessions',{headers})).json();assert.equal(list.terminals[0].cols,120);assert.equal(list.terminals[0].rows,32);
 const res=await fetch(base+'/api/pty/output?terminalId='+t.terminalId+'&offset=0',{headers});assert.equal(res.status,200);
 const data=await res.json(),output=data.terminal.output;
 const plain=output.text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
 assert.ok(plain.split(/\r?\n/).some(line=>line.trim()==='LR_WALL_CONPTY_NATIVE'),'marker must be executed output, not just typed shell input');
 assert.ok(plain.includes('LR_UNICODE_đã_xong'));assert.equal(output.nextOffset,output.totalBytes);
 const eof=await (await fetch(base+'/api/pty/output?terminalId='+t.terminalId+'&offset='+output.nextOffset,{headers})).json();assert.equal(eof.terminal.output.text,'');
 fs.writeFileSync(evidence,JSON.stringify({result:'PASS',sourceCommit:process.env.GITHUB_SHA,checks:['real-packaged-conpty','powershell-ended-with-verified-exit-evidence','owner-only-http-read','producer-grid120x32','executed-output-not-input-echo','unicode-output','monotonic-byte-offset-eof'],outputBytes:output.totalBytes,exitEvidence:terminal.exitEvidence,exitCode:terminal.exitCode,physicalOwnerAcceptance:false},null,2)+'\n');
 console.log('WINDOWS_REAL_CONPTY_LOCAL_WALL_OUTPUT_PASS');
}finally{await wall?.close();terminals.close();fs.rmSync(root,{recursive:true,force:true});}
