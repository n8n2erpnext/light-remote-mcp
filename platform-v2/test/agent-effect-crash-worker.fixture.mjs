/**
 * Private rc.50 UAT helper: simulate a kill -9 Agent crash around native spawn.
 * Deliberately NOT invoked by real Agent services. All paths and credentials
 * are supplied by the disposable test. The OS child uses a unique argv marker.
 */
import fs from 'node:fs';
import path from 'node:path';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';
import {DevAgentEffectInventory} from '../portability/dev-agent-effect-inventory.mjs';
import {startDevTrackedAgentEffect} from '../portability/dev-effect-pre-spawn-gate.mjs';

const [stateFile,markerFile,configFile,mode]=process.argv.slice(2);
if(!['before-link','after-link'].includes(mode))throw Error('invalid_uat_crash_point');
const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
const {effectId,intent,token,cwd}=config;
if(!stateFile||!markerFile||!cwd||!token.startsWith('lr_rc50_orphan_'))
  throw Error('invalid_uat_crash_fixture');
const inventory=new DevAgentEffectInventory({file:stateFile});
const registry=new NativeProcessRegistry();
const nativeStart={...intent.owner,script:'DEV_ORPHAN_OWNED_TEST_ONLY',
  cwd,spawnSpec:()=>({file:process.execPath,
    args:['-e','setTimeout(()=>process.exit(0),12000);setInterval(()=>{},1000)','--',token]})};
let processInfo;
if(mode==='after-link'){
  // This branch uses the actual nonproduction pre-spawn ordering gate.
  processInfo=startDevTrackedAgentEffect({inventory,registry,
    intent:{...intent,effectId},nativeStart}).native;
}else{
  // Fault injected in the narrow post-spawn/pre-link gap.
  inventory.arm({...intent,effectId});
  processInfo=registry.start(nativeStart);
}
if(!Number.isSafeInteger(processInfo.pid)||processInfo.pid<=0)
  throw Error('uat_child_spawn_failed');
// The marker is ONLY a parent-test cleanup hint; not valid Agent evidence.
const fd=fs.openSync(markerFile,fs.constants.O_CREAT|fs.constants.O_EXCL|
  fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
try{
  const data=JSON.stringify({pid:processInfo.pid,
    handleId:processInfo.processId,token,mode})+'\n';
  fs.writeSync(fd,data);fs.fsyncSync(fd);
}finally{fs.closeSync(fd);}
const parent=fs.openSync(path.dirname(markerFile),
  fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
// No graceful Node teardown (the purpose is to lose the in-RAM registry).
process.kill(process.pid,'SIGKILL');
throw Error('uat_crash_was_not_delivered');
