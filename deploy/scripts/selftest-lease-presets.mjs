import { SessionRegistry, SessionError, SESSION_GRACE_PRESETS } from '../../operator-host/session-manager.mjs';

const registry=new SessionRegistry({
  idleMs:30*60*1000,
  minIdleMs:15*60*1000,
  maxIdleMs:60*60*1000,
  maxActive:8,
  accountId:'acct-test',
  deviceId:'device-test',
  nodeId:'arm-test'
});
function open(agentId,gracePreset,graceMs,deviceId='device-test',nodeId='arm-test'){
  return registry.open({agentId,openId:`open-${deviceId}-${agentId}`,gracePreset,graceMs,deviceId,nodeId});
}
function expectError(fn,message){
  try { fn(); } catch(error) {
    if(!(error instanceof SessionError)||error.message!==message) throw error;
    return;
  }
  throw new Error(`expected_${message}`);
}
const fifteen=open('agent-grace-15m-aaaaaaaa','15m');
if(fifteen.graceMs!==SESSION_GRACE_PRESETS['15m']||fifteen.gracePreset!=='15m') throw new Error('grace_15m_failed');
registry.close(fifteen.sessionId,fifteen.agentId);
const half=open('agent-grace-30m-aaaaaaaa','30m');
if(half.graceMs!==SESSION_GRACE_PRESETS['30m']||half.gracePreset!=='30m') throw new Error('grace_30m_failed');
registry.close(half.sessionId,half.agentId);const fortyFive=open('agent-grace-45m-aaaaaaaa','45m');
if(fortyFive.graceMs!==SESSION_GRACE_PRESETS['45m']) throw new Error('grace_45m_failed');
registry.close(fortyFive.sessionId,fortyFive.agentId);
const hour=open('agent-grace-60m-aaaaaaaa','60m');
if(hour.graceMs!==SESSION_GRACE_PRESETS['60m']||hour.gracePreset!=='60m') throw new Error('grace_60m_failed');
registry.close(hour.sessionId,hour.agentId);
const alias=open('agent-grace-1h-alias-aa','1h');
if(alias.gracePreset!=='60m'||alias.graceMs!==SESSION_GRACE_PRESETS['60m']) throw new Error('grace_1h_alias_failed');
registry.close(alias.sessionId,alias.agentId);
const custom=open('agent-grace-custom-aaaa','custom',35*60*1000);
if(custom.graceMs!==35*60*1000||custom.gracePreset!=='custom') throw new Error('grace_custom_failed');
registry.close(custom.sessionId,custom.agentId);
expectError(()=>open('agent-grace-too-long-aaa','custom',61*60*1000),'invalid_session_grace');
expectError(()=>open('agent-grace-too-short-aa','custom',14*60*1000),'invalid_session_grace');
expectError(()=>open('agent-grace-3h-invalid-aa','3h'),'invalid_session_grace_preset');
expectError(()=>open('agent-grace-unlimited-aaaa','unlimited'),'session_grace_unlimited_not_available');
expectError(()=>open('agent-grace-always-aaaaaaaa','always-keep-alive'),'session_grace_unlimited_not_available');

const agent='agent-same-chat-aaaaaaaa';
const onA=open(agent,'30m',undefined,'device-a','node-a');
const onB=open(agent,'30m',undefined,'device-b','node-b');
if(onA.sessionId===onB.sessionId||onA.deviceId===onB.deviceId) throw new Error('same_agent_multi_device_lane_failed');
const onAAgain=registry.open({agentId:agent,openId:'different-open-id-aaaaaaaa',deviceId:'device-a',nodeId:'node-a'});
if(onAAgain.sessionId!==onA.sessionId) throw new Error('same_agent_same_device_reuse_failed');
console.log(JSON.stringify({ok:true,gracePresets:SESSION_GRACE_PRESETS,sameAgentDifferentDevice:true,unlimited:false},null,2));