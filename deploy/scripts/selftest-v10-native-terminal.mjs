import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { NativeTerminalRegistry } from '../../lib/native-terminal.mjs';
import { createLinuxAdapter } from '../../device-agent/platform-adapters/linux.mjs';
import { createWindowsAdapter } from '../../device-agent/platform-adapters/windows.mjs';
import { createMacOSAdapter } from '../../device-agent/platform-adapters/macos.mjs';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForOutput(registry,terminalId,owner,{offset=0,patterns=[],timeoutMs=2500}={}){
  const deadline=Date.now()+timeoutMs;let out=null;
  do{out=registry.output(terminalId,owner,{offset,limit:65536});if(patterns.every(pattern=>pattern.test(out.output.text)))return out;await wait(25);}while(Date.now()<deadline);
  throw new Error(`terminal_output_timeout:${out?.output?.text||''}`);
}
const owner={accountId:'acct-term',deviceId:'dev-term',sessionId:'session-term-0001',agentId:'agent-term-0001'};
const linux=createLinuxAdapter({commandExists:name=>['bash','sh','git','node'].includes(name)});
assert.ok(linux.discoverCapabilities().includes('terminal'));
assert.deepEqual(linux.terminalFor({shell:'bash'}),{file:'/bin/bash',args:['-l'],shell:'bash'});
const reg=new NativeTerminalRegistry({maxTerminals:3,bufferBytes:65536});
const started=reg.start({...owner,shellSpec:linux.terminalFor({shell:'bash'}),cwd:'/tmp',cols:80,rows:24});
assert.match(started.terminalId,/^ltm_/);
reg.input(started.terminalId,owner,{data:"printf 'LR_TERM_OK\\n'; stty size; sleep 30\n"});
let out=await waitForOutput(reg,started.terminalId,owner,{patterns:[/LR_TERM_OK/,/24 80/]});
assert.match(out.output.text,/LR_TERM_OK/);
assert.match(out.output.text,/24 80/);
reg.resize(started.terminalId,owner,{cols:100,rows:30});
reg.signal(started.terminalId,owner,{signal:'interrupt'});
reg.input(started.terminalId,owner,{data:"stty size; printf 'AFTER_INT\\n'\n"});
out=await waitForOutput(reg,started.terminalId,owner,{offset:out.output.nextOffset,patterns:[/30 100/,/AFTER_INT/]});
assert.match(out.output.text,/30 100/);
assert.match(out.output.text,/AFTER_INT/);
assert.throws(()=>reg.output(started.terminalId,{...owner,agentId:'agent-other-0001'}),/terminal_owner_mismatch/);
reg.stop(started.terminalId,owner,{force:true});
await wait(120);
assert.notEqual(reg.view(started.terminalId,owner).state,'running');
reg.close();

let fakeChild=null;
const lostExitProvider={spawn(){fakeChild=spawn('/bin/sh',['-c','sleep 30'],{stdio:'ignore'});return {pid:fakeChild.pid,write(){},resize(){},onData(){},onExit(){},kill(signal){if(signal==='SIGTERM')return;process.kill(fakeChild.pid,signal||'SIGKILL');}};}};
const lostExitReg=new NativeTerminalRegistry({ptyProvider:lostExitProvider,platform:'linux',stopGraceMs:80});
const lost=lostExitReg.start({...owner,shellSpec:{file:'/bin/sh',args:[],shell:'sh'},cwd:'/tmp'});
lostExitReg.stop(lost.terminalId,owner,{force:false});
assert.equal(lostExitReg.view(lost.terminalId,owner).state,'stopping');
await wait(180);
const stopped=lostExitReg.view(lost.terminalId,owner);
assert.equal(stopped.state,'finished');
assert.ok(stopped.finishedAt);
lostExitReg.close();

const win=createWindowsAdapter({commandExists:name=>['pwsh','cmd.exe','git','node'].includes(name)});
assert.ok(win.discoverCapabilities().includes('terminal'));
assert.equal(win.terminalFor({shell:'powershell'}).shell,'powershell');
assert.equal(win.terminalFor({shell:'cmd'}).shell,'cmd');
const mac=createMacOSAdapter({commandExists:name=>['zsh','bash','sh','git','node'].includes(name)});
assert.ok(mac.discoverCapabilities().includes('terminal'));
assert.deepEqual(mac.terminalFor({shell:'zsh'}),{file:'/bin/zsh',args:['-l'],shell:'zsh'});
console.log('v10-native-terminal-pty-resize-signal=PASS');
console.log('v10-native-terminal-owner-isolation=PASS');
console.log('v10-native-terminal-bounded-stop=PASS');
console.log('v10-terminal-cross-platform-shells=PASS');
