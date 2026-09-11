import crypto from 'node:crypto';
import { z } from 'zod';
import { callOperatorJson } from './operator-proxy.mjs';
import { sealOperatorPayload } from './operator-crypto.mjs';

const id=z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const agentId=z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/);
const opId=z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/);
const textPath=z.string().min(1).max(4096);
const ann=(readOnly=false,destructive=false,idempotent=false)=>({readOnlyHint:readOnly,destructiveHint:destructive,idempotentHint:idempotent,openWorldHint:false});
const b64=value=>Buffer.from(String(value),'utf8').toString('base64');

async function context(sessionId,ownerAgentId){
  const sessionResult=await callOperatorJson('GET',`/v1/sessions/${encodeURIComponent(sessionId)}?agentId=${encodeURIComponent(ownerAgentId)}`);
  const session=sessionResult?.session;
  if(!session?.sessionId)throw new Error('session_not_found');
  const devices=await callOperatorJson('GET','/v1/devices');
  const device=(devices.devices||[]).find(row=>row.nodeId===session.nodeId||row.deviceId===session.deviceId);
  if(!device)throw new Error('session_device_not_found');
  return {session,device};
}

function linuxDecode(name,value){return `${name}=$(printf '%s' '${b64(value)}' | base64 -d)`;}
function windowsDecode(name,value){return `$${name}=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(value)}'))`;}
async function submit({sessionId,agentId:ownerAgentId,operationId,script,requiredCapabilities=['filesystem'],note}){
  const ctx=await context(sessionId,ownerAgentId);
  const payload={action:'exec_batch',operationId,script,sessionId,agentId:ownerAgentId,nodeId:ctx.session.nodeId,
    timeoutMs:60000,waitMs:7000,requiredCapabilities,note:note||'Light Remote convenience tool'};
  const result=await callOperatorJson('POST','/v1/execute',sealOperatorPayload(payload));
  return {platform:ctx.device.platform,deviceId:ctx.device.deviceId,nodeId:ctx.device.nodeId,job:result.job};
}

function pathScript(platform,path){
  if(platform==='win32')return windowsDecode('p',path)+';';
  return linuxDecode('p',path)+';';
}
function contentScript(platform,content){
  if(platform==='win32')return windowsDecode('c',content)+';';
  return linuxDecode('c',content)+';';
}
async function platformFor(sessionId,ownerAgentId){return (await context(sessionId,ownerAgentId)).device.platform;}

