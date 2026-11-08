import assert from 'node:assert/strict';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

// Regression for the Windows crash: handler sent 200 headers, the render threw,
// and its catch tried to send JSON headers again. That used to terminate Node.
let identityCalls=0,shouldThrow=true;
const auth={
 enabled:true,
 identity(){
  identityCalls++;
  if(shouldThrow && identityCalls%2===0)throw new Error('fixture_wall_render_exception');
  return {accountId:'fixture_account',email:'fixture@example.test'};
 },
 csrfForRequest(){return 'fixture_csrf';}
};
const server=startLocalWall({host:'127.0.0.1',port:0,auth,getLocalStatus:async()=>({deviceName:'fixture',cloudState:'disconnected'})});
try{
 await new Promise((resolve,reject)=>server.server.listening?resolve():server.server.once('listening',resolve).once('error',reject));
 const base='http://127.0.0.1:'+server.server.address().port;
 const bad=await fetch(base+'/',{redirect:'manual'});
 const error=await bad.json();
 assert.equal(bad.status,400);
 assert.equal(error.error,'fixture_wall_render_exception');
 assert.equal(bad.headers.get('content-type')?.includes('application/json'),true);
 console.log('G2_WALL_RENDER_ERROR_NO_HEADERS_SENT_CRASH=PASS');
 shouldThrow=false;
 const recovered=await fetch(base+'/',{redirect:'manual'});
 assert.equal(recovered.status,200);
 assert.match(await recovered.text(),/LIVE OPERATOR STREAM/);
 console.log('G2_WALL_SUBSEQUENT_REQUEST_RECOVERED=PASS');
 const api=await fetch(base+'/api/status');
 assert.equal(api.status,200);
 assert.equal((await api.json()).ok,true);
 console.log('G2_WALL_API_REMAINS_ALIVE=PASS');
}finally{await server.close();}
