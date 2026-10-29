/**
 * Gold device-local Codex harness connection. No shell, MCP, or execution tools.
 * Credentials never leave device except Authorization to official OpenAI API.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ENDPOINT='https://api.openai.com/v1';
const MODELS=new Set(['gpt-6-luna','gpt-6.1-sol','gpt-6-astra']);
function error(code,status=400){return Object.assign(new Error(code),{status});}

// Never expose untrusted API response messages, request headers, or credentials
// through a Wall response. Only safe diagnostic error CODES are returned.
function safeErrorCode(value){
  return typeof value==='string'&&/^[a-z][a-z0-9_]{1,95}$/.test(value)?value:null;
}
function eventErrorCode(evt){
  return [evt?.error?.code,evt?.turn?.error?.code,evt?.session?.error?.code,
    evt?.data?.error?.code,evt?.data?.code,evt?.code,evt?.turn?.result?.error?.code]
    .map(safeErrorCode).find(Boolean)||null;
}
function privateDir(dir){fs.mkdirSync(dir,{recursive:true,mode:0o700});}
function ensureMode(filename){if(fs.existsSync(filename)&&(fs.statSync(filename).mode&0o077))throw error('codex_credential_permissions',503);}
function writePrivate(filename,bytes) {
  ensureMode(filename);
  privateDir(path.dirname(filename));
  const temp=filename+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
  try{
    fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});
    fs.renameSync(temp,filename);
  }finally{try{fs.unlinkSync(temp);}catch{}}
}
export function createGoldCodexConnection({storageFile,fetchImpl=globalThis.fetch}){
  if(!path.isAbsolute(storageFile))throw error('codex_local_storage_path_required');
  const keyFile=storageFile+'.key';
  function getKey(create=false){
    ensureMode(keyFile);
    if(!fs.existsSync(keyFile)){
      if(!create)throw error('codex_key_not_configured',409);
      privateDir(path.dirname(keyFile));
      try{fs.writeFileSync(keyFile,crypto.randomBytes(32),{mode:0o600,flag:'wx'});}
      catch(e){if(e.code!=='EEXIST')throw e;}
    }
    const key=fs.readFileSync(keyFile);
    if(key.length!==32)throw error('codex_device_key_invalid',503);
    return key;
  }
  function decrypt(){
    ensureMode(storageFile);
    if(!fs.existsSync(storageFile))return null;
    try{
      const data=JSON.parse(fs.readFileSync(storageFile,'utf8'));
      const decipher=crypto.createDecipheriv('aes-256-gcm',getKey(),Buffer.from(data.iv,'base64'));
      decipher.setAuthTag(Buffer.from(data.tag,'base64'));
      const apiKey=Buffer.concat([decipher.update(Buffer.from(data.enc,'base64')),decipher.final()]).toString('utf8');
      return {apiKey,model:data.model};
    }catch{throw error('codex_credential_unreadable',503);}
  }
  function config(){
    const value=decrypt();
    return {configured:Boolean(value),model:value?.model||'gpt-6-luna',
      provider:'openai_agents_api',endpoint:'api.openai.com',permission:'owner_read_only'};
  }
  function save({apiKey,model='gpt-6-luna'}={}){
    if(typeof apiKey!=='string'||apiKey.trim()!==apiKey||apiKey.length<20||apiKey.length>512)
      throw error('codex_api_key_invalid');
    if(!MODELS.has(model))throw error('codex_model_not_supported');
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',getKey(true),iv);
    const enc=Buffer.concat([cipher.update(apiKey,'utf8'),cipher.final()]);
    writePrivate(storageFile,JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
      enc:enc.toString('base64'),model}));
    return config();
  }
  function clear(){
    ensureMode(storageFile);ensureMode(keyFile);
    if(fs.existsSync(storageFile))fs.unlinkSync(storageFile);
    if(fs.existsSync(keyFile))fs.unlinkSync(keyFile);
    return config();
  }
  function requireSecret(){const value=decrypt();if(!value)throw error('codex_key_not_configured',409);return value;}
  async function fetchOfficial(url,opts){
    try{
      const res=await fetchImpl(url,{...opts,redirect:'error',signal:AbortSignal.timeout(opts.timeout||20000)});
      return res;
    }catch{throw error('codex_network_unavailable',502);}
  }
  async function verify(){
    const {apiKey,model}=requireSecret();
    const response=await fetchOfficial(ENDPOINT+'/models',{
      headers:{Authorization:'Bearer '+apiKey},method:'GET',timeout:12000
    });
    if(response.status===401)throw error('codex_api_key_rejected',401);
    if(response.status===403)throw error('codex_api_permission_denied',403);
    if(response.status===429)throw error('codex_api_rate_limit',429);
    if(!response.ok)throw error('codex_api_unavailable',502);
    // Model-list access does NOT prove Agents API or model entitlement.
    await response.body?.cancel?.();
    return {authenticated:true,agentsApiVerified:false,model,provider:'openai_agents_api'};
  }
  async function run({tasks=[]}={}){
    const {apiKey,model}=requireSecret();
    if(!Array.isArray(tasks)||tasks.length>20)throw error('codex_tasks_invalid');
    const safe=tasks.map(t=>({title:String(t.title||'').slice(0,240),state:String(t.state||'').slice(0,20)}));
    const input=safe.length?'Observe the following owner-submitted tasks and summarize the safest next action in up to 80 words. Do not use tools. Tasks:\n'+JSON.stringify(safe):
      'Reply with a brief confirmation that this Codex harness session is working. Do not call tools.';
    const res=await fetchOfficial(ENDPOINT+'/agents/sessions',{
      method:'POST',timeout:55000,
      headers:{Authorization:'Bearer '+apiKey,'OpenAI-Beta':'agents=v1','Content-Type':'application/json'},
      body:JSON.stringify({agent:{model,instructions:'You are the READ-ONLY Light Remote Gold Codex Bridge observer. No tools, no shell, no network access, no file access, no automatic actions or ChatGPT Web turn injection. Output a brief recommendation.'},
        environment:{type:'none'},input,stream:true})
    });
    if(!res.ok){
      let code=null;
      try{
        const payload=await res.json();
        code=safeErrorCode(payload?.error?.code)||safeErrorCode(payload?.error?.type);
      }catch{}
      const fallback=res.status===401?'unauthorized':res.status===403?'forbidden':
        res.status===429?'rate_limit_exceeded':'agents_request_rejected';
      return {connected:false,completed:false,status:'rejected',model,httpStatus:res.status,
        errorCode:code||fallback,sessionId:null,summary:null};
    }
    if(!res.body)throw error('codex_agents_no_stream',502);
    const reader=res.body.getReader();const decoder=new TextDecoder();
    let pending='',written='',outcome='in_progress',bytes=0,sessionId=null,failureCode=null;
    const handle=raw=>{
      const data=raw.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim()).join('');
      if(!data||data==='[DONE]')return;
      let evt;try{evt=JSON.parse(data);}catch{return;}
      if(evt.session_id)sessionId=evt.session_id;
      if(evt.session?.id)sessionId=evt.session.id;
      if(evt.type==='agent.session.turn.output_text.delta'&&typeof evt.delta==='string')written=(written+evt.delta).slice(0,5000);
      if(evt.type==='agent.session.turn.output_text.done'&&typeof evt.text==='string')written=evt.text.slice(0,5000);
      if(evt.type==='agent.session.turn.completed')outcome='completed';
      if(evt.type==='agent.session.turn.failed'||evt.type==='agent.session.turn.cancelled'||evt.type==='agent.session.failed'||evt.type==='error'){
        failureCode=eventErrorCode(evt)||failureCode;
        outcome='failed';
      }
    };
    try{
      while(bytes<1200000&&outcome==='in_progress'){
        const {done,value}=await reader.read();if(done)break;
        bytes+=value.byteLength;pending+=decoder.decode(value,{stream:true});pending=pending.replace(/\r\n/g,'\n');
        let ix;
        while((ix=pending.indexOf('\n\n'))>=0){
          const part=pending.slice(0,ix);pending=pending.slice(ix+2);handle(part);
          if(outcome!=='in_progress')break;
        }
      }
    }catch{throw error('codex_agents_stream_interrupted',502);}
    finally{await reader.cancel().catch(()=>{});}
    if(outcome!=='completed')return {connected:true,completed:false,
      status:outcome==='failed'?'failed':'unverified',model,sessionId,
      errorCode:failureCode||(outcome==='failed'?'agent_turn_failed':'turn_outcome_unverified'),summary:written||null};
    return {connected:true,completed:true,status:'completed',model,sessionId,summary:written||'Turn completed without text output'};
  }
  return {config,save,clear,verify,run};
}
