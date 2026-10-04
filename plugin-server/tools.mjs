import { z } from 'zod';
import { AccountOperatorAdapter } from './operator-adapter.mjs';
import { mintPairingContinuation, requireScopes, verifyPairingContinuation } from './oauth.mjs';
import { redactRestrictedText, sanitizeForMcp } from './response-sanitizer.mjs';

const id=z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/);
const opId=z.string().regex(/^[A-Za-z0-9._:-]{16,160}$/).optional();
const pathText=z.string().min(1).max(4096);
const jsonObject=z.record(z.string(),z.any());
const security=scopes=>[{type:'oauth2',scopes:[...scopes]}];
const annotations=(readOnly=false,destructive=false,openWorld=false,idempotent=false)=>({readOnlyHint:readOnly,destructiveHint:destructive,openWorldHint:openWorld,idempotentHint:idempotent});

export const PLUGIN_TOOL_SECURITY=Object.create(null);

function add(server,name,config,callback){
  const schemes=config.securitySchemes||[];
  PLUGIN_TOOL_SECURITY[name]=schemes.map(row=>({...row,scopes:[...(row.scopes||[])]}));
  return server.registerTool(name,config,callback);
}
function result(value){
  const safe=sanitizeForMcp(value);
  const structured=Array.isArray(safe)?{items:safe}:safe&&typeof safe==='object'?safe:{value:safe};
  return {content:[{type:'text',text:JSON.stringify(safe,null,2)}],structuredContent:structured};
}
function operationView(row){
  return {ok:Boolean(row?.ok),data:row?.data??null,job:row?.job?{jobId:row.job.jobId,state:row.job.state||row.job.status||null,running:!row.job.finishedAt,exitCode:row.job.exitCode??null}:null};
}
function guarded(identity,scopes,fn){
  return async(input={})=>{
    const denied=requireScopes(identity,scopes);
    if(denied)return denied;
    try{return result(await fn(new AccountOperatorAdapter(identity),input));}
    catch(error){return {content:[{type:'text',text:redactRestrictedText(error?.message||'Light Remote operation failed.')}],isError:true};}
  };
}
function pick(source,keys){const out={};for(const key of keys)if(source[key]!==undefined)out[key]=source[key];return out;}

