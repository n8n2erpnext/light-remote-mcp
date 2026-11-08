// G3: buffering HTTP hop accepts upload bytes but sends no hello-ack.
// This is a localhost transport fixture, not a live Gold gateway proof.
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {DeviceDuplexClient,DEVICE_DUPLEX_PROTOCOL} from '../../lib/device-duplex-client.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const server=http.createServer((req,res)=>{
  req.on('data',()=>{}); // consume request, intentionally withhold response
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const client=new DeviceDuplexClient({
  hub:'http://127.0.0.1:'+server.address().port,
  hello:meta=>({type:'hello',protocol:DEVICE_DUPLEX_PROTOCOL,transportEpoch:meta.transportEpoch,clientSeq:meta.clientSeq}),
  onCommand:async()=>{throw Error('no synthetic command permitted');},
  log:()=>{}
});
try {
  client.start();
  const deadline=Date.now()+14500;
  while(Date.now()<deadline&&client.status().readyTimeouts===0)await delay(100);
  const diag=client.status();
  assert.equal(diag.ready,false);
  assert.equal(diag.lastConnectionErrorCode,'device_duplex_ready_timeout');
  assert.ok(diag.readyTimeouts>=1);
  assert.ok(diag.lastConnectionErrorAt>0);
  assert.equal(diag.lastReadyAt,0);
  console.log('G3_DUPLEX_BUFFERED_HTTP_READY_TIMEOUT_DIAGNOSTIC=PASS');
} finally {
  await client.close('test_finished');
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