export function registerConvenienceTools(server,tracked,identity){
  const baseInput={sessionId:id,agentId};
  server.registerTool('light_remote_read_text_file',{
    title:'Read remote text file',
    description:'Read a bounded line range from a UTF-8-ish text file on the selected session target.',
    inputSchema:{...baseInput,path:textPath,startLine:z.number().int().min(1).optional(),maxLines:z.number().int().min(1).max(400).optional()},
    annotations:ann(true,false,true)
  },tracked('light_remote_read_text_file',identity,async input=>{
    const platform=await platformFor(input.sessionId,input.agentId);
    const start=input.startLine||1, count=input.maxLines||200, end=start+count-1;
    const prefix=pathScript(platform,input.path);
    const script=platform==='win32'
      ? `${prefix} Get-Content -LiteralPath $p -Encoding UTF8 | Select-Object -Skip ${start-1} -First ${count}`
      : `${prefix} sed -n '${start},${end}p' -- "$p"`;
    return submit({sessionId:input.sessionId,agentId:input.agentId,operationId:`read-${crypto.randomUUID()}`,script,note:'read text file'});
  }));

  server.registerTool('light_remote_list_directory',{
    title:'List remote directory',
    description:'List one directory on the selected target, including hidden entries where the platform supports it.',
    inputSchema:{...baseInput,path:textPath,maxEntries:z.number().int().min(1).max(500).optional()},
    annotations:ann(true,false,true)
  },tracked('light_remote_list_directory',identity,async input=>{
    const platform=await platformFor(input.sessionId,input.agentId), max=input.maxEntries||200;
    const prefix=pathScript(platform,input.path);
    const script=platform==='win32'
      ? `${prefix} Get-ChildItem -LiteralPath $p -Force | Select-Object -First ${max} @{n='type';e={if($_.PSIsContainer){'dir'}else{'file'}}},Name,Length,LastWriteTime | ConvertTo-Json -Compress`
      : `${prefix} find "$p" -mindepth 1 -maxdepth 1 -printf '%y\t%s\t%f\n' | head -n ${max}`;
    return submit({sessionId:input.sessionId,agentId:input.agentId,operationId:`list-${crypto.randomUUID()}`,script,note:'list directory'});
  }));
  server.registerTool('light_remote_write_text_file',{
    title:'Write remote text file',
    description:'Rewrite or append UTF-8 text on the selected target. Supply a stable operationId so retries are idempotent.',
    inputSchema:{...baseInput,operationId:opId,path:textPath,content:z.string().max(700000),mode:z.enum(['rewrite','append']).optional()},
    annotations:ann(false,true,true)
  },tracked('light_remote_write_text_file',identity,async input=>{
    const platform=await platformFor(input.sessionId,input.agentId);
    const prefix=pathScript(platform,input.path)+contentScript(platform,input.content);
    let script;
    if(platform==='win32'){
      script=input.mode==='append'
        ? `${prefix} [IO.File]::AppendAllText($p,$c,[Text.UTF8Encoding]::new($false))`
        : `${prefix} [IO.File]::WriteAllText($p,$c,[Text.UTF8Encoding]::new($false))`;
    } else {
      script=input.mode==='append' ? `${prefix} printf '%s' "$c" >> "$p"` : `${prefix} printf '%s' "$c" > "$p"`;
    }
    return submit({sessionId:input.sessionId,agentId:input.agentId,operationId:input.operationId,script,note:'write text file'});
  }));

  server.registerTool('light_remote_search_text',{
    title:'Search remote text files',
    description:'Literal recursive text search under one path. Results are bounded.',
    inputSchema:{...baseInput,path:textPath,query:z.string().min(1).max(512),maxResults:z.number().int().min(1).max(200).optional()},
    annotations:ann(true,false,true)
  },tracked('light_remote_search_text',identity,async input=>{
    const platform=await platformFor(input.sessionId,input.agentId), max=input.maxResults||80;
    const prefix=pathScript(platform,input.path)+contentScript(platform,input.query);
    const script=platform==='win32'
      ? `${prefix} Get-ChildItem -LiteralPath $p -Recurse -File -ErrorAction SilentlyContinue | Select-String -SimpleMatch -Pattern $c | Select-Object -First ${max} | ForEach-Object { '{0}:{1}:{2}' -f $_.Path,$_.LineNumber,$_.Line.Trim() }`
      : `${prefix} grep -RInF -- "$c" "$p" 2>/dev/null | head -n ${max}`;
    return submit({sessionId:input.sessionId,agentId:input.agentId,operationId:`search-${crypto.randomUUID()}`,script,note:'search text'});
  }));

  server.registerTool('light_remote_process_list',{
    title:'List remote processes',
    description:'List a bounded process snapshot on the selected target.',
    inputSchema:{...baseInput,limit:z.number().int().min(1).max(200).optional()},
    annotations:ann(true,false,true)
  },tracked('light_remote_process_list',identity,async input=>{
    const platform=await platformFor(input.sessionId,input.agentId), limit=input.limit||80;
    const script=platform==='win32'
      ? `Get-Process | Sort-Object CPU -Descending | Select-Object -First ${limit} Id,ProcessName,CPU,WorkingSet | Format-Table -AutoSize | Out-String -Width 240`
      : `ps -eo pid,ppid,user,stat,comm,args --sort=-%cpu | head -n ${limit+1}`;
    const caps=platform==='win32'?['filesystem','powershell','windows-process-network']:['filesystem'];
    return submit({sessionId:input.sessionId,agentId:input.agentId,operationId:`process-${crypto.randomUUID()}`,script,requiredCapabilities:caps,note:'list processes'});
  }));
  server.registerTool('light_remote_kill_process',{
    title:'Terminate remote process',
    description:'Request termination of one process ID on the selected target. This is destructive and remains subject to OS permissions/device policy.',
    inputSchema:{...baseInput,operationId:opId,pid:z.number().int().min(1),force:z.boolean().optional()},
    annotations:ann(false,true,true)
  },tracked('light_remote_kill_process',identity,async input=>{
    const platform=await platformFor(input.sessionId,input.agentId);
    const script=platform==='win32'
      ? `Stop-Process -Id ${input.pid}${input.force?' -Force':''} -ErrorAction Stop`
      : `kill ${input.force?'-KILL':'-TERM'} -- ${input.pid}`;
    const caps=platform==='win32'?['filesystem','powershell','windows-process-network']:['filesystem'];
    return submit({sessionId:input.sessionId,agentId:input.agentId,operationId:input.operationId,script,requiredCapabilities:caps,note:'terminate process'});
  }));
}
