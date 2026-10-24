/*
 * Narrow Gold device memory command invoked through its existing authorized
 * remote exec session. No arbitrary shell, path or SQL from request payload.
 * Output only a JSON record after the fixed success marker.
 */
import os from 'node:os';
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
  const modules=createGoldWallModules({file:dbFile});
  try{
    let result;
    switch(data.action){
      case 'handoff': result=modules.handoff({limit:Math.max(1,Math.min(Number(data.limit)||5,10))});break;
      case 'list':result=modules.listCheckpoints({query:String(data.query||''),limit:Math.max(1,Math.min(Number(data.limit)||15,30))});break;
      case 'get':result=modules.readCheckpoint(data.id);break;
      case 'save':result=modules.saveCheckpoint({kind:data.kind,title:data.title,body:data.body,source:data.source});break;
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
