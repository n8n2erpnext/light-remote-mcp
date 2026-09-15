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
registry.input(terminal.terminalId,owner,{data:input});
await new Promise(resolve=>setTimeout(resolve,600));
const out=registry.output(terminal.terminalId,owner,{offset:0,limit:65536});
if(!out.output.text.includes('LIGHT_REMOTE_PTY_OK'))throw new Error(`terminal_runtime_smoke_output_missing:${JSON.stringify(out.output.text)}`);
registry.close();
console.log(`terminal-runtime-smoke=PASS platform=${process.platform} arch=${process.arch}`);
