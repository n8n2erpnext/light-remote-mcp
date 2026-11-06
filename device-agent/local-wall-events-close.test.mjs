import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {startLocalWall} from './local-wall.mjs';

// Regression: closing an /events SSE browser stream must not crash the
// same-device Agent. Activity pump remains active for background collection.
test('Local Wall SSE client close keeps Wall and agent process alive', {timeout:8000},async()=>{
  const wall=startLocalWall({
    host:'127.0.0.1',port:0,auth:{enabled:false},
    getLocalStatus:async()=>({ok:true,enrolled:false,deviceId:null}),
    getRemoteActivity:async()=>({ok:true,events:[]})
  });
  try{
    await once(wall.server,'listening');
    const address=wall.server.address();
    assert.ok(address&&typeof address!=='string'&&address.port>0);
    const base='http://127.0.0.1:'+address.port;
    for(let i=0;i<3;i++){
      await new Promise((resolve,reject)=>{
        let ended=false;
        const req=http.get(base+'/events',res=>{
          assert.equal(res.statusCode,200);
          assert.match(String(res.headers['content-type']),/text\/event-stream/);
          res.once('data',()=>{
            if(ended)return;
            ended=true;
            req.destroy();
            resolve();
          });
        });
        req.once('error',error=>{if(!ended)reject(error);});
      });
    }
    // Give the server's close handler an event-loop turn to execute.
    await new Promise(resolve=>setTimeout(resolve,50));
    const status=await new Promise((resolve,reject)=>{
      const req=http.get(base+'/api/status',res=>{
        let data='';
        res.setEncoding('utf8');
        res.on('data',x=>{data+=x;});
        res.on('end',()=>resolve({status:res.statusCode,body:data}));
      });
      req.once('error',reject);
    });
    assert.ok(status.status>=200&&status.status<500);
    assert.ok(typeof status.body==='string');
  }finally{
    await wall.close();
  }
});
