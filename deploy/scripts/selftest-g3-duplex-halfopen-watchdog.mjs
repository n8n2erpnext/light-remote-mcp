import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {DeviceDuplexClient,DEVICE_DUPLEX_PROTOCOL} from '../../lib/device-duplex-client.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const waitFor=async(predicate,timeoutMs=7500)=>{
  const until=Date.now()+timeoutMs;
  while(Date.now()<until){if(predicate())return;await delay(80);}
  assert.fail('G3 condition timed out');
};
let connections=0;
const server=http.createServer((req,res)=>{
  if(req.url!=='/device-channel/stream'){res.writeHead(404).end();return;}
  req.on('data',()=>{});
  connections++;
  const index=connections;
  res.writeHead(200,{'content-type':'application/x-ndjson','cache-control':'no-store'});
  let seq=1;
  res.write(JSON.stringify({type:'hello-ack',protocol:DEVICE_DUPLEX_PROTOCOL,serverSeq:seq,serverEpoch:'g3-test',lastClientSeq:0})+'\n');
  // First connection: TCP remains open and request frames are accepted, but
  // the server sends no further response. This is a genuine half-open application stream.
  if(index>1){
    const send=()=>{if(!res.destroyed)res.write(JSON.stringify({type:'heartbeat',protocol:DEVICE_DUPLEX_PROTOCOL,serverSeq:++seq})+'\n');};
    const keepAlive=setInterval(send,650);
    res.on('close',()=>clearInterval(keepAlive));
  }
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const errors=[];
const client=new DeviceDuplexClient({
  hub:'http://127.0.0.1:'+server.address().port,
  hello:meta=>({type:'hello',transportEpoch:meta.transportEpoch,protocol:DEVICE_DUPLEX_PROTOCOL,clientSeq:meta.clientSeq}),
  onCommand:async()=>{throw Error('unexpected command');},
  heartbeatPayload:()=>({}),
  heartbeatMs:2000,
  responseIdleMs:3000,
  log:e=>errors.push(e)
});
try{
  client.start();
  assert.equal(await client.waitReady(1500),true);
  await waitFor(()=>connections>=2&&client.status().ready,7800);
  assert.ok(client.status().receiveStaleDisconnects>=1,'open but unresponsive stream must be disconnected');
  console.log('G3_HALF_OPEN_STREAM_WATCHDOG_RECONNECT=PASS');
  const count=connections;
  await delay(3800);
  assert.equal(connections,count,'healthy receiving stream must stay connected');
  assert.equal(client.status().ready,true);
  assert.equal(client.status().receiveStaleDisconnects,1);
  assert.ok(client.status().lastInboundAt>0,'record a bounded timestamp for last server frame');
  console.log('G3_HEALTHY_SERVER_FRAMES_PREVENT_FALSE_RECONNECT=PASS');
  assert.ok(errors.some(e=>e.event==='device_duplex_response_stale'),'watchdog event must distinguish stalled receive');
  console.log('G3_HALF_OPEN_DIAGNOSTICS=PASS');
}finally{
  await client.close('fixture_done');
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
