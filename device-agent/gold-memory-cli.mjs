/*
 * Narrow Gold device memory command invoked through its existing authorized
 * remote exec session. No arbitrary shell, path or SQL from request payload.
 * Output only a JSON record after the fixed success marker.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {createGoldWallModules} from './gold-wall-modules.mjs';

function fail(message){throw new Error(message);}
async function main(){
  const payload=process.argv[2]||'';
  if(!/^[A-Za-z0-9_-]{3,20000}$/.test(payload))fail('gold_memory_payload_invalid');
  const bytes=Buffer.from(payload,'base64url');
  if(bytes.toString('base64url')!==payload)fail('gold_memory_payload_invalid');
  const data=JSON.parse(bytes.toString('utf8'));
  const stateFile=process.env.OPERATOR_AGENT_STATE ||
    path.join(os.homedir(),'.config','gpt-operator-agent','device.json');
  const dbFile=path.join(path.dirname(stateFile),'gold-wall-modules.sqlite');
  const modules=createGoldWallModules({file:dbFile,scopeIdentity:()=>{
    // Enrollment is device-local, not passed in the MCP request payload.
    let state;try{state=JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch{return null;}
    const e=state?.enrollment;
    return e?.accountId&&e?.deviceId?{accountId:e.accountId,deviceId:e.deviceId}:null;
  }});
  try{
    let result;
    switch(data.action){
      case 'handoff': result=modules.handoff({limit:Math.max(1,Math.min(Number(data.limit)||5,10))});break;
      case 'list':result=modules.listCheckpoints({query:String(data.query||''),limit:Math.max(1,Math.min(Number(data.limit)||15,30))});break;
      case 'get':result=modules.readCheckpoint(data.id);break;
      case 'save':result=modules.saveCheckpoint({kind:data.kind,title:data.title,body:data.body,source:data.source});break;
      case 'scopes':result=modules.listMemoryScopes();break;
      case 'scope_resolve':result=modules.resolveMemoryScope({sourceType:data.sourceType,sourceId:data.sourceId});break;
      case 'scope_handoff':result=modules.scopedHandoff({scopeId:data.scopeId,limit:Math.max(1,Math.min(Number(data.limit)||5,20))});break;
      case 'scope_get':result=modules.readScopedCheckpoint({scopeId:data.scopeId,checkpointId:data.id});break;
      case 'scope_save':result=modules.appendScopedCheckpoint({scopeId:data.scopeId,kind:data.kind,title:data.title,body:data.body,source:data.source,status:data.status,evidence:data.evidence});break;
      case 'scope_usage':result=modules.localMemoryUsage();break;
      case 'scope_full_context':{
        const found=modules.readFullContext({scopeId:data.scopeId});
        if(!found.available){result=found;break;}
        const offset=Math.max(0,Math.min(Number(data.offset)||0,found.text.length));
        const maxChars=Math.max(1,Math.min(Number(data.maxChars)||8000,10000));
        const part=found.text.slice(offset,offset+maxChars);
        result={scopeId:found.scopeId,available:true,title:found.title,bytes:found.bytes,
          sha256:found.sha256,integrity:found.integrity,checkpointRevision:found.checkpointRevision,
          totalChars:found.text.length,offset,text:part,nextOffset:offset+part.length,
          hasMore:offset+part.length<found.text.length};
        break;
      }
      default:fail('gold_memory_action_invalid');
    }
    process.stdout.write('LIGHT_REMOTE_GOLD_MEMORY_V1='+JSON.stringify({ok:true,action:data.action,result})+'\n');
  }finally{modules.close();}
}
try{await main();}
catch(e){
  const code=String(e?.message||'gold_memory_operation_failed');
  process.stdout.write('LIGHT_REMOTE_GOLD_MEMORY_V1='+JSON.stringify({ok:false,
    error:/^gold_[a-z0-9_]{1,100}$/.test(code)?code:'gold_memory_operation_failed'})+'\n');
  process.exitCode=2;
}
