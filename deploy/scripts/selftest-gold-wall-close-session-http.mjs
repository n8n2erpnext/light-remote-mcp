import assert from 'node:assert/strict';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

let held=true,closeCount=0,sessionState='closed',upstream=0;
const sid='s_fixture_close_20261025',agent='agent-fixture-close-20261025';
const wall=startLocalWall({
  host:'127.0.0.1',port:0,
  getLocalStatus:async()=>({deviceId:'fixture-gold-uat',deviceName:'Gold UAT fixture',
    cloudDesiredConnected:true,cloudState:'connected',enrolled:true}),
  getRemoteStatus:async()=>{
    upstream++;
    return {ok:true,device:{deviceId:'fixture-gold-uat',displayName:'Gold UAT fixture'},
      connection:{state:'connected'},sessions:held?[{sessionId:sid,agentId:agent,
      label:'Fixture Agent',state:'hold',activeJobs:[]}]:[]};
  },
  closeSession:async data=>{
    closeCount++;
    assert.equal(data.sessionId,sid);assert.equal(data.agentId,agent);
    if(sessionState==='closed'){held=false;return {session:{sessionId:sid,agentId:agent,state:'closed'}};}
    return {session:{sessionId:sid,agentId:agent,state:sessionState}};
  }
});
try{
  if(!wall.server.listening)await new Promise(resolve=>wall.server.once('listening',resolve));
  const base='http://127.0.0.1:'+wall.server.address().port;
  const status=async()=>{const resp=await fetch(base+'/api/status',{cache:'no-store'});assert.equal(resp.status,200);return (await resp.json()).remote.sessions;};
  const close=async()=>{const resp=await fetch(base+'/api/session-close',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:sid,agentId:agent})});return {status:resp.status,body:await resp.json()};};
  assert.equal((await status()).length,1);
  sessionState='hold';
  const denied=await close();
  assert.equal(denied.status,409);
  assert.equal(denied.body.error,'session_close_unconfirmed');
  assert.equal((await status()).length,1,'unsuccessful close must not pretend session vanished');
  sessionState='closed';
  const accepted=await close();
  assert.equal(accepted.status,200);
  assert.equal(accepted.body.session.state,'closed');
  assert.equal((await status()).length,0,'POST close must invalidate status cache immediately');
  assert.equal(closeCount,2);
  assert.equal(upstream,2,'close must trigger one fresh status read; failed call does not invalidate cache');
  console.log('GOLD_WALL_CLOSE_SESSION_HTTP_CONFIRMED_IMMEDIATE_STATUS_REFRESH_PASS');
}finally{await wall.close();}
