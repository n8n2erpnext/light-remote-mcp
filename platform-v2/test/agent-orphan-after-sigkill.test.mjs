import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {durableAtomicWriteSync} from '../../lib/durable-atomic-file.mjs';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';
import {DevAgentEffectInventory,inspectDevAgentEffectInventory}
  from '../portability/dev-agent-effect-inventory.mjs';
import {signDevAgentLifetimeObservation}
  from '../portability/dev-agent-lifetime-observation.mjs';

const fixture=fileURLToPath(new URL('./agent-effect-crash-worker.fixture.mjs',import.meta.url));
const owner={accountId:'uat_owner',deviceId:'uat_device',sessionId:'uat_session',
  agentId:'uat_agent'};
const JS_MARK='setTimeout(()=>process.exit(0),12000);setInterval(()=>{},1000)';
function childStillOurs(pid,token){
  if(process.platform!=='linux'||!Number.isSafeInteger(pid)||pid<=0)return false;
  try{
    const cmdline=fs.readFileSync('/proc/'+pid+'/cmdline','utf8');
    const parts=cmdline.split(String.fromCharCode(0)).filter(Boolean);
    return parts[0]===process.execPath&&
      parts.includes(JS_MARK)&&parts.includes(token);
  }catch{return false;}
}
for(const mode of ['before-link','after-link']){
  test('SIGKILL UAT Agent '+mode+' retains uncertain durable effect while real OS child survives',
    {timeout:15000,skip:process.platform!=='linux'?'Linux /proc isolated UAT only':false},()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-agent-orphan-'));
    const stateFile=path.join(root,'inventory.json');
    const markerFile=path.join(root,'pid-cleanup-hint.json');
    const configFile=path.join(root,'config.json');
    const token='lr_rc50_orphan_'+crypto.randomBytes(18).toString('hex');
    const effectId='eff_crash_'+mode.replace('-','_')+'_'+crypto.randomBytes(8).toString('hex');
    const now=Date.now();
    const intent={owner,commandId:'cmd_crash_'+crypto.randomBytes(12).toString('hex'),
      nodeId:'uat_node',kind:'process',writerGeneration:42,
      bootId:crypto.randomBytes(24).toString('base64url')};
    let pid=null;
    try{
      durableAtomicWriteSync(stateFile,
        JSON.stringify({schemaVersion:1,entries:[]})+'\n',{mode:0o600});
      fs.writeFileSync(configFile,JSON.stringify({effectId,intent,token,cwd:root}),
        {mode:0o600});
      const worker=spawnSync(process.execPath,[fixture,stateFile,markerFile,configFile,mode],
        {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:6500,cwd:root});
      assert.equal(worker.signal,'SIGKILL',
        'test worker must have been hard-killed without graceful shutdown: '+
        (worker.stderr||'').slice(-900));
      assert.equal(fs.existsSync(markerFile),true,
        'only isolated worker was permitted to create PID cleanup marker');
      const marker=JSON.parse(fs.readFileSync(markerFile,'utf8'));
      pid=marker.pid;
      assert.equal(marker.mode,mode);
      assert.equal(marker.token,token);
      assert.ok(childStillOurs(pid,token),
        'after real worker SIGKILL, independently running OS child must still exist');
      const snapshot=inspectDevAgentEffectInventory({file:stateFile});
      assert.equal(snapshot.unresolved,1);
      assert.equal(snapshot.ownerLockPresent,true);
      assert.equal(snapshot.blocked,true);
      assert.equal(snapshot.settlementAuthorized,false);
      assert.equal(snapshot.entries[0].commandId,intent.commandId);
      assert.equal(snapshot.entries[0].writerGeneration,intent.writerGeneration);
      assert.equal(snapshot.entries[0].bootId,intent.bootId);
      assert.equal(snapshot.entries[0].stage,mode==='before-link'?'intent':'spawned');
      if(mode==='before-link'){
        assert.equal(snapshot.entries[0].osPid,null,
          'PID can be alive yet durable inventory only knows unresolved intent');
      }else{
        assert.equal(snapshot.entries[0].osPid,pid);
        assert.equal(snapshot.entries[0].handleId,marker.handleId);
      }
      assert.throws(()=>new DevAgentEffectInventory({file:stateFile}),
        /UNRESOLVED_STARTUP_REFUSED/,
        'new Agent must NOT take over a file with an uncertain live effect');
      const regeneratedRegistry=new NativeProcessRegistry();
      const keys=crypto.generateKeyPairSync('ed25519');
      assert.throws(()=>signDevAgentLifetimeObservation({
        registry:regeneratedRegistry,kind:'process',handleId:marker.handleId,
        owner,commandId:intent.commandId,nodeId:intent.nodeId,
        writerGeneration:intent.writerGeneration,bootId:intent.bootId,
        challenge:crypto.randomBytes(24).toString('base64url'),
        privateKey:keys.privateKey
      }),/HANDLE_UNOBSERVED/,
      'a new Agent empty registry cannot assert that orphaned child has exited');
      assert.ok(childStillOurs(pid,token),
        'denied replacement Agent must NOT disrupt still-running UAT effect');
    }finally{
      if(childStillOurs(pid,token)){
        // Safe cleanup: kill ONLY process with unique arg marker generated
        // for this individual fixture, never a process found by PID alone.
        try{process.kill(pid,'SIGKILL');}catch{}
      }
      fs.rmSync(root,{recursive:true,force:true});
    }
  });
}
