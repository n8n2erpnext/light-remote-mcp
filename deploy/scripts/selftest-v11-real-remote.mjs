import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeDesktopBridge, realRemoteAvailable, realRemoteEnabled } from '../../lib/native-desktop.mjs';
import { withRealRemoteCapabilities, defaultRealRemoteDenied, realRemotePolicyAfterSave } from '../../lib/real-remote-policy.mjs';
import realRemoteInputPolicy from '../../lib/real-remote-input.cjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const {normalizeDesktopInput}=realRemoteInputPolicy;
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
      : request.op==='frame'
        ? {protocolVersion:1,helperPid:process.pid,mime:'image/jpeg',encoding:'base64',width:320,height:180,bytes:4,data:'AQIDBA=='}
        : request.op==='input'
          ? {protocolVersion:1,helperPid:process.pid,appliedEvents:request.args.events.length,sentInputs:2}
          : {helperPid:process.pid,echo:request};
  process.stdout.write(JSON.stringify({id:request.id,ok:true,result})+'\\n');
}
`);

assert.equal(realRemoteEnabled({LIGHT_REMOTE_REAL_REMOTE:'1'}),true);
assert.equal(realRemoteEnabled({LIGHT_REMOTE_REAL_REMOTE:'false'}),false);
assert.equal(realRemoteAvailable({platform:'win32',env:{LIGHT_REMOTE_REAL_REMOTE:'1',LIGHT_REMOTE_CLIENT_EXE:fake},exists:fs.existsSync}),true);
assert.equal(realRemoteAvailable({platform:'linux',env:{LIGHT_REMOTE_REAL_REMOTE:'1',LIGHT_REMOTE_CLIENT_EXE:fake},exists:fs.existsSync}),false);

const discovered=withRealRemoteCapabilities(['filesystem','terminal'],{available:true});
assert.deepEqual(discovered,['desktop','desktop-input','filesystem','terminal']);
assert.deepEqual(defaultRealRemoteDenied({discovered,denied:[],inputDecision:null}),['desktop-input'],'desktop-input must be locally denied by default');
assert.deepEqual(defaultRealRemoteDenied({discovered,denied:['terminal'],inputDecision:null}),['desktop-input','terminal']);
assert.deepEqual(defaultRealRemoteDenied({discovered,denied:['desktop-input','terminal'],inputDecision:'allow'}),['terminal'],'explicit owner allow must survive reenroll');
const allowedPolicy=realRemotePolicyAfterSave({deniedCapabilities:[]},{grantable:discovered,allowed:['desktop','desktop-input','filesystem','terminal']});
assert.equal(allowedPolicy.realRemoteInputDecision,'allow');
const deniedPolicy=realRemotePolicyAfterSave({deniedCapabilities:['desktop-input']},{grantable:discovered,allowed:['desktop','filesystem','terminal']});
assert.equal(deniedPolicy.realRemoteInputDecision,'deny');
assert.deepEqual(defaultRealRemoteDenied({discovered,denied:deniedPolicy.deniedCapabilities,inputDecision:deniedPolicy.realRemoteInputDecision}),['desktop-input']);

const normalizedInput=normalizeDesktopInput({events:[
  {type:'move',x:120,y:80},
  {type:'click',button:'left',count:1},
  {type:'wheel',delta:-120},
  {type:'text',text:'Light Remote'},
  {type:'key',key:'ENTER',modifiers:['CTRL']}
]});
assert.equal(normalizedInput.events.length,5);
assert.deepEqual(normalizedInput.events[4],{type:'key',key:'ENTER',modifiers:['CTRL']});
assert.throws(()=>normalizeDesktopInput({events:[{type:'move'}]}),/desktop_input_coordinates_required/);
assert.throws(()=>normalizeDesktopInput({events:[{type:'key',key:'RAW_SCANCODE'}]}),/desktop_input_invalid_key/);
assert.throws(()=>normalizeDesktopInput({events:Array.from({length:65},()=>({type:'click'}))}),/desktop_input_invalid_event_count/);


const bridge=new NativeDesktopBridge({command:process.execPath,args:[fake],timeoutMs:1000});
try{
  const status=await bridge.request('status');
  const windows=await bridge.request('windows',{limit:10});
  const frame=await bridge.request('frame',{maxWidth:320,maxHeight:180,quality:40});
  const input=await bridge.request('input',normalizedInput);
  assert.equal(status.protocolVersion,1);
  assert.equal(status.interactive,true);
  assert.equal(windows.count,1);
  assert.equal(windows.windows[0].title,'Fake Window');
  assert.equal(frame.mime,'image/jpeg');
  assert.equal(frame.encoding,'base64');
  assert.equal(frame.data,'AQIDBA==');
  assert.equal(frame.width,320);
  assert.equal(frame.height,180);
  assert.equal(status.helperPid,windows.helperPid,'desktop helper must stay persistent across requests');
  assert.equal(status.helperPid,frame.helperPid,'desktop frame must use the same persistent helper');
  assert.equal(input.appliedEvents,5);
  assert.equal(status.helperPid,input.helperPid,'desktop input must use the same persistent helper');
  await assert.rejects(()=>bridge.request('fail'),/fake_failure/);
  await assert.rejects(()=>bridge.request('hang',{}, {timeoutMs:250}),/real_remote_helper_timeout/);
}finally{
  bridge.close();
  fs.rmSync(tmp,{recursive:true,force:true});
}

const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const core=JSON.parse(read('client/core-files.json'));
assert.ok(core.files.some(row=>row.source==='lib/native-desktop.mjs'&&row.destination==='lib/native-desktop.mjs'),'native desktop bridge not packaged');
assert.ok(core.files.some(row=>row.source==='lib/real-remote-policy.mjs')&&core.files.some(row=>row.source==='lib/real-remote-input.cjs'),'Real Remote policy/input runtime not packaged');

const program=read('client/windows-native/GptOperator.Client/Program.cs');
const helper=read('client/windows-native/GptOperator.Client/RealRemoteHelper.cs');
const inputHelper=read('client/windows-native/GptOperator.Client/RealRemoteInput.cs');
const supervisor=read('client/windows-native/GptOperator.Client/AgentSupervisor.cs');
const host=read('client/windows-native/GptOperator.Client/AgentHost.cs');
assert.ok(program.includes('--real-remote-helper')&&program.includes('RealRemoteHelper.Run()'),'Windows app hidden helper mode missing');
for(const token of ['EnumWindows','GetForegroundWindow','GetCursorPos','Screen.AllScreens','CopyFromScreen','ImageFormat.Jpeg','desktop_frame_too_large','Console.OpenStandardInput','Console.OpenStandardOutput'])assert.ok(helper.includes(token),`Windows helper contract missing: ${token}`);
assert.ok(helper.includes('"input" => Input(args)'),'Windows hidden helper input opcode missing');
for(const token of ['SendInput(','SetCursorPos(','desktop_input_blocked','desktop_input_invalid_event_count','Keyboard(ushort vk,ushort scan,uint flags)'])assert.ok(inputHelper.includes(token),`Windows input contract missing: ${token}`);
assert.ok(!inputHelper.includes('mouse_event('),'legacy mouse_event must not be used');
assert.ok(!read('lib/real-remote-input.cjs').includes("type==='raw'"),'raw arbitrary INPUT packets must not be exposed');
for(const source of [supervisor,host]){
  assert.ok(source.includes('LIGHT_REMOTE_CLIENT_EXE'),'Windows Agent launcher does not expose native client helper path');
  assert.ok(source.includes('LIGHT_REMOTE_REAL_REMOTE'),'Windows Agent launcher does not enable feature branch capability');
}

const agent=read('device-agent/operator-agent.mjs');
assert.ok(agent.includes("import { NativeDesktopBridge, realRemoteAvailable } from '../lib/native-desktop.mjs'"));
assert.ok(agent.includes("withRealRemoteCapabilities(PLATFORM_ADAPTER.discoverCapabilities(),{available:REAL_REMOTE_AVAILABLE})"));
assert.ok(agent.includes("p.type==='desktop'"));
assert.ok(agent.includes("NATIVE_DESKTOP.request('status'"));
assert.ok(agent.includes("NATIVE_DESKTOP.request('windows'"));
assert.ok(agent.includes("NATIVE_DESKTOP.request('frame'"));
assert.ok(agent.includes("NATIVE_DESKTOP.request('input'")&&agent.includes("local capability denied: desktop-input"));

const executor=read('operator-host/executor.mjs');
const routes=read('operator-host/executor-routes-runtime.mjs');
const api=read('api/operator.js');
const toolHelper=read('lib/plus-tool-helper.js');
const wall=read('device-agent/local-wall.mjs');
const windowsWorkflow=read('.github/workflows/windows-native-client.yml');
assert.ok(executor.includes('async function startDesktopOperation(')&&executor.includes("payload:{type:'desktop'")&&executor.includes("op==='input'?['desktop','desktop-input']:['desktop']"));
assert.ok(routes.includes("'desktop'].includes(payload.action)")&&routes.includes("payload.action==='desktop'?await startDesktopOperation"));
assert.ok(api.includes("action.startsWith('desktop-')")&&api.includes("'status','windows','frame','input'")&&api.includes("normalizeDesktopInput")&&api.includes("action:'desktop'"));
assert.ok(toolHelper.includes("desktop-status")&&toolHelper.includes("desktop-windows")&&toolHelper.includes("desktop-frame")&&toolHelper.includes("desktop-input")&&toolHelper.includes("capabilities:['desktop','desktop-input']"));
assert.ok(wall.includes("'desktop':['Desktop view'")&&wall.includes("'desktop-input':['Desktop input'")&&wall.includes("locally blocked by default"));
assert.ok(windowsWorkflow.includes('- name: Real Remote hidden helper smoke')&&windowsWorkflow.includes('timeout-minutes: 1')&&windowsWorkflow.includes('--real-remote-helper')&&windowsWorkflow.includes('windows-real-remote-helper=PASS')&&windowsWorkflow.includes('windows-real-remote-input-negative=PASS'));

console.log('v11-real-remote-jsonl-bridge=PASS');
console.log('v11-real-remote-same-app-windows-helper=PASS');
console.log('v11-real-remote-readonly-routing=PASS');
console.log('v11-real-remote-frame-visual-proof=PASS');
console.log('v11-real-remote-input-default-deny=PASS');
console.log('v11-real-remote-bounded-input=PASS');
