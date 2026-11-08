import assert from 'node:assert/strict';
import net from 'node:net';
import {ipcEndpoint,removeIpcEndpoint,waitForIpc} from './selftest-ipc.mjs';

const endpoint=ipcEndpoint('lr-ipc-harness');
removeIpcEndpoint(endpoint);
const server=net.createServer(socket=>socket.end());
await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(endpoint,resolve);
});
try{
  assert.equal(await waitForIpc(endpoint,{attempts:20,delayMs:10}),true);
  if(process.platform==='win32')assert.match(endpoint,/^\\\\.\\pipe\\/);
  else assert.ok(endpoint.endsWith('.sock'));
  console.log('selftest-ipc-cross-platform=PASS');
}finally{
  await new Promise(resolve=>server.close(()=>resolve()));
  removeIpcEndpoint(endpoint);
}