export function registerPluginTools(server,identity){
  add(server,'light_remote_connection_helper',{
    title:'Connect Light Remote with A/B approval',
    description:'Start here. Handles Local Wall A/B pairing and, when ready, returns/reuses the working context plus a compact tool-family menu. Call again with helperGroup=workspace|files|shell|transfer|desktop only when detailed syntax for that family is needed. OAuth account login alone never authorizes a device.',
    inputSchema:{aCode:z.string().regex(/^[A-Za-z2-9]{4}-?[A-Za-z2-9]{4}$/).optional(),continuation:z.string().min(20).max(8192).optional(),label:z.string().min(1).max(120).optional(),helperGroup:z.enum(['workspace','files','shell','transfer','desktop']).optional()},
    securitySchemes:security(['remote:read']),annotations:annotations(false,false,false,false)
  },guarded(identity,['remote:read'],async(a,x)=>{
    if(x.aCode&&x.continuation)throw new Error('pairing_input_conflict');
    if(x.helperGroup&&(x.aCode||x.continuation))throw new Error('helper_group_pairing_conflict');
    if(x.aCode){
      const pending=await a.pairBegin(x.aCode,x.label||'ChatGPT'),continuation=await mintPairingContinuation(identity,{requestId:pending.requestId,pollToken:pending.pollToken,agentId:a.agentId,expiresAt:pending.expiresAt});
      return {status:'approval_required',code:pending.userCode,continuation,expiresInSeconds:Math.max(0,Math.ceil((Number(pending.expiresAt)-Date.now())/1000)),approvalPath:'/approve'};
    }
    if(x.continuation){
      const ctx=await verifyPairingContinuation(identity,x.continuation);if(ctx.agentId!==a.agentId)throw new Error('pairing_continuation_agent_mismatch');
      const paired=await a.pairPoll(ctx);
      if(paired.state!=='approved')return {status:'approval_required',continuation:x.continuation,expiresInSeconds:Math.max(0,Math.ceil((Number(paired.request?.expiresAt||Date.now())-Date.now())/1000)),approvalPath:'/approve'};
      const helper=await a.connectionHelper();return {...helper,status:'ready',pairedDevice:paired.device?.displayName||paired.device?.deviceId||null};
    }
    return a.connectionHelper(x.helperGroup||null);
  }));

  add(server,'light_remote_list_devices',{
    title:'List A/B-authorized Light Remote devices',
    description:'List only devices that this plugin client has explicitly paired through Local Wall A/B approval. Targeting remains explicit; no silent fallback.',
    securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],a=>a.devices()));

  add(server,'light_remote_context',{
    title:'Recover or change the working Light Remote context',
    description:'Reuse or create the durable working session for one A/B-authorized device, optionally changing workspace or grace. Never silently switches to an unauthorized target.',
    inputSchema:{deviceId:id.optional(),workspace:z.string().max(512).optional(),gracePreset:z.enum(['15m','30m','45m','60m']).optional()},
    securitySchemes:security(['remote:write']),annotations:annotations(false,false,false,true)
  },guarded(identity,['remote:write'],(a,x)=>a.workingContext(x)));

  add(server,'light_remote_inspect_device',{
    title:'Inspect a Light Remote device',
    description:'Read policy, connection, routing, Main/Fleet, update and capability state for one owned device.',
    inputSchema:{deviceId:id},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>a.inspectDevice(x.deviceId)));

  add(server,'light_remote_recent_activity',{
    title:'Read recent device activity',
    description:'Read a sanitized recent activity view for one owned device.',
    inputSchema:{deviceId:id,limit:z.number().int().min(1).max(200).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>a.recentActivity(x.deviceId,x.limit)));

  add(server,'light_remote_set_main_device',{
    title:'Set the Main device',
    description:'Select an owned online device as Main and move current Fleet authority to it.',
    inputSchema:{deviceId:id},securitySchemes:security(['remote:write']),annotations:annotations(false,false,false,true)
  },guarded(identity,['remote:write'],(a,x)=>a.setMainDevice(x.deviceId)));

  add(server,'light_remote_revoke_device',{
    title:'Revoke a device',
    description:'Revoke remote authority for an owned non-integrated device. Requires explicit user intent.',
    inputSchema:{deviceId:id,confirm:z.literal(true),reason:z.string().max(120).optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:write'],(a,x)=>a.revokeDevice(x.deviceId,x.reason)));

  add(server,'light_remote_remove_device',{
    title:'Remove a device',
    description:'Permanently remove an owned device enrollment record. Re-enrollment requires local A/B approval again.',
    inputSchema:{deviceId:id,confirm:z.literal(true),reason:z.string().max(120).optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:write'],(a,x)=>a.removeDevice(x.deviceId,x.reason)));

  add(server,'light_remote_open_session',{
    title:'Open or reuse a durable session',
    description:'Bind work to one explicit owned device and this MCP client.',
    inputSchema:{deviceId:id,openId:z.string().regex(/^[A-Za-z0-9._:-]{16,160}$/).optional(),workspace:z.string().max(512).optional(),gracePreset:z.enum(['15m','30m','45m','60m']).optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,false,false,true)
  },guarded(identity,['remote:write'],(a,x)=>a.openSession(x)));

  add(server,'light_remote_list_sessions',{
    title:'List durable sessions',
    description:'List account-scoped sessions owned by this MCP connection for recovery and continuation. Supply sessionId to read one exact session.',
    inputSchema:{sessionId:id.optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>x.sessionId?a.session(x.sessionId):a.sessions()));

  add(server,'light_remote_session_control',{
    title:'Resume or hold a durable session',
    description:'Resume an existing durable session or explicitly place it on hold during a transport interruption.',
    inputSchema:{sessionId:id,operation:z.enum(['resume','hold']),reason:z.string().max(80).optional()},
    securitySchemes:security(['remote:write']),annotations:annotations(false,false,false,true)
  },guarded(identity,['remote:write'],(a,x)=>x.operation==='resume'?a.resumeSession(x.sessionId):a.holdSession(x.sessionId,x.reason)));

  add(server,'light_remote_close_session',{
    title:'Close a durable session',
    description:'Close one session after work is complete.',
    inputSchema:{sessionId:id},securitySchemes:security(['remote:write']),annotations:annotations(false,false,false,true)
  },guarded(identity,['remote:write'],(a,x)=>a.closeSession(x.sessionId)));

  add(server,'light_remote_list_files',{
    title:'List remote files',
    description:'List an allowed directory on the selected session target.',
    inputSchema:{sessionId:id,path:pathText,maxEntries:z.number().int().min(1).max(1000).optional(),maxDepth:z.number().int().min(0).max(3).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],async(a,x)=>operationView(await a.fs(x.sessionId,{op:'list',path:x.path,maxEntries:x.maxEntries,maxDepth:x.maxDepth||0}))));

  add(server,'light_remote_read_file',{
    title:'Read a remote text file',
    description:'Read a bounded text range from an allowed path.',
    inputSchema:{sessionId:id,path:pathText,startLine:z.number().int().min(1).optional(),maxLines:z.number().int().min(1).max(5000).optional(),tailLines:z.number().int().min(1).max(5000).optional(),maxBytes:z.number().int().min(1).max(8_000_000).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],async(a,x)=>operationView(await a.fs(x.sessionId,{op:'read',path:x.path,startLine:x.startLine,maxLines:x.maxLines,tailLines:x.tailLines,maxBytes:x.maxBytes}))));

  add(server,'light_remote_search_files',{
    title:'Search remote files',
    description:'Start, read, or cancel bounded native file-name/content search.',
    inputSchema:{sessionId:id,operation:z.enum(['start','results','cancel']),operationId:opId,path:pathText.optional(),searchId:z.string().max(160).optional(),searchType:z.enum(['content','files']).optional(),pattern:z.string().max(4096).optional(),literalSearch:z.boolean().optional(),ignoreCase:z.boolean().optional(),filePattern:z.string().max(1024).optional(),contextLines:z.number().int().min(0).max(20).optional(),maxResults:z.number().int().min(1).max(1000).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(500).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,false)
  },guarded(identity,['remote:read'],async(a,x)=>{
    const search=x.operation==='start'?{op:'start',path:x.path,searchType:x.searchType||'content',pattern:x.pattern,literalSearch:Boolean(x.literalSearch),ignoreCase:x.ignoreCase!==false,filePattern:x.filePattern||'',contextLines:x.contextLines||0,maxResults:x.maxResults||200}:x.operation==='results'?{op:'results',searchId:x.searchId,offset:x.offset||0,limit:x.limit||100}:{op:'cancel',searchId:x.searchId};
    return operationView(await a.search(x.sessionId,search,x.operationId));
  }));

  add(server,'light_remote_read_multiple_files',{
    title:'Read multiple remote text files',
    description:'Read bounded text from multiple allowed files in one structured read-only operation.',
    inputSchema:{sessionId:id,paths:z.array(pathText).min(1).max(100),maxLines:z.number().int().min(1).max(5000).optional(),maxBytesPerFile:z.number().int().min(1).max(8_000_000).optional()},
    securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],async(a,x)=>operationView(await a.fs(x.sessionId,{op:'readMany',paths:x.paths,maxLines:x.maxLines,maxBytesPerFile:x.maxBytesPerFile}))));

  add(server,'light_remote_stat_path',{
    title:'Stat a remote path',
    description:'Read bounded metadata for one allowed path without requiring write scope.',
    inputSchema:{sessionId:id,path:pathText},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],async(a,x)=>operationView(await a.fs(x.sessionId,{op:'stat',path:x.path}))));

  add(server,'light_remote_filesystem',{
    title:'Perform a structured filesystem operation',
    description:'Use structured filesystem operations instead of shell commands. Device allowed roots and policy remain final deny boundaries.',
    inputSchema:{sessionId:id,operationId:opId,operation:z.enum(['mkdir','copy','move','delete']),path:pathText.optional(),source:pathText.optional(),destination:pathText.optional(),parents:z.boolean().optional(),recursive:z.boolean().optional(),overwrite:z.boolean().optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:write'],async(a,x)=>{
    const fs={op:x.operation};
    Object.assign(fs,pick(x,['path','source','destination','parents','recursive','overwrite']));
    return operationView(await a.fs(x.sessionId,fs,x.operationId));
  }));

  add(server,'light_remote_write_file',{
    title:'Write a remote text file',
    description:'Rewrite or append text on an allowed path.',
    inputSchema:{sessionId:id,operationId:opId,path:pathText,content:z.string().max(8_000_000),mode:z.enum(['rewrite','append']).optional(),createParents:z.boolean().optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:write'],async(a,x)=>operationView(await a.fs(x.sessionId,{op:'write',path:x.path,content:x.content,mode:x.mode||'rewrite',atomic:true,createParents:Boolean(x.createParents)},x.operationId))));

  add(server,'light_remote_edit_file',{
    title:'Edit an exact remote text block',
    description:'Replace an exact text block and fail if the expected replacement count is not met.',
    inputSchema:{sessionId:id,operationId:opId,path:pathText,oldText:z.string().min(1).max(4_000_000),newText:z.string().max(4_000_000),expectedReplacements:z.number().int().min(1).max(100).optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:write'],async(a,x)=>operationView(await a.fs(x.sessionId,{op:'edit',path:x.path,oldText:x.oldText,newText:x.newText,expectedReplacements:x.expectedReplacements||1},x.operationId))));

  add(server,'light_remote_exec',{
    title:'Execute one bounded remote command job',
    description:'Run one logical shell/PowerShell job. Prefer structured tools first; device policy re-infers capabilities before spawn.',
    inputSchema:{sessionId:id,operationId:opId,script:z.string().min(1).max(1_000_000),shell:z.string().max(80).optional(),cwd:pathText.optional(),timeoutMs:z.number().int().min(1000).max(7_200_000).optional(),waitMs:z.number().int().min(0).max(7000).optional(),requiredCapabilities:z.array(z.string().min(1).max(80)).max(32).optional()},securitySchemes:security(['remote:execute']),annotations:annotations(false,true,true,false)
  },guarded(identity,['remote:execute'],async(a,x)=>operationView(await a.exec(x.sessionId,x.script,{shell:x.shell,cwd:x.cwd,operationId:x.operationId,timeoutMs:x.timeoutMs,waitMs:x.waitMs,requiredCapabilities:x.requiredCapabilities}))));

  add(server,'light_remote_process',{
    title:'Control a managed remote process',
    description:'Start or control a persistent non-PTY process with explicit stdin/stdout lifecycle.',
    inputSchema:{sessionId:id,operation:z.enum(['start','input','output','list','stop']),operationId:opId,processId:z.string().max(160).optional(),script:z.string().max(1_000_000).optional(),shell:z.string().max(80).optional(),cwd:pathText.optional(),data:z.string().max(1_048_576).optional(),eof:z.boolean().optional(),stream:z.enum(['stdout','stderr']).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1_048_576).optional(),force:z.boolean().optional(),timeoutMs:z.number().int().min(0).max(86_400_000).optional(),requiredCapabilities:z.array(z.string().min(1).max(80)).max(32).optional()},securitySchemes:security(['remote:execute']),annotations:annotations(false,true,true,false)
  },guarded(identity,['remote:execute'],async(a,x)=>{
    const process=x.operation==='start'?{op:'start',script:x.script,shell:x.shell,cwd:x.cwd,timeoutMs:x.timeoutMs,requiredCapabilities:x.requiredCapabilities}:x.operation==='input'?{op:'input',processId:x.processId,data:x.data||'',eof:Boolean(x.eof)}:x.operation==='output'?{op:'output',processId:x.processId,stream:x.stream||'stdout',offset:x.offset||0,limit:x.limit||262144}:x.operation==='list'?{op:'list'}:{op:'stop',processId:x.processId,force:Boolean(x.force)};
    return operationView(await a.process(x.sessionId,process,x.operationId));
  }));

  add(server,'light_remote_terminal',{
    title:'Control a real PTY/ConPTY terminal',
    description:'Use for interactive programs, persistent shells, Ctrl-C, resize, and terminal input. Local policy remains authoritative.',
    inputSchema:{sessionId:id,operation:z.enum(['start','input','output','resize','signal','list','stop']),operationId:opId,terminalId:z.string().max(160).optional(),shell:z.string().max(80).optional(),cwd:pathText.optional(),term:z.string().max(64).optional(),data:z.string().max(1_048_576).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1_048_576).optional(),cols:z.number().int().min(20).max(500).optional(),rows:z.number().int().min(5).max(200).optional(),signal:z.enum(['interrupt','terminate','kill']).optional(),force:z.boolean().optional()},securitySchemes:security(['remote:terminal']),annotations:annotations(false,true,true,false)
  },guarded(identity,['remote:terminal'],async(a,x)=>{
    const terminal={op:x.operation};Object.assign(terminal,pick(x,['terminalId','shell','cwd','term','data','offset','limit','cols','rows','signal','force']));
    return operationView(await a.terminal(x.sessionId,terminal,x.operationId));
  }));

  add(server,'light_remote_scp_download',{
    title:'Download a large or binary file',
    description:'Use the resumable Light SCP read plane. Download chunks and whole-file integrity are SHA-256 verified.',
    inputSchema:{sessionId:id,operationId:opId,operation:z.enum(['download-begin','download-chunk','status','cancel']),transferId:z.string().max(160).optional(),source:pathText.optional(),chunkBytes:z.number().int().min(64*1024).max(4*1024*1024).optional(),index:z.number().int().min(0).optional()},
    securitySchemes:security(['remote:read']),annotations:annotations(false,false,false,false)
  },guarded(identity,['remote:read'],async(a,x)=>{
    const scp={op:x.operation};Object.assign(scp,pick(x,['transferId','source','chunkBytes','index']));
    return operationView(await a.scp(x.sessionId,scp,x.operationId));
  }));

  add(server,'light_remote_scp',{
    title:'Upload a large or binary file',
    description:'Use the resumable Light SCP upload plane for binary/large files. Upload integrity is verified by SHA-256 and requires remote:write.',
    inputSchema:{sessionId:id,operationId:opId,operation:z.enum(['upload-begin','upload-chunk','upload-commit','status','cancel']),transferId:z.string().max(160).optional(),destination:pathText.optional(),source:pathText.optional(),totalBytes:z.number().int().min(0).optional(),sha256:z.string().regex(/^[a-f0-9]{64}$/i).optional(),chunkBytes:z.number().int().min(64*1024).max(4*1024*1024).optional(),index:z.number().int().min(0).optional(),data:z.string().max(6_000_000).optional(),overwrite:z.boolean().optional(),createParents:z.boolean().optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:write'],async(a,x)=>{
    const scp={op:x.operation};Object.assign(scp,pick(x,['transferId','destination','totalBytes','sha256','chunkBytes','index','data','overwrite','createParents']));
    return operationView(await a.scp(x.sessionId,scp,x.operationId));
  }));

  add(server,'light_remote_desktop',{
    title:'Observe the remote desktop',
    description:'Read the authorized remote desktop using semantic snapshots, events, windows, and frames. Prefer live semantic updates; use a full frame only for bootstrap or resync.',
    inputSchema:{sessionId:id,operationId:opId,operation:z.enum(['status','attach','resume','detach','windows','frame','observe','semantic-attach','semantic-snapshot','semantic-events','semantic-detach','live-open','live-close']),desktopSessionId:z.string().max(160).optional(),semanticSessionId:z.string().max(160).optional(),afterSeq:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1000).optional(),screen:z.number().int().min(-1).max(31).optional(),maxWidth:z.number().int().min(64).max(7680).optional(),maxHeight:z.number().int().min(64).max(4320).optional(),quality:z.number().int().min(1).max(100).optional(),minIntervalMs:z.number().int().min(0).max(5000).optional(),omitUnchanged:z.boolean().optional(),idleTimeoutMs:z.number().int().min(250).max(900000).optional(),provider:z.enum(['windows-uia','browser-cdp']).optional(),scope:z.string().max(160).optional(),cdpEndpoint:z.string().max(256).optional(),targetId:z.string().max(256).optional(),urlMatch:z.string().max(512).optional(),maxDepth:z.number().int().min(1).max(64).optional(),maxNodes:z.number().int().min(1).max(20000).optional(),waitMs:z.number().int().min(0).max(7000).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,false)
  },guarded(identity,['remote:read'],async(a,x)=>{
    const desktop={op:x.operation};Object.assign(desktop,pick(x,['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes']));
    return operationView(await a.desktop(x.sessionId,desktop,x.operationId,x.waitMs));
  }));

  add(server,'light_remote_desktop_live_read',{
    title:'Read buffered Real Remote V2 live state',
    description:'Read already-buffered semantic deltas/snapshot from the Hub cache without dispatching a new Windows observation job.',
    inputSchema:{sessionId:id,semanticSessionId:z.string().min(1).max(160),afterSeq:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1000).optional(),includeSnapshot:z.boolean().optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>a.desktopLiveRead(x.sessionId,x)));

  add(server,'light_remote_desktop_input',{
    title:'Control the real desktop through Real Remote V2',
    description:'Perform bounded semantic action, OS input batch, or action-and-await run. Requires target desktop and desktop-input capability; Windows security boundaries remain in force.',
    inputSchema:{sessionId:id,operationId:opId,operation:z.enum(['act','input','run']),semanticSessionId:z.string().max(160).optional(),nodeId:z.string().max(512).optional(),action:z.string().max(80).optional(),value:z.any().optional(),events:z.array(jsonObject).max(128).optional(),displayTopologyId:z.string().max(160).optional(),afterSeq:z.number().int().min(0).optional(),settleMs:z.number().int().min(0).max(15000).optional(),await:z.object({foregroundTitleContains:z.string().max(512).optional(),foregroundTitleEquals:z.string().max(512).optional(),focusedNameContains:z.string().max(512).optional(),timeoutMs:z.number().int().min(50).max(15000).optional()}).optional(),waitMs:z.number().int().min(0).max(7000).optional()},securitySchemes:security(['remote:execute']),annotations:annotations(false,true,true,false)
  },guarded(identity,['remote:execute'],async(a,x)=>{
    const desktop={op:x.operation};Object.assign(desktop,pick(x,['semanticSessionId','nodeId','action','value','events','displayTopologyId','afterSeq','settleMs','await']));
    return operationView(await a.desktop(x.sessionId,desktop,x.operationId,x.waitMs));
  }));

  add(server,'light_remote_job',{
    title:'Read durable job status',
    description:'Read an existing job instead of repeating an operation.',
    inputSchema:{jobId:id},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>a.job(x.jobId)));

  add(server,'light_remote_output',{
    title:'Read durable job output',
    description:'Read bounded stdout/stderr by byte offset.',
    inputSchema:{jobId:id,stream:z.enum(['stdout','stderr']).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(8_388_608).optional(),full:z.boolean().optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>a.output(x.jobId,x.stream,x.offset,x.limit,x.full)));
}
