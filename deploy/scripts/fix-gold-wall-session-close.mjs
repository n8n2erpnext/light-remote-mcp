import fs from 'node:fs';import path from 'node:path';
const [mode,root]=process.argv.slice(2);
if(!['--check','--apply'].includes(mode)||!root)throw Error('usage: --check|--apply ROOT');
function once(s,a,b,label){let old=a,replacement=b,p=s.indexOf(old);if(p<0&&a.includes('\n')){old=a.replaceAll('\n','\r\n');replacement=b.replaceAll('\n','\r\n');p=s.indexOf(old);}if(p<0||s.indexOf(old,p+old.length)>=0)throw Error('preimage:'+label);return s.slice(0,p)+replacement+s.slice(p+old.length)}
function exactly(s,a,b,n,label){if(s.split(a).length-1!==n)throw Error('preimage:'+label);return s.split(a).join(b)}
const cacheFile=path.join(root,'device-agent/wall-status-cache.mjs');
const wallFile=path.join(root,'device-agent/local-wall.mjs');
let a=fs.readFileSync(cacheFile,'utf8'),b=fs.readFileSync(wallFile,'utf8');
a=once(a,"let identity='',last=null,lastAt=0,nextAt=0,inFlight=null,lastError=null;","let identity='',last=null,lastAt=0,nextAt=0,inFlight=null,lastError=null,generation=0;",'generation');
a=once(a,"const reset=()=>{last=null;lastAt=0;nextAt=0;inFlight=null;lastError=null;};","const reset=()=>{generation++;last=null;lastAt=0;nextAt=0;inFlight=null;lastError=null;};",'reset');
a=once(a,"  return {\n    async get({connected,deviceId,force=false}={}){","  return {\n    invalidate(){reset();},\n    async get({connected,deviceId,force=false}={}){",'invalidate');
a=once(a,"      const requestedIdentity=identity;","      const requestedIdentity=identity,requestedGeneration=generation;",'fence');
a=exactly(a,"if(requestedIdentity===identity){","if(requestedIdentity===identity&&requestedGeneration===generation){",2,'old_response');
b=once(b,"async function refreshStatus(){try{const r=await fetch('/api/status',{cache:'no-store'}),d=await r.json();localState=","let statusEpoch=0;async function refreshStatus(){const epoch=statusEpoch;try{const r=await fetch('/api/status',{cache:'no-store'}),d=await r.json();if(epoch!==statusEpoch)return;localState=",'browser_epoch');
b=once(b,"await wallMutation('/api/session-close',{sessionId:s.sessionId,agentId:s.agentId});selected='ALL';await refreshStatus();notify('Session closed','ok');","const result=await wallMutation('/api/session-close',{sessionId:s.sessionId,agentId:s.agentId});if(result.session?.state!=='closed')throw Error('session_close_unconfirmed');statusEpoch++;sessions.delete(s.sessionId);selected='ALL';renderHeader();renderTabs();applyFilter();await refreshStatus();notify('Session closed','ok');",'single');
b=once(b,"try{await wallMutation('/api/session-close',{sessionId:s.sessionId,agentId:s.agentId});}catch(e){failed.push(","try{const result=await wallMutation('/api/session-close',{sessionId:s.sessionId,agentId:s.agentId});if(result.session?.state!=='closed')throw Error('session_close_unconfirmed');statusEpoch++;sessions.delete(s.sessionId);}catch(e){failed.push(",'batch');
b=once(b,"}selected='ALL';await refreshStatus();if(failed.length)notify('Some sessions could not be closed','error');","}selected='ALL';renderHeader();renderTabs();applyFilter();await refreshStatus();if(failed.length)notify('Close failed: '+failed.join('; ').slice(0,190),'error');",'batch_ui');
b=once(b,"const value=await closeSession(data||{});return json(res,200,{ok:true,session:value?.session||value});","const value=await closeSession(data||{}),closed=value?.session||value;if(closed?.state!=='closed')return json(res,409,{ok:false,error:'session_close_unconfirmed'});statusCache?.invalidate();return json(res,200,{ok:true,session:closed});",'api');
console.log('PREIMAGE_PASS, targets=2');if(mode==='--check')process.exit(0);
fs.writeFileSync(cacheFile,a);fs.writeFileSync(wallFile,b);console.log('PATCH_APPLIED');
