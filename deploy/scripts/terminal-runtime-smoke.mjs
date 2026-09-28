import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('package_root_required');
const mod=await import(pathToFileURL(path.join(root,'lib','native-terminal.mjs')).href);
const { NativeTerminalRegistry }=mod;
const owner={accountId:'ci-account',deviceId:'ci-device',sessionId:'ci-session-0001',agentId:'ci-agent-0001'};
const registry=new NativeTerminalRegistry({maxTerminals:2});
let shellSpec,input;
if(process.platform==='win32'){
  shellSpec={file:'powershell.exe',args:['-NoLogo','-NoProfile'],shell:'powershell'};
  input="Write-Output 'LIGHT_REMOTE_PTY_OK'; exit\r\n";
}else{
  const file=process.platform==='darwin'?'/bin/zsh':'/bin/bash';
  shellSpec={file,args:['-l'],shell:path.basename(file)};
  input="printf 'LIGHT_REMOTE_PTY_OK\\n'; exit\n";
}
const terminal=registry.start({...owner,shellSpec,cwd:process.cwd(),cols:90,rows:28});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(process.platform==='win32'){
  const readyDeadline=Date.now()+3000;
  while(Date.now()<readyDeadline&&!registry.view(terminal.terminalId,owner).firstOutputAt)await sleep(50);
}
registry.input(terminal.terminalId,owner,{data:input});
const deadline=Date.now()+(process.platform==='win32'?10000:5000);
let offset=0,text='',lastState='running';
while(Date.now()<deadline&&!text.includes('LIGHT_REMOTE_PTY_OK')){
  const out=registry.output(terminal.terminalId,owner,{offset,limit:65536});
  text+=out.output.text;offset=out.output.nextOffset;lastState=out.state;
  if(text.includes('LIGHT_REMOTE_PTY_OK'))break;
  await sleep(100);
}
if(!text.includes('LIGHT_REMOTE_PTY_OK'))throw new Error(`terminal_runtime_smoke_output_missing:state=${lastState}:output=${JSON.stringify(text)}`);
registry.close();
console.log(`terminal-runtime-smoke=PASS platform=${process.platform} arch=${process.arch}`);
