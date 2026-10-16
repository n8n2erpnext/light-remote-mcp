import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FleetRouter} from '../../operator-host/fleet-router.mjs';
import {LocalIngressFreezeGate} from '../../lib/local-ingress-freeze.mjs';

const ids={accountId:'uat_account',deviceId:'uat_device',nodeId:'uat_node'};
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-fleet-freeze-'));
  const fleet=new FleetRouter();
  fleet.touch(ids);
  const uncertain=new Set();
  const gate=new LocalIngressFreezeGate({enabled:true,service:'operator',markerPath:path.join(root,'freeze.json')});
  gate.registerPendingSource('fleetCommands',()=>fleet.commands.size);
  gate.registerPendingSource('unreconciledRemoteEffects',()=>uncertain.size);
  return {root,fleet,uncertain,gate,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const enqueue=fleet=>fleet.enqueue({...ids,jobId:'uat_job',payload:{type:'exec'}});
test('Fleet queued/dispatched command prevents local frozen ACK even after HTTP work ends',async()=>{
  const {fleet,gate,cleanup}=fixture();
  try{
    const command=enqueue(fleet);
    const pending=gate.freeze();
    assert.equal(gate.snapshot().phase,'freezing');
    assert.equal(gate.snapshot().pendingExternal,1);
    assert.equal(fleet.poll(ids).command.commandId,command.commandId);
    assert.equal(gate.snapshot().pendingExternal,1);
    fleet.complete({...ids,commandId:command.commandId});
    gate.notifyPendingChanged();
    await pending;
    assert.equal(gate.snapshot().phase,'frozen');
    assert.equal(gate.snapshot().pendingExternal,0);
  }finally{cleanup();}
});
test('timed-out and abandoned remote dispatch holds freeze after fleet command disappears',async()=>{
  const {fleet,gate,uncertain,cleanup}=fixture();
  try{
    const command=enqueue(fleet);
    fleet.poll(ids);
    // Real Operator records uncertainty BEFORE acknowledging the timed-out job.
    uncertain.add(command.commandId);
    fleet.abandon(command.commandId,'remote_result_timeout');
    assert.equal(fleet.commands.size,0);
    const response=gate.freeze();
    let acknowledged=false;
    void response.then(()=>{acknowledged=true;});
    await Promise.resolve();
    assert.equal(gate.snapshot().pendingExternal,1);
    assert.equal(gate.snapshot().phase,'freezing');
    assert.equal(acknowledged,false);
    assert.equal(gate.snapshot().markerDurable,true);
    // No automatic time-based removal of unresolved effects: owner fence required.
  }finally{cleanup();}
});
test('real Operator registers both Fleet and unknown remote outcome with timeout latch',()=>{
  const src=fs.readFileSync(fileURLToPath(new URL('../../operator-host/executor.mjs',import.meta.url)),'utf8');
  assert.match(src,/registerPendingSource\('fleetCommands',/);
  assert.match(src,/registerPendingSource\('unreconciledRemoteEffects',/);
  assert.match(src,/unreconciledRemoteEffects\.add\(job\.commandId\)/);
  assert.match(src,/job\.remote\s*&&\s*job\.commandId\s*&&\s*job\.timedOut/);
});
