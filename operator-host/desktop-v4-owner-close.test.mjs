import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopV4OwnerSessionClose} from './desktop-v4-owner-close.mjs';
const SESSION='acctsess_123e4567-e89b-42d3-a456-426614174000';
const build=({revoked=false,foreign=false,busy=false,wrongGrant=false}={})=>{
  let closed=0, detached=0, grants=0;
  const current={sessionId:'s-one',agentId:'agent-one',accountId:foreign?'other':'owner',
    deviceId:'dev-one',state:'active',activeJobs:busy?['job-one']:[]};
  const sessions={
    get:(s,a)=>{if(s!=='s-one'||a!=='agent-one')throw Error('session_not_found');return current;},
    close:(s,a)=>{closed++;return {...current,state:'closed'};}
  };
  const accessGrants={
    activeGrantsForDevice:()=>[{grantId:'dag-one',agentId:'agent-one',accountId:'owner',purpose:'device'}],
    close:(id)=>{if(id!=='dag-one')throw Error('wrong_grant');grants++;}
  };
  const agentClients={
    rows:new Map([['client-1',{clientSessionId:'client-1',agentId:'agent-one',
      accountId:'owner',closedAt:null,bindings:{'dev-one':{
        grantId:wrongGrant?'dag-different':'dag-one',
        workingContext:{sessionId:'s-one'}
      }}}]]),
    detachGrant:(s)=>{assert.equal(s,'client-1');detached++;}
  };
  const close=createDesktopV4OwnerSessionClose({
    accounts:{
      desktopOwnerSessionActive:(a,s)=>!revoked&&a==='owner'&&s===SESSION,
      account:()=>({accountId:'owner',isOwner:true,emailVerified:true,status:'active'})
    },
    allDeviceViews:()=>[{deviceId:'dev-one',accountId:'owner',state:'online'}],
    sessions,accessGrants,agentClients,
    connections:{assertConnected:()=>({accountId:'owner',deviceId:'dev-one',connectionId:'conn-one'})}
  });
  return {close,counts:()=>({closed,detached,grants})};
};
const query={accountId:'owner',accountSessionId:SESSION,
  sessionId:'s-one',agentId:'agent-one',deviceId:'dev-one'};
test('closes only matching verified Owner session and matching Agent grant',()=>{
  const state=build(),result=state.close(query);
  assert.deepEqual(result,{ok:true,sessionId:'s-one',deviceId:'dev-one',
    agentId:'agent-one',state:'closed',revokedGrants:1});
  assert.deepEqual(state.counts(),{closed:1,detached:1,grants:1});
});
test('denies revoked Owner, cross-account lane, active jobs, and wrong scope',()=>{
  for(const q of [
    {...query,accountId:'other'},{...query,deviceId:'dev-foreign'},
    {...query,agentId:'agent-other'}, {...query,sessionId:'s-other'},
    {...query,accountSessionId:'bad'}, {...query,deviceId:''}
  ])assert.throws(()=>build().close(q));
  for(const conf of [{revoked:true},{foreign:true},{busy:true},{wrongGrant:true}]){
    const b=build(conf);
    assert.throws(()=>b.close(query));
    assert.deepEqual(b.counts(),{closed:0,detached:0,grants:0});
  }
});
