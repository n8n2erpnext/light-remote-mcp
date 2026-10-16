import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import http from 'node:http';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {durableAtomicWriteSync} from '../../lib/durable-atomic-file.mjs';
import {DevRemoteEffectJournal} from '../../operator-host/dev-remote-effect-journal.mjs';
import {FleetRouter} from '../../operator-host/fleet-router.mjs';

const owner={accountId:'uat_owner',deviceId:'uat_device',nodeId:'uat_node'};
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-journal-'));
  const file=path.join(dir,'remote-effects.json');
  durableAtomicWriteSync(file,JSON.stringify({schemaVersion:1,pending:[]})+'\n',{mode:0o600});
  return {dir,file,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
const row=(id='cmd_uat_alpha')=>({...owner,commandId:id,jobId:'uat_job'});
test('explicitly provisioned dev write-ahead journal keeps result unresolved until owner reconciliation',()=>{
  const {file,cleanup}=fixture();
  try{
    const journal=new DevRemoteEffectJournal({file});
    const fleet=new FleetRouter();
    fleet.touch(owner);
    assert.equal(journal.pending,0);
    journal.prepare(row());
    assert.equal(journal.pending,1);
    const persisted=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(persisted.pending.length,1);
    assert.equal(fs.statSync(file).mode&0o777,0o600);
    const command=fleet.enqueue({...owner,jobId:'uat_job',commandId:row().commandId,payload:{type:'exec'}});
    assert.equal(fleet.poll(owner).command.commandId,command.commandId);
    assert.throws(()=>new DevRemoteEffectJournal({file}),
      /DEV_REMOTE_EFFECT_JOURNAL_PENDING_RESTART_REFUSED/);
    fleet.complete({...owner,commandId:command.commandId});
    // A generic successful command result is not proof that a remote
    // process/PTY or other side effect has ended. Never auto-settle on ACK.
    assert.equal(journal.pending,1);
    assert.throws(()=>new DevRemoteEffectJournal({file}),/PENDING_RESTART_REFUSED/);
    // TEST-ONLY owner reconciliation after independent fixture confirmation.
    journal.settle(command.commandId);
    assert.equal(journal.pending,0);
    assert.throws(()=>new DevRemoteEffectJournal({file}),/EEXIST/);
    assert.equal(journal.releaseClean(),true);
    const nextOwner=new DevRemoteEffectJournal({file});
    assert.equal(nextOwner.pending,0);
    nextOwner.releaseClean();
  }finally{cleanup();}
});
test('durable pre-enqueue failure leaves memory unchanged and denies dispatch',()=>{
  const {file,cleanup}=fixture();
  try{
    const ledger=new DevRemoteEffectJournal({file,write(){throw Error('injected_fsync_failure');}});
    assert.throws(()=>ledger.prepare(row()),/injected_fsync_failure/);
    assert.equal(ledger.pending,0);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).pending.length,0);
  }finally{cleanup();}
});
test('single-owner O_EXCL lease rejects competing and stale process owners',()=>{
  const {file,cleanup}=fixture();
  try{
    const first=new DevRemoteEffectJournal({file});
    assert.throws(()=>new DevRemoteEffectJournal({file}),/EEXIST/);
    // A crashed process leaves this lock even if no remote command was sent.
    assert.equal(fs.existsSync(file+'.owner.lock'),true);
    first.prepare(row());
    assert.throws(()=>first.releaseClean(),/RELEASE_PENDING/);
    assert.throws(()=>new DevRemoteEffectJournal({file}),/PENDING_RESTART_REFUSED/);
    first.settle(row().commandId);
    first.releaseClean();
    const second=new DevRemoteEffectJournal({file});
    assert.equal(second.pending,0);
    // Owner lock replacement/revocation cannot be ignored by a live writer.
    fs.renameSync(file+'.owner.lock',file+'.stale-lock');
    assert.throws(()=>second.prepare(row('cmd_uat_beta')),/ENOENT|OWNER_LOST/);
  }finally{cleanup();}
});

