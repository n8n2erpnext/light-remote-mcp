import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeDesktopBridge, realRemoteAvailable, realRemoteEnabled } from '../../lib/native-desktop.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-real-remote-'));
const fake=path.join(tmp,'fake-helper.mjs');
fs.writeFileSync(fake,`
import readline from 'node:readline';
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
for await (const line of rl){
  if(!line.trim())continue;
  const request=JSON.parse(line);
  if(request.op==='hang')continue;
  if(request.op==='fail'){process.stdout.write(JSON.stringify({id:request.id,ok:false,error:'fake_failure'})+'\\n');continue;}
  const result=request.op==='status'
    ? {protocolVersion:1,interactive:true,helperPid:process.pid,screens:[{name:'fake-screen'}]}
    : request.op==='windows'
      ? {protocolVersion:1,helperPid:process.pid,count:1,windows:[{title:'Fake Window'}]}
      : {helperPid:process.pid,echo:request};
  process.stdout.write(JSON.stringify({id:request.id,ok:true,result})+'\\n');
}
`);

assert.equal(realRemoteEnabled({LIGHT_REMOTE_REAL_REMOTE:'1'}),true);
assert.equal(realRemoteEnabled({LIGHT_REMOTE_REAL_REMOTE:'false'}),false);
assert.equal(realRemoteAvailable({platform:'win32',env:{LIGHT_REMOTE_REAL_REMOTE:'1',LIGHT_REMOTE_CLIENT_EXE:fake},exists:fs.existsSync}),true);
assert.equal(realRemoteAvailable({platform:'linux',env:{LIGHT_REMOTE_REAL_REMOTE:'1',LIGHT_REMOTE_CLIENT_EXE:fake},exists:fs.existsSync}),false);

const bridge=new NativeDesktopBridge({command:process.execPath,args:[fake],timeoutMs:1000});
try{
  const status=await bridge.request('status');
  const windows=await bridge.request('windows',{limit:10});
  assert.equal(status.protocolVersion,1);
  assert.equal(status.interactive,true);
  assert.equal(windows.count,1);
  assert.equal(windows.windows[0].title,'Fake Window');
  assert.equal(status.helperPid,windows.helperPid,'desktop helper must stay persistent across requests');
  await assert.rejects(()=>bridge.request('fail'),/fake_failure/);
  await assert.rejects(()=>bridge.request('hang',{}, {timeoutMs:250}),/real_remote_helper_timeout/);
}finally{
  bridge.close();
  fs.rmSync(tmp,{recursive:true,force:true});
}

const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const core=JSON.parse(read('client/core-files.json'));
assert.ok(core.files.some(row=>row.source==='lib/native-desktop.mjs'&&row.destination==='lib/native-desktop.mjs'),'native desktop bridge not packaged');

const program=read('client/windows-native/GptOperator.Client/Program.cs');
const helper=read('client/windows-native/GptOperator.Client/RealRemoteHelper.cs');
const supervisor=read('client/windows-native/GptOperator.Client/AgentSupervisor.cs');
const host=read('client/windows-native/GptOperator.Client/AgentHost.cs');
assert.ok(program.includes('--real-remote-helper')&&program.includes('RealRemoteHelper.Run()'),'Windows app hidden helper mode missing');
for(const token of ['EnumWindows','GetForegroundWindow','GetCursorPos','Screen.AllScreens','Console.OpenStandardInput','Console.OpenStandardOutput'])assert.ok(helper.includes(token),`Windows helper contract missing: ${token}`);
for(const source of [supervisor,host]){
  assert.ok(source.includes('LIGHT_REMOTE_CLIENT_EXE'),'Windows Agent launcher does not expose native client helper path');
  assert.ok(source.includes('LIGHT_REMOTE_REAL_REMOTE'),'Windows Agent launcher does not enable feature branch capability');
}

const agent=read('device-agent/operator-agent.mjs');
assert.ok(agent.includes("import { NativeDesktopBridge, realRemoteAvailable } from '../lib/native-desktop.mjs'"));
assert.ok(agent.includes("caps.push('desktop')"));
assert.ok(agent.includes("p.type==='desktop'"));
assert.ok(agent.includes("NATIVE_DESKTOP.request('status'"));
assert.ok(agent.includes("NATIVE_DESKTOP.request('windows'"));

const executor=read('operator-host/executor.mjs');
const routes=read('operator-host/executor-routes-runtime.mjs');
const api=read('api/operator.js');
const toolHelper=read('lib/plus-tool-helper.js');
assert.ok(executor.includes('async function startDesktopOperation(')&&executor.includes("payload:{type:'desktop'"));
assert.ok(routes.includes("'desktop'].includes(payload.action)")&&routes.includes("payload.action==='desktop'?await startDesktopOperation"));
assert.ok(api.includes("action.startsWith('desktop-')")&&api.includes("action:'desktop'"));
assert.ok(toolHelper.includes("desktop-status")&&toolHelper.includes("desktop-windows")&&toolHelper.includes("capability:'desktop'"));

console.log('v11-real-remote-jsonl-bridge=PASS');
console.log('v11-real-remote-same-app-windows-helper=PASS');
console.log('v11-real-remote-readonly-routing=PASS');
