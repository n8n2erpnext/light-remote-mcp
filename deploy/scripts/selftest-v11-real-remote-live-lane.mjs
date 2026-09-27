import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RealRemoteLiveRegistry } from '../../operator-host/real-remote-live-registry.mjs';

const live=new RealRemoteLiveRegistry({ttlMs:60000,maxEvents:4});
const owner={deviceId:'dev_live_test',sessionId:'s_live_test',agentId:'agent_live_test',semanticSessionId:'sem_live_test'};
let pushed=live.push({...owner,stateSeq:2,events:[{seq:1,kind:'property'},{seq:2,kind:'focus'}],snapshot:{semanticSessionId:owner.semanticSessionId,stateSeq:2,nodes:[{id:'n1',name:'Notepad'}]},displayTopologyId:'topo-1'});
assert.equal(pushed.stateSeq,2);
let read=live.read({...owner,afterSeq:0,limit:1});
assert.equal(read.events.length,1);
assert.equal(read.hasMore,true);
assert.equal(read.snapshot.nodes[0].name,'Notepad');
assert.equal(read.nextAfterSeq,1);

live.push({...owner,stateSeq:6,events:[{seq:3},{seq:4},{seq:5},{seq:6}],cursor:{x:10,y:20}});
read=live.read({...owner,afterSeq:2,limit:10,includeSnapshot:false});
assert.deepEqual(read.events.map(x=>x.seq),[3,4,5,6]);
assert.equal(read.cursor.x,10);
assert.throws(()=>live.read({...owner,agentId:'agent_other',afterSeq:0}),/real_remote_live_owner_mismatch/);
assert.throws(()=>live.push({...owner,sessionId:'s_other',events:[{seq:7}]}),/real_remote_live_owner_mismatch/);
live.close(owner);
assert.throws(()=>live.read({...owner,afterSeq:0}),/real_remote_live_not_found/);
console.log('v11-real-remote-live-registry=PASS');


const readSource=file=>fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const api=readSource('api/operator.js');
const gateway=readSource('gateway/server.mjs');
const gatewayApp=readSource('gateway/gateway-app.mjs');
const executor=readSource('operator-host/executor.mjs');
const runtime=readSource('operator-host/executor-routes-runtime.mjs');
const channel=readSource('operator-host/executor-routes-device-channel.mjs');
const agent=readSource('device-agent/operator-agent.mjs');
const helper=readSource('lib/plus-tool-helper.js');
for(const token of ["action==='desktop-live-read'","'/plus/client/desktop-live/read'","'live-open','live-close'"])assert.ok(api.includes(token),'Vercel live desktop surface missing: '+token);
assert.ok(gateway.includes("app.post('/plus/client/desktop-live/read'")&&gateway.includes("app.post('/device-channel/desktop-live-push'"),'Gateway live routes missing');
assert.ok(gatewayApp.includes("'/device-channel/desktop-live-push'"),'Live push must use large-body parser');
assert.ok(executor.includes("desktop-live-push")&&executor.includes("new RealRemoteLiveRegistry()"),'Hub live registry wiring missing');
assert.ok(runtime.includes("'/v1/device-access/desktop-live/read'")&&runtime.includes("realRemoteLive.read"),'Direct cache read route missing');
assert.ok(channel.includes("'/v1/device-channel/desktop-live-push'")&&channel.includes("realRemoteLive.push"),'Signed live push route missing');
for(const token of ['REAL_REMOTE_LIVE_LOOPS','startRealRemoteLiveLoop','stopRealRemoteLiveLoop','desktop-live-push',"op==='live-open'","op==='live-close'"])assert.ok(agent.includes(token),'Device live robot missing: '+token);
for(const token of ['desktop-live-open','desktop-live-read','desktop-live-close','Hub cache'])assert.ok(helper.includes(token),'Tool helper live contract missing: '+token);
console.log('v11-real-remote-live-source-contract=PASS');
