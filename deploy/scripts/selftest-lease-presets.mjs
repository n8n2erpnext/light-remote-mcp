import { SessionRegistry, SessionError, SESSION_LEASE_PRESETS } from '../../operator-host/session-manager.mjs';

const registry=new SessionRegistry({
  idleMs:30*60*1000,
  minIdleMs:5*60*1000,
  maxIdleMs:24*60*60*1000,
  maxActive:5,
  accountId:'acct-test',
  deviceId:'device-test',
  nodeId:'arm-test'
});
function open(agentId,leasePreset,leaseMs){
  return registry.open({agentId,openId:`open-${agentId}`,leasePreset,leaseMs});
}
function expectError(fn,message){
  try { fn(); } catch(error) {
    if(!(error instanceof SessionError)||error.message!==message) throw error;
    return;
  }
  throw new Error(`expected_${message}`);
}
const half=open('agent-preset-30m-aaaaaaaa','30m');
if(half.leaseMs!==SESSION_LEASE_PRESETS['30m']||half.leasePreset!=='30m') throw new Error('preset_30m_failed');
registry.close(half.sessionId,half.agentId);
const hour=open('agent-preset-1h-aaaaaaaa','1h');
if(hour.leaseMs!==SESSION_LEASE_PRESETS['1h']||hour.leasePreset!=='1h') throw new Error('preset_1h_failed');
registry.close(hour.sessionId,hour.agentId);
const three=open('agent-preset-3h-aaaaaaaa','3h');
if(three.leaseMs!==SESSION_LEASE_PRESETS['3h']||three.leasePreset!=='3h') throw new Error('preset_3h_failed');
registry.close(three.sessionId,three.agentId);
const custom=open('agent-preset-custom-aaaa','custom',45*60*1000);
if(custom.leaseMs!==45*60*1000||custom.leasePreset!=='custom') throw new Error('preset_custom_failed');
registry.close(custom.sessionId,custom.agentId);
const defaulted=open('agent-preset-default-aaa');
if(defaulted.leaseMs!==30*60*1000||defaulted.leasePreset!=='default') throw new Error('preset_default_failed');
registry.close(defaulted.sessionId,defaulted.agentId);
expectError(()=>open('agent-preset-invalid-aaa','2h'),'invalid_session_lease_preset');
expectError(()=>open('agent-preset-conflict-aa','1h',60*60*1000),'session_lease_preset_conflict');
expectError(()=>open('agent-preset-custom-miss','custom'),'custom_session_lease_required');
expectError(()=>open('agent-preset-always-aaa','always-keep-alive'),'session_lease_preset_not_available');
console.log(JSON.stringify({ok:true,presets:SESSION_LEASE_PRESETS,customMs:custom.leaseMs,alwaysKeepAlive:'future-only'},null,2));