test('missing, malformed, linked or insecure dev journal is rejected rather than initialized',()=>{
  const {dir,file,cleanup}=fixture();
  try{
    const absent=path.join(dir,'missing.json');
    assert.throws(()=>new DevRemoteEffectJournal({file:absent}),/ENOENT/);
    fs.chmodSync(file,0o644);
    assert.throws(()=>new DevRemoteEffectJournal({file}),/UNTRUSTED_FILE/);
    fs.chmodSync(file,0o600);
    const link=path.join(dir,'linked.json');
    fs.symlinkSync(file,link);
    assert.throws(()=>new DevRemoteEffectJournal({file:link}),/ELOOP|UNTRUSTED_FILE/);
    durableAtomicWriteSync(file,'{"schemaVersion":1,"pending":"bad"}\n',{mode:0o600});
    assert.throws(()=>new DevRemoteEffectJournal({file}),/INVALID_FORMAT/);
  }finally{cleanup();}
});
test('real dev Operator refuses fresh process startup with unresolved durable remote effect',()=>{
  const {dir,file,cleanup}=fixture();
  try{
    const j=new DevRemoteEffectJournal({file});
    j.prepare(row());
    for(const sub of ['state','log','socket','freeze'])fs.mkdirSync(path.join(dir,sub),{mode:0o700});
    const entry=fileURLToPath(new URL('../../operator-host/executor.mjs',import.meta.url));
    const cwd=fileURLToPath(new URL('../../',import.meta.url));
    const env={
      PATH:process.env.PATH||'/usr/bin:/bin',HOME:dir,LANG:'C',NODE_ENV:'test',
      OPERATOR_SOCKET:path.join(dir,'socket','op.sock'),
      OPERATOR_STATE_DIR:path.join(dir,'state'),OPERATOR_LOG_DIR:path.join(dir,'log'),
      OPERATOR_INTEGRATED_HOST:'0',OPERATOR_ACCOUNT_ID:'uat_owner',
      OPERATOR_DEVICE_ID:'uat_device',OPERATOR_NODE_ID:'uat_node',
      OPERATOR_KEY_FILE:path.join(dir,'no-real-key'),
      LR_RC50_DEV_LOCAL_FREEZE:'1',
      LR_RC50_OPERATOR_FREEZE_MARKER_PATH:path.join(dir,'freeze','marker.json'),
      LR_RC50_DEV_REMOTE_EFFECT_JOURNAL:'1',
      LR_RC50_DEV_REMOTE_EFFECT_JOURNAL_PATH:file,
      LIGHT_REMOTE_VERSION:'0.9.0-rc.50'
    };
    const child=spawnSync(process.execPath,[entry],{cwd,env,encoding:'utf8',timeout:6000});
    assert.notEqual(child.status,0);
    assert.match(child.stderr,/DEV_REMOTE_EFFECT_JOURNAL_PENDING_RESTART_REFUSED/);
    assert.equal(fs.existsSync(env.OPERATOR_SOCKET),false);
  }finally{cleanup();}
});
test('actual disposable dev Operator cleans ownership lock only after clean empty-journal shutdown',
  {timeout:20000},async()=>{
  const {dir,file,cleanup}=fixture();
  for(const sub of ['state','log','socket','freeze'])fs.mkdirSync(path.join(dir,sub),{mode:0o700});
  const entry=fileURLToPath(new URL('../../operator-host/executor.mjs',import.meta.url));
  const cwd=fileURLToPath(new URL('../../',import.meta.url));
  const socketPath=path.join(dir,'socket','op.sock');
  const env={
    PATH:process.env.PATH||'/usr/bin:/bin',HOME:dir,LANG:'C',NODE_ENV:'test',
    OPERATOR_SOCKET:socketPath,OPERATOR_STATE_DIR:path.join(dir,'state'),
    OPERATOR_LOG_DIR:path.join(dir,'log'),OPERATOR_INTEGRATED_HOST:'0',
    OPERATOR_ACCOUNT_ID:'uat_owner',OPERATOR_DEVICE_ID:'uat_device',
    OPERATOR_NODE_ID:'uat_node',OPERATOR_KEY_FILE:path.join(dir,'absent-key'),
    LR_RC50_DEV_LOCAL_FREEZE:'1',
    LR_RC50_OPERATOR_FREEZE_MARKER_PATH:path.join(dir,'freeze','marker.json'),
    LR_RC50_DEV_REMOTE_EFFECT_JOURNAL:'1',
    LR_RC50_DEV_REMOTE_EFFECT_JOURNAL_PATH:file,
    LIGHT_REMOTE_VERSION:'0.9.0-rc.50'
  };
  const child=spawn(process.execPath,[entry],{cwd,env,stdio:['ignore','pipe','pipe']});
  let stderr='';
  child.stderr.on('data',d=>{stderr=(stderr+d).slice(-2500);});
  const request=()=>new Promise((resolve,reject)=>{
    const req=http.request({socketPath,path:'/healthz',timeout:1200},res=>{
      res.resume();res.on('end',()=>resolve(res.statusCode));
    });
    req.on('error',reject);req.on('timeout',()=>req.destroy(Error('health_timeout')));req.end();
  });
  try{
    let healthy=false;
    for(let i=0;i<120;i++){
      if(child.exitCode!==null)throw Error('child_exited_early '+stderr);
      try{if(await request()===200){healthy=true;break;}}catch{}
      await sleep(60);
    }
    assert.equal(healthy,true,'isolated Operator never reached health');
    assert.equal(fs.existsSync(file+'.owner.lock'),true);
    child.kill('SIGTERM');
    const timeout=new AbortController();
    let stopped;
    try{
      stopped=await Promise.race([
        new Promise(resolve=>child.once('exit',resolve)),
        sleep(6500,null,{signal:timeout.signal}).then(()=>{
          throw Error('operator_shutdown_timeout');
        })
      ]);
    }finally{timeout.abort();}
    assert.equal(stopped,0,stderr.slice(-500));
    assert.equal(fs.existsSync(file+'.owner.lock'),false);
    const next=new DevRemoteEffectJournal({file});
    assert.equal(next.pending,0);
    next.releaseClean();
  }finally{
    if(child.exitCode===null&&child.signalCode===null){
      child.kill('SIGKILL');
      await sleep(100);
    }
    cleanup();
  }
});

test('actual dev Operator integrates write-ahead before enqueue without automatic remote effect settlement',()=>{
  const src=fs.readFileSync(fileURLToPath(new URL('../../operator-host/executor.mjs',import.meta.url)),'utf8');
  const route=fs.readFileSync(fileURLToPath(new URL('../../operator-host/executor-routes-device-channel.mjs',import.meta.url)),'utf8');
  const prepare=src.indexOf('remoteEffectJournal.prepare(');
  const dispatch=src.indexOf('return fleet.enqueue(proposed);');
  assert.ok(prepare>0&&dispatch>prepare);
  assert.match(src,/remoteEffectJournalOptIn&&!freezeOptIn/);
  assert.match(src,/registerPendingSource\('durableRemoteEffects',/);
  assert.doesNotMatch(src,/function settleRemoteEffect\(commandId\)/);
  assert.doesNotMatch(route,/settleRemoteEffect/);
  assert.match(route,/fleet\.complete\(/);
});
