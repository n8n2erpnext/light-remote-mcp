import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createGoldPluginDependencyGuard} from './gold-dependency-guard.mjs';

const makeServer=async plane=>{
 const app=express();
 if(plane)app.use(createGoldPluginDependencyGuard(plane));
 app.get('/healthz',(_req,res)=>res.json({ok:true}));
 app.post('/mcp',(_req,res)=>res.status(200).json({ok:true,tool:'executed'}));
 app.get('/account/api',(_req,res)=>res.json({ok:true,account:'acct_1'}));
 app.get('/ai-guide',(_req,res)=>res.type('text').send('guide'));
 const srv=await new Promise(resolve=>{
  const server=app.listen(0,'127.0.0.1',()=>resolve(server));
 });
 const base='http://127.0.0.1:'+srv.address().port;
 const query=async(route,method='GET')=>{
  const result=await fetch(base+route,{method});
  return{status:result.status,json:await result.json().catch(()=>null),
   cache:result.headers.get('cache-control')};
 };
 return {query,close:()=>new Promise(resolve=>srv.close(resolve))};
};

test('Gold Plugin refuses to install a partial DB/Redis health guard',()=>{
 assert.throws(()=>createGoldPluginDependencyGuard({pool:{query:()=>{}}}),/requires_verified_plane/);
 assert.throws(()=>createGoldPluginDependencyGuard({redis:{ping:()=>{}}}),/requires_verified_plane/);
});
test('Gold Plugin health, MCP, account and static pages all require live PostgreSQL and Redis',async()=>{
 const calls=[],plane={pool:{query:async sql=>{
  calls.push(sql);return{rows:[{gold_ready:1}]};
 }},redis:{ping:async()=>{calls.push('PING');return 'PONG'}}};
 const server=await makeServer(plane);
 try{
  for(const [p,method] of [['/healthz','GET'],['/mcp','POST'],
   ['/account/api','GET'],['/ai-guide','GET']]){
   const response=await server.query(p,method);
   assert.equal(response.status,200,p);
  }
  assert.equal(calls.filter(x=>x==='PING').length,4);
  assert.equal(calls.filter(x=>x==='SELECT 1 AS gold_ready').length,4);
 }finally{await server.close()}
});
test('Gold Plugin fails closed when PostgreSQL or Redis drops after first successful request',async()=>{
 let database=true,cache=true;
 const server=await makeServer({pool:{query:async()=>database?
   {rows:[{gold_ready:1}]}:Promise.reject(Error('db_offline'))},
   redis:{ping:async()=>cache?'PONG':'OFFLINE'}});
 try{
  assert.equal((await server.query('/healthz')).status,200);
  database=false;
  for(const [p,m] of [['/healthz','GET'],['/mcp','POST'],['/account/api','GET']]){
   const x=await server.query(p,m);
   assert.equal(x.status,503,p);
   assert.equal(x.json.error,'gold_plugin_dependency_unavailable');
   assert.equal(x.cache,'no-store');
  }
  database=true;cache=false;
  assert.equal((await server.query('/mcp','POST')).status,503);
  cache=true;
  assert.equal((await server.query('/healthz')).status,200);
 }finally{await server.close()}
});
test('Default Plugin path has no Gold database dependency',async()=>{
 const server=await makeServer(null);
 try{assert.equal((await server.query('/mcp','POST')).status,200)}
 finally{await server.close()}
});

test('Gold dependency guard precedes Paddle webhooks, body parsers and public routes',async()=>{
 const fs=await import('node:fs');
 const file=fs.readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
 const at=x=>file.indexOf(x);
 const guard=at('app.use(createGoldPluginDependencyGuard(goldSitePlane))');
 assert(guard>0,'Gold guard must be mounted');
 for(const signature of ['registerPaddleWebhook(app,','app.use(express.json(',
   'installAnnouncements(app);','registerOAuth(app);','registerAccountPortal(app);',
   "app.post('/mcp'"]){
  assert(at(signature)>guard,signature+' mounted before dependency guard');
 }
 assert(file.includes('if(goldSitePlane)app.use(createGoldPluginDependencyGuard(goldSitePlane));'));
});
