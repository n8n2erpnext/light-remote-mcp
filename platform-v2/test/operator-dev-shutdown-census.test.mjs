import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';
import {NativeTerminalRegistry} from '../../lib/native-terminal.mjs';
import {LocalIngressFreezeGate} from '../../lib/local-ingress-freeze.mjs';
import {FleetRouter} from '../../operator-host/fleet-router.mjs';
import {DevRemoteEffectJournal} from '../../operator-host/dev-remote-effect-journal.mjs';
import {assertDevJournalCleanShutdown} from '../../operator-host/dev-journal-clean-shutdown.mjs';
import {durableAtomicWriteSync} from '../../lib/durable-atomic-file.mjs';

const owner={accountId:'uat_account',deviceId:'uat_device',sessionId:'uat_session',agentId:'uat_agent'};
test('actual native OS child and PTY outlive start-jobs and prohibit dev journal clean shutdown',
  {timeout:16000},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-shutdown-census-'));
  const journalPath=path.join(dir,'journal.json');
  durableAtomicWriteSync(journalPath,JSON.stringify({schemaVersion:1,pending:[]})+'\n',{mode:0o600});
  const ledger=new DevRemoteEffectJournal({file:journalPath});
  const nativeProcesses=new NativeProcessRegistry();
  let onExit=null;
  const terminalProvider={spawn(){return {
    pid:null,write(){},resize(){},onData(){},onExit(fn){onExit=fn;},
    kill(){setImmediate(()=>onExit?.({exitCode:0,signal:null}));}
  };}};
  const nativeTerminals=new NativeTerminalRegistry({ptyProvider:terminalProvider});
  const gate=new LocalIngressFreezeGate({enabled:true,markerPath:path.join(dir,'freeze.json'),service:'operator'});
  const fleet=new FleetRouter();
  const jobs=new Map();
  const unreconciledRemoteEffects=new Set();
  const context={localFreezeGate:gate,fleet,jobs,unreconciledRemoteEffects,
    remoteEffectJournal:ledger,nativeProcesses,nativeTerminals};
  let processId=null,terminalId=null;
  const assertUnsafe=()=>assert.throws(()=>assertDevJournalCleanShutdown(context),
    /DEV_REMOTE_EFFECT_JOURNAL_UNCLEAN_SHUTDOWN/);
  try{
    assert.equal(assertDevJournalCleanShutdown(context),true);
    const child=nativeProcesses.start({...owner,cwd:dir,script:'no_side_effect_uat',
      spawnSpec:()=>({file:process.execPath,args:['-e','setInterval(()=>{},1000)']})});
    processId=child.processId;
    const terminal=nativeTerminals.start({...owner,cwd:dir,shellSpec:{file:'fake-pty',args:[]}});
    terminalId=terminal.terminalId;
    // HTTP START requests have already completed; no Operator jobs are open.
    assert.equal(jobs.size,0);
    assertUnsafe();
    assert.equal(fs.existsSync(journalPath+'.owner.lock'),true);
    nativeTerminals.stop(terminalId,owner,{force:true});
    for(let i=0;i<100&&nativeTerminals.list().some(x=>!x.finishedAt);i++)
      await sleep(15);
    assert.equal(nativeTerminals.list().filter(x=>!x.finishedAt).length,0);
    assertUnsafe(); // still-running real OS child prevents releasing owner
    nativeProcesses.stop(processId,owner,{force:true});
    for(let i=0;i<200&&nativeProcesses.list().some(x=>!x.finishedAt);i++)
      await sleep(15);
    assert.equal(nativeProcesses.list().filter(x=>!x.finishedAt).length,0);
    ledger.prepare({accountId:owner.accountId,deviceId:owner.deviceId,
      nodeId:'uat_node',jobId:'uat_job',commandId:'cmd_test_only'});
    assertUnsafe(); // missing remote reconcile also denies clean shutdown
    ledger.settle('cmd_test_only'); // only a disposable fixture settles manually
    jobs.set('pending',{finishedAt:null});
    assertUnsafe(); // unfinished job with no PID still denies
    jobs.clear();
    assert.equal(assertDevJournalCleanShutdown(context),true);
    assert.equal(ledger.releaseClean(),true);
    assert.equal(fs.existsSync(journalPath+'.owner.lock'),false);
  }finally{
    if(processId){try{nativeProcesses.stop(processId,owner,{force:true});}catch{}}
    if(terminalId){try{nativeTerminals.stop(terminalId,owner,{force:true});}catch{}}
    nativeTerminals.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
test('missing census data and invalid counters fail closed, not zero',()=>{
  assert.throws(()=>assertDevJournalCleanShutdown(),/CENSUS_INVALID/);
  assert.throws(()=>assertDevJournalCleanShutdown({
    localFreezeGate:{snapshot:()=>({phase:'open',inflight:0})},
    fleet:{commands:{size:NaN}},jobs:new Map(),unreconciledRemoteEffects:new Set(),
    remoteEffectJournal:{pending:0},nativeProcesses:{list:()=>[]},nativeTerminals:{list:()=>[]}
  }),/CENSUS_INVALID/);
});
test('real Operator calls native lifetime census immediately before dev journal owner release',()=>{
  const source=fs.readFileSync(fileURLToPath(new URL('../../operator-host/executor.mjs',import.meta.url)),'utf8');
  const at=source.indexOf('assertDevJournalCleanShutdown({localFreezeGate,fleet,jobs,');
  const release=source.indexOf('remoteEffectJournal.releaseClean();');
  assert.ok(at>0&&release>at);
  assert.match(source,/nativeProcesses:NATIVE_PROCESSES,nativeTerminals:NATIVE_TERMINALS/);
});
