import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AgentClientRegistry} from '../../operator-host/agent-client-registry.mjs';
import {handleDeviceChannelRoutes} from '../../operator-host/executor-routes-device-channel.mjs';

// Member approval, revocation, expiry and owner physical disconnect must
// have different cleanup scopes. A stale member grant must not sever owner.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-team-binding-'));
try {
  const stateFile=path.join(dir,'agent-clients.json');
  const registry=new AgentClientRegistry({stateFile});
  const ownerAgent='plugin-owner-01',memberAgent='plugin-member-01';
  const owner=registry.attach({accountId:'owner',agentId:ownerAgent,
    grant:{grantId:'dag_owner',deviceId:'shared-device',connectionId:'connection-1',accountId:'owner',agentId:ownerAgent}});
  const member=registry.attach({accountId:'member',agentId:memberAgent,
    grant:{grantId:'dag_member',deviceId:'shared-device',connectionId:'connection-1',accountId:'member',agentId:memberAgent}});
  registry.attach({clientSessionId:member.clientSessionId,accountId:'member',agentId:memberAgent,
    grant:{grantId:'dag_member_two',deviceId:'member-device',connectionId:'connection-2',accountId:'member',agentId:memberAgent}});
  assert.throws(()=>registry.removeBinding(member.clientSessionId,'shared-device','invalid',{agentId:ownerAgent}),
    /agent_client_agent_mismatch/,'one agent must not remove another client binding');
  const deviceGrants={
    assert(id){
      if(id==='dag_member')throw Error('device_access_grant_closed');
      return {grantId:id};
    }
  };
  const sharedDevice={deviceId:'shared-device',nodeId:'shared-device',displayName:'Shared device',
    state:'online',platform:'linux',architecture:'arm64'};
  const memberDevice={...sharedDevice,deviceId:'member-device',nodeId:'member-device'};
  const deps={
    agentClients:registry,accessGrants:deviceGrants,
    connections:{assertConnected:id=>({connectionId:id==='shared-device'?'connection-1':'connection-2',state:'connected',hardExpiresAt:Date.now()+3600000})},
    devices:{get:id=>id==='shared-device'?sharedDevice:memberDevice},
    sessions:{activeCountByNode:()=>0},
    readJson:async req=>req.body,
    sendJson:(res,status,data)=>{res.status=status;res.data=data;return true;}
  };
  const listResponse={};
  const listUrl=new URL('http://localhost/v1/agent-client/'+member.clientSessionId+'/devices?agentId='+memberAgent);
  await handleDeviceChannelRoutes({method:'GET'},listResponse,listUrl,deps);
  assert.equal(listResponse.status,200);
  assert.deepEqual(listResponse.data.devices.map(x=>x.deviceId),['member-device']);
  assert.equal(registry.resolve(owner.clientSessionId,{agentId:ownerAgent,deviceId:'shared-device'}).grantId,'dag_owner',
    'route invalidation for a member must preserve owner device binding');
  // A newly authorized but subsequently revoked member cannot resolve; the
  // resolve route must clean up only that member's connection.
  registry.attach({clientSessionId:member.clientSessionId,accountId:'member',agentId:memberAgent,
    grant:{grantId:'dag_member',deviceId:'shared-device',connectionId:'connection-1',accountId:'member',agentId:memberAgent}});
  const resolveUrl=new URL('http://localhost/v1/agent-client/resolve');
  const resolveReq={method:'POST',body:{clientSessionId:member.clientSessionId,agentId:memberAgent,deviceId:'shared-device'}};
  await assert.rejects(()=>handleDeviceChannelRoutes(resolveReq,{},resolveUrl,deps),/device_access_grant_closed/);
  assert.equal(registry.resolve(owner.clientSessionId,{agentId:ownerAgent,deviceId:'shared-device'}).grantId,'dag_owner');
  // A connection-expired error in context must have the same scoped cleanup.
  registry.attach({clientSessionId:member.clientSessionId,accountId:'member',agentId:memberAgent,
    grant:{grantId:'dag_member',deviceId:'shared-device',connectionId:'connection-1',accountId:'member',agentId:memberAgent}});
  const contextDeps={...deps,accessGrants:{assert:id=>({grantId:id})},connections:{assertConnected:()=>{throw Error('device_connection_expired');}}};
  await assert.rejects(()=>handleDeviceChannelRoutes(resolveReq,{},new URL('http://localhost/v1/agent-client/context'),contextDeps),
    /device_connection_expired/);
  assert.equal(registry.resolve(owner.clientSessionId,{agentId:ownerAgent,deviceId:'shared-device'}).grantId,'dag_owner');
  registry.attach({clientSessionId:member.clientSessionId,accountId:'member',agentId:memberAgent,
    grant:{grantId:'dag_member',deviceId:'shared-device',connectionId:'connection-1',accountId:'member',agentId:memberAgent}});

  assert.equal(registry.removeBinding(member.clientSessionId,'shared-device','grant_expired',{agentId:memberAgent}),true);
  assert.equal(registry.removeBinding(member.clientSessionId,'shared-device','grant_expired',{agentId:memberAgent}),false);
  assert.throws(()=>registry.resolve(member.clientSessionId,{agentId:memberAgent,deviceId:'shared-device'}),/agent_client_device_not_authorized/);
  assert.equal(registry.resolve(member.clientSessionId,{agentId:memberAgent}).deviceId,'member-device');
  assert.equal(registry.resolve(owner.clientSessionId,{agentId:ownerAgent,deviceId:'shared-device'}).grantId,'dag_owner');
  const reloaded=new AgentClientRegistry({stateFile});
  assert.equal(reloaded.resolve(owner.clientSessionId,{agentId:ownerAgent,deviceId:'shared-device'}).grantId,'dag_owner');
  assert.equal(reloaded.resolve(member.clientSessionId,{agentId:memberAgent}).deviceId,'member-device');
  reloaded.removeDevice('shared-device','physical_owner_disconnect');
  assert.throws(()=>reloaded.resolve(owner.clientSessionId,{agentId:ownerAgent,deviceId:'shared-device'}),/agent_client_device_not_authorized/);
  assert.equal(reloaded.resolve(member.clientSessionId,{agentId:memberAgent,deviceId:'member-device'}).grantId,'dag_member_two');
  const routes=fs.readFileSync(new URL('../../operator-host/executor-routes-device-channel.mjs',import.meta.url),'utf8');
  assert(!routes.includes("agentClients.removeDevice(binding.deviceId,'binding_invalid')"),
    'a per-client invalid grant must never unbind other clients');
  assert.equal((routes.match(/agentClients\.removeBinding\(/g)||[]).length,3,
    'list, resolve and context paths must use client-scoped cleanup');
  assert(routes.includes("agentClients.removeDevice(ctx.device.deviceId,connection.closeReason"),
    'physical owner disconnect still needs whole-device invalidation');
  console.log('team_invalid_member_grant_only_removes_its_client_binding=PASS');
  console.log('team_owner_binding_survives_member_expiry_and_reload=PASS');
  console.log('device_disconnect_still_revokes_every_binding=PASS');
  console.log('agent_scoped_binding_cleanup_cannot_cross_clients=PASS');
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
