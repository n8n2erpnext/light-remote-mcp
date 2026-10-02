import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('package_root_required');
const mod=await import(pathToFileURL(path.join(root,'lib','native-terminal.mjs')).href);
const { NativeTerminalRegistry }=mod;
const owner={accountId:'ci-account',deviceId:'ci-device',sessionId:'ci-session-0001',agentId:'ci-agent-0001'};
const registry=new NativeTerminalRegistry({maxTerminals:2});
let shellSpec,command;
if(process.platform==='win32'){
  shellSpec={file:'powershell.exe',args:['-NoLogo','-NoProfile'],shell:'powershell'};
  command="Write-Output 'LIGHT_REMOTE_PTY_OK'\r\n";
}else{
  const file=process.platform==='darwin'?'/bin/zsh':'/bin/bash';
  shellSpec={file,args:['-l'],shell:path.basename(file)};
  command="printf 'LIGHT_REMOTE_PTY_OK\\n'\n";
}
const terminal=registry.start({...owner,shellSpec,cwd:process.cwd(),cols:90,rows:28});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let offset=0,text='',lastState='running',nextSendAt=0;
const deadline=Date.now()+(process.platform==='win32'?15000:6000);
try{
  while(Date.now()<deadline&&!text.includes('LIGHT_REMOTE_PTY_OK')){
    const now=Date.now();
    if(now>=nextSendAt){
      registry.input(terminal.terminalId,owner,{data:command});
      nextSendAt=now+(process.platform==='win32'?800:2000);
    }
    const out=registry.output(terminal.terminalId,owner,{offset,limit:65536});
    text+=out.output.text;offset=out.output.nextOffset;lastState=out.state;
    if(text.includes('LIGHT_REMOTE_PTY_OK'))break;
    await sleep(100);
  }
  if(!text.includes('LIGHT_REMOTE_PTY_OK'))throw new Error('terminal_runtime_smoke_output_missing:state='+lastState+':output='+JSON.stringify(text));
  console.log('terminal-runtime-smoke=PASS platform='+process.platform+' arch='+process.arch);
} finally {
  try{registry.stop(terminal.terminalId,owner,{force:true});}catch{}
  registry.close();
}
