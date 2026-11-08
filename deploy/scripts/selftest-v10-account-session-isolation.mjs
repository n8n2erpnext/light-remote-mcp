import { SessionRegistry } from '../../operator-host/session-manager.mjs';

const registry=new SessionRegistry({maxActive:12,accountId:'self-hosted-local',deviceId:'device-default',nodeId:'node-default'});
const agent='agent-account-isolation-aaaaaaaa';
const common={agentId:agent,deviceId:'device-shared',nodeId:'node-shared',gracePreset:'30m'};
const a=registry.open({...common,accountId:'acct-a',openId:'open-account-a-aaaaaaaa'});
const b=registry.open({...common,accountId:'acct-b',openId:'open-account-b-bbbbbbbb'});
if(a.accountId!=='acct-a'||b.accountId!=='acct-b') throw new Error('account_not_preserved');
if(a.sessionId===b.sessionId) throw new Error('cross_account_session_reused');
const a2=registry.open({...common,accountId:'acct-a',openId:'open-account-a-new-aaaa'});
if(a2.sessionId!==a.sessionId) throw new Error('same_account_lane_not_reused');
const d=registry.open({agentId:'agent-default-account-aaaa',openId:'open-default-account-aaaa'});
if(d.accountId!=='self-hosted-local') throw new Error('default_account_regressed');
console.log(JSON.stringify({ok:true,isolated:true,defaultAccount:d.accountId},null,2));
