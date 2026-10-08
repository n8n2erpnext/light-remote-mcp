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

async function searchOperation(a,x,operation){
  const search=operation==='start'
    ?{op:'start',path:x.path,searchType:x.searchType||'content',pattern:x.pattern,literalSearch:Boolean(x.literalSearch),ignoreCase:x.ignoreCase!==false,filePattern:x.filePattern||'',contextLines:x.contextLines||0,maxResults:x.maxResults||200}
    :operation==='results'
      ?{op:'results',searchId:x.searchId,offset:x.offset||0,limit:x.limit||100}
      :{op:'cancel',searchId:x.searchId};
  return operationView(await a.search(x.sessionId,search,x.operationId));
}
async function filesystemOperation(a,x,operation){
  const fs={op:operation};Object.assign(fs,pick(x,['path','source','destination','parents','recursive','overwrite']));
  return operationView(await a.fs(x.sessionId,fs,x.operationId));
}
async function processOperation(a,x,operation){
  const process=operation==='start'
    ?{op:'start',script:x.script,shell:x.shell,cwd:x.cwd,timeoutMs:x.timeoutMs,requiredCapabilities:x.requiredCapabilities}
    :operation==='input'
      ?{op:'input',processId:x.processId,data:x.data||'',eof:Boolean(x.eof)}
      :operation==='output'
        ?{op:'output',processId:x.processId,stream:x.stream||'stdout',offset:x.offset||0,limit:x.limit||262144}
        :operation==='list'?{op:'list'}:{op:'stop',processId:x.processId,force:Boolean(x.force)};
  return operationView(await a.process(x.sessionId,process,x.operationId));
}
async function terminalOperation(a,x,operation){
  const terminal={op:operation};Object.assign(terminal,pick(x,['terminalId','shell','cwd','term','data','offset','limit','cols','rows','signal','force']));
  return operationView(await a.terminal(x.sessionId,terminal,x.operationId));
}
async function scpOperation(a,x,operation,fields){
  const scp={op:operation};Object.assign(scp,pick(x,fields));
  return operationView(await a.scp(x.sessionId,scp,x.operationId));
}
async function desktopOperation(a,x,operation,fields){
  const desktop={op:operation};Object.assign(desktop,pick(x,fields));
  return operationView(await a.desktop(x.sessionId,desktop,x.operationId,x.waitMs));
}

const legacySchemas={
  light_remote_session_control:z.object({sessionId:id,operation:z.enum(['resume','hold']),reason:z.string().max(80).optional()}),
  light_remote_search_files:z.object({sessionId:id,operation:z.enum(['start','results','cancel']),operationId:opId,path:pathText.optional(),searchId:z.string().max(160).optional(),searchType:z.enum(['content','files']).optional(),pattern:z.string().max(4096).optional(),literalSearch:z.boolean().optional(),ignoreCase:z.boolean().optional(),filePattern:z.string().max(1024).optional(),contextLines:z.number().int().min(0).max(20).optional(),maxResults:z.number().int().min(1).max(1000).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(500).optional()}),
  light_remote_filesystem:z.object({sessionId:id,operationId:opId,operation:z.enum(['mkdir','copy','move','delete']),path:pathText.optional(),source:pathText.optional(),destination:pathText.optional(),parents:z.boolean().optional(),recursive:z.boolean().optional(),overwrite:z.boolean().optional()}),
  light_remote_process:z.object({sessionId:id,operation:z.enum(['start','input','output','list','stop']),operationId:opId,processId:z.string().max(160).optional(),script:z.string().max(1_000_000).optional(),shell:z.string().max(80).optional(),cwd:pathText.optional(),data:z.string().max(1_048_576).optional(),eof:z.boolean().optional(),stream:z.enum(['stdout','stderr']).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1_048_576).optional(),force:z.boolean().optional(),timeoutMs:z.number().int().min(0).max(86_400_000).optional(),requiredCapabilities:z.array(z.string().min(1).max(80)).max(32).optional()}),
  light_remote_terminal:z.object({sessionId:id,operation:z.enum(['start','input','output','resize','signal','list','stop']),operationId:opId,terminalId:z.string().max(160).optional(),shell:z.string().max(80).optional(),cwd:pathText.optional(),term:z.string().max(64).optional(),data:z.string().max(1_048_576).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1_048_576).optional(),cols:z.number().int().min(20).max(500).optional(),rows:z.number().int().min(5).max(200).optional(),signal:z.enum(['interrupt','terminate','kill']).optional(),force:z.boolean().optional()}),
  light_remote_scp_download:z.object({sessionId:id,operationId:opId,operation:z.enum(['download-begin','download-chunk','status','cancel']),transferId:z.string().max(160).optional(),source:pathText.optional(),chunkBytes:z.number().int().min(64*1024).max(4*1024*1024).optional(),index:z.number().int().min(0).optional()}),
  light_remote_scp:z.object({sessionId:id,operationId:opId,operation:z.enum(['upload-begin','upload-chunk','upload-commit','status','cancel']),transferId:z.string().max(160).optional(),destination:pathText.optional(),source:pathText.optional(),totalBytes:z.number().int().min(0).optional(),sha256:z.string().regex(/^[a-f0-9]{64}$/i).optional(),chunkBytes:z.number().int().min(64*1024).max(4*1024*1024).optional(),index:z.number().int().min(0).optional(),data:z.string().max(6_000_000).optional(),overwrite:z.boolean().optional(),createParents:z.boolean().optional()}),
  light_remote_desktop:z.object({sessionId:id,operationId:opId,operation:z.enum(['status','attach','resume','detach','windows','frame','observe','semantic-attach','semantic-snapshot','semantic-events','semantic-detach','live-open','live-close']),desktopSessionId:z.string().max(160).optional(),semanticSessionId:z.string().max(160).optional(),afterSeq:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1000).optional(),screen:z.number().int().min(-1).max(31).optional(),maxWidth:z.number().int().min(64).max(7680).optional(),maxHeight:z.number().int().min(64).max(4320).optional(),quality:z.number().int().min(1).max(100).optional(),minIntervalMs:z.number().int().min(0).max(5000).optional(),omitUnchanged:z.boolean().optional(),idleTimeoutMs:z.number().int().min(250).max(900000).optional(),provider:z.enum(['windows-uia','browser-cdp']).optional(),scope:z.string().max(160).optional(),cdpEndpoint:z.string().max(256).optional(),targetId:z.string().max(256).optional(),urlMatch:z.string().max(512).optional(),maxDepth:z.number().int().min(1).max(64).optional(),maxNodes:z.number().int().min(1).max(20000).optional(),waitMs:z.number().int().min(0).max(7000).optional()}),
  light_remote_desktop_input:z.object({sessionId:id,operationId:opId,operation:z.enum(['act','input','run']),semanticSessionId:z.string().max(160).optional(),nodeId:z.string().max(512).optional(),action:z.string().max(80).optional(),value:z.any().optional(),events:z.array(jsonObject).max(128).optional(),displayTopologyId:z.string().max(160).optional(),afterSeq:z.number().int().min(0).optional(),settleMs:z.number().int().min(0).max(15000).optional(),await:z.object({foregroundTitleContains:z.string().max(512).optional(),foregroundTitleEquals:z.string().max(512).optional(),focusedNameContains:z.string().max(512).optional(),timeoutMs:z.number().int().min(50).max(15000).optional()}).optional(),waitMs:z.number().int().min(0).max(7000).optional()})
};
const legacyScopes={
  light_remote_session_control:['remote:write'],light_remote_search_files:['remote:read'],light_remote_filesystem:['remote:write'],
  light_remote_process:['remote:execute'],light_remote_terminal:['remote:terminal'],light_remote_scp_download:['remote:read'],
  light_remote_scp:['remote:write'],light_remote_desktop:['remote:read'],light_remote_desktop_input:['remote:execute']
};
export const LEGACY_MULTIPLEXED_TOOL_NAMES=new Set(Object.keys(legacySchemas));
export async function callLegacyMultiplexedTool(identity,name,input={}){
  const schema=legacySchemas[name];if(!schema||!input||typeof input.operation!=='string')return null;
  const parsed=schema.safeParse(input);
  if(!parsed.success)return {content:[{type:'text',text:'Invalid legacy Light Remote tool arguments.'}],isError:true};
  const x=parsed.data,denied=requireScopes(identity,legacyScopes[name]||[]);
  if(denied)return denied;
  try{
    const a=new AccountOperatorAdapter(identity);let value;
    if(name==='light_remote_session_control')value=x.operation==='resume'?await a.resumeSession(x.sessionId):await a.holdSession(x.sessionId,x.reason);
    else if(name==='light_remote_search_files')value=await searchOperation(a,x,x.operation);
    else if(name==='light_remote_filesystem')value=await filesystemOperation(a,x,x.operation);
    else if(name==='light_remote_process')value=await processOperation(a,x,x.operation);
    else if(name==='light_remote_terminal')value=await terminalOperation(a,x,x.operation);
    else if(name==='light_remote_scp_download')value=await scpOperation(a,x,x.operation,['transferId','source','chunkBytes','index']);
    else if(name==='light_remote_scp')value=await scpOperation(a,x,x.operation,['transferId','destination','totalBytes','sha256','chunkBytes','index','data','overwrite','createParents']);
    else if(name==='light_remote_desktop')value=await desktopOperation(a,x,x.operation,['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes']);
    else if(name==='light_remote_desktop_input')value=await desktopOperation(a,x,x.operation,['semanticSessionId','nodeId','action','value','events','displayTopologyId','afterSeq','settleMs','await']);
    else return null;
    return result(value);
  }catch(error){return {content:[{type:'text',text:redactRestrictedText(error?.message||'Light Remote operation failed.')}],isError:true};}
}

export function registerPluginTools(server,identity){
  add(server,'light_remote_connection_helper',{
    title:'Connect Light Remote with A/B approval',
    description:'Start here. Handles Local Wall A/B pairing and, when ready, returns/reuses the working context plus a compact tool-family menu. After the owner approves the B code, call this helper again with no A code; the server recovers the in-progress pairing for this exact account and agent. Never reuse an A code. The continuation argument remains supported for backward compatibility. Call again with helperGroup=workspace|files|shell|transfer|desktop only when detailed syntax for that family is needed. OAuth account login alone never authorizes a device.',
    inputSchema:{aCode:z.string().regex(/^[A-Za-z2-9]{4}-?[A-Za-z2-9]{4}$/).optional(),continuation:z.string().min(20).max(8192).optional(),label:z.string().min(1).max(120).optional(),helperGroup:z.enum(['workspace','files','shell','transfer','desktop']).optional()},
    securitySchemes:security(['remote:read']),annotations:annotations(false,false,false,false)
  },guarded(identity,['remote:read'],async(a,x)=>{
    if(x.aCode&&x.continuation)throw new Error('pairing_input_conflict');
    if(x.helperGroup&&(x.aCode||x.continuation))throw new Error('helper_group_pairing_conflict');
    if(x.aCode){
      const pending=await a.pairBegin(x.aCode,x.label||'ChatGPT'),continuation=await mintPairingContinuation(identity,{requestId:pending.requestId,pollToken:pending.pollToken,agentId:a.agentId,expiresAt:pending.expiresAt});
      return {status:'approval_required',code:pending.userCode,continuation,resumeMode:'call_same_helper_without_arguments',expiresInSeconds:Math.max(0,Math.ceil((Number(pending.expiresAt)-Date.now())/1000)),approvalPath:'/approve'};
    }
    if(x.continuation){
      const ctx=await verifyPairingContinuation(identity,x.continuation);if(ctx.agentId!==a.agentId)throw new Error('pairing_continuation_agent_mismatch');
      const paired=await a.pairPoll(ctx);
      if(paired.state!=='approved')return {status:'approval_required',continuation:x.continuation,resumeMode:'call_same_helper_without_arguments',expiresInSeconds:Math.max(0,Math.ceil((Number(paired.request?.expiresAt||Date.now())-Date.now())/1000)),approvalPath:'/approve'};
      const helper=await a.connectionHelper();return {...helper,status:'ready',pairedDevice:paired.device?.displayName||paired.device?.deviceId||null};
    }
    if(!x.helperGroup){
      const recovered=await a.pairRecover();
      if(recovered?.state==='pending')return {status:'approval_required',code:recovered.request?.userCode||null,resumeMode:'call_same_helper_without_arguments',expiresInSeconds:Math.max(0,Math.ceil((Number(recovered.request?.expiresAt||Date.now())-Date.now())/1000)),approvalPath:'/approve'};
      if(recovered?.state==='approved'){const helper=await a.connectionHelper();return {...helper,status:'ready',pairedDevice:recovered.device?.displayName||recovered.device?.deviceId||null,recovered:true};}
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
    title:'Resume a durable session',
    description:'Resume one existing durable session that is on hold. This changes session state but does not switch devices or authorize a new target.',
    inputSchema:{sessionId:id},securitySchemes:security(['remote:write']),annotations:annotations(false,false,false,true)
  },guarded(identity,['remote:write'],(a,x)=>a.resumeSession(x.sessionId)));

  add(server,'light_remote_hold_session',{
    title:'Hold a durable session',
    description:'Place one existing durable session on hold during an intentional transport interruption. The session can be resumed later.',
    inputSchema:{sessionId:id,reason:z.string().max(80).optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,false,false,true)
  },guarded(identity,['remote:write'],(a,x)=>a.holdSession(x.sessionId,x.reason)));

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
    title:'Start a remote file search',
    description:'Start one bounded file-name or text-content search inside an allowed path on the selected device. Use the returned search identifier with the results tool.',
    inputSchema:{sessionId:id,operationId:opId,path:pathText,searchType:z.enum(['content','files']).optional(),pattern:z.string().max(4096),literalSearch:z.boolean().optional(),ignoreCase:z.boolean().optional(),filePattern:z.string().max(1024).optional(),contextLines:z.number().int().min(0).max(20).optional(),maxResults:z.number().int().min(1).max(1000).optional()},securitySchemes:security(['remote:read']),annotations:annotations(false,false,false,false)
  },guarded(identity,['remote:read'],(a,x)=>searchOperation(a,x,'start')));

  add(server,'light_remote_search_results',{
    title:'Read remote search results',
    description:'Read a bounded page of results from an existing remote file search without changing files.',
    inputSchema:{sessionId:id,operationId:opId,searchId:z.string().min(1).max(160),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(500).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>searchOperation(a,x,'results')));

  add(server,'light_remote_cancel_search',{
    title:'Cancel a remote file search',
    description:'Cancel one in-progress remote file search. This stops that search job but does not modify user files.',
    inputSchema:{sessionId:id,operationId:opId,searchId:z.string().min(1).max(160)},securitySchemes:security(['remote:read']),annotations:annotations(false,true,false,true)
  },guarded(identity,['remote:read'],(a,x)=>searchOperation(a,x,'cancel')));

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
    title:'Create a remote directory',
    description:'Create one directory inside the device allowed roots. Local device policy remains the final authorization boundary.',
    inputSchema:{sessionId:id,operationId:opId,path:pathText,parents:z.boolean().optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,false,false,true)
  },guarded(identity,['remote:write'],(a,x)=>filesystemOperation(a,x,'mkdir')));

  add(server,'light_remote_copy_path',{
    title:'Copy a remote filesystem path',
    description:'Copy one allowed file or directory to another allowed path. Overwrite can replace destination data when explicitly requested.',
    inputSchema:{sessionId:id,operationId:opId,source:pathText,destination:pathText,recursive:z.boolean().optional(),overwrite:z.boolean().optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:write'],(a,x)=>filesystemOperation(a,x,'copy')));

  add(server,'light_remote_move_path',{
    title:'Move a remote filesystem path',
    description:'Move or rename one allowed file or directory. The source path is removed as part of the move.',
    inputSchema:{sessionId:id,operationId:opId,source:pathText,destination:pathText,overwrite:z.boolean().optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:write'],(a,x)=>filesystemOperation(a,x,'move')));

  add(server,'light_remote_delete_path',{
    title:'Delete a remote filesystem path',
    description:'Delete one allowed file or directory. Recursive deletion must be explicitly requested and can be irreversible.',
    inputSchema:{sessionId:id,operationId:opId,path:pathText,recursive:z.boolean().optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:write'],(a,x)=>filesystemOperation(a,x,'delete')));

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
    title:'Start a managed remote process',
    description:'Start one persistent non-PTY process on the selected device. The command may change local or external state according to the script and device policy.',
    inputSchema:{sessionId:id,operationId:opId,script:z.string().min(1).max(1_000_000),shell:z.string().max(80).optional(),cwd:pathText.optional(),timeoutMs:z.number().int().min(0).max(86_400_000).optional(),requiredCapabilities:z.array(z.string().min(1).max(80)).max(32).optional()},securitySchemes:security(['remote:execute']),annotations:annotations(false,true,true,false)
  },guarded(identity,['remote:execute'],(a,x)=>processOperation(a,x,'start')));

  add(server,'light_remote_process_input',{
    title:'Send input to a managed process',
    description:'Send bounded stdin data to one existing managed process. Input can cause the process to change local or external state.',
    inputSchema:{sessionId:id,operationId:opId,processId:z.string().min(1).max(160),data:z.string().max(1_048_576).optional(),eof:z.boolean().optional()},securitySchemes:security(['remote:execute']),annotations:annotations(false,true,true,false)
  },guarded(identity,['remote:execute'],(a,x)=>processOperation(a,x,'input')));

  add(server,'light_remote_process_output',{
    title:'Read managed process output',
    description:'Read a bounded stdout or stderr range from one existing managed process without changing the process.',
    inputSchema:{sessionId:id,operationId:opId,processId:z.string().min(1).max(160),stream:z.enum(['stdout','stderr']).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1_048_576).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>processOperation(a,x,'output')));

  add(server,'light_remote_list_processes',{
    title:'List managed remote processes',
    description:'List managed non-PTY processes owned by the current Light Remote session without changing them.',
    inputSchema:{sessionId:id,operationId:opId},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>processOperation(a,x,'list')));

  add(server,'light_remote_stop_process',{
    title:'Stop a managed remote process',
    description:'Stop one managed process. Force mode may terminate it immediately and can discard in-process work.',
    inputSchema:{sessionId:id,operationId:opId,processId:z.string().min(1).max(160),force:z.boolean().optional()},securitySchemes:security(['remote:execute']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:execute'],(a,x)=>processOperation(a,x,'stop')));

  add(server,'light_remote_terminal',{
    title:'Start a remote PTY or ConPTY terminal',
    description:'Start one interactive terminal session on the selected device. Starting the terminal changes session state but does not itself execute user commands.',
    inputSchema:{sessionId:id,operationId:opId,shell:z.string().max(80).optional(),cwd:pathText.optional(),term:z.string().max(64).optional(),cols:z.number().int().min(20).max(500).optional(),rows:z.number().int().min(5).max(200).optional()},securitySchemes:security(['remote:terminal']),annotations:annotations(false,false,false,false)
  },guarded(identity,['remote:terminal'],(a,x)=>terminalOperation(a,x,'start')));

  add(server,'light_remote_terminal_input',{
    title:'Send input to a remote terminal',
    description:'Send bounded text or control input to one existing PTY/ConPTY terminal. Input can execute commands that change local or external state.',
    inputSchema:{sessionId:id,operationId:opId,terminalId:z.string().min(1).max(160),data:z.string().max(1_048_576)},securitySchemes:security(['remote:terminal']),annotations:annotations(false,true,true,false)
  },guarded(identity,['remote:terminal'],(a,x)=>terminalOperation(a,x,'input')));

  add(server,'light_remote_terminal_output',{
    title:'Read remote terminal output',
    description:'Read a bounded output range from one existing PTY/ConPTY terminal without sending input.',
    inputSchema:{sessionId:id,operationId:opId,terminalId:z.string().min(1).max(160),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1_048_576).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>terminalOperation(a,x,'output')));

  add(server,'light_remote_resize_terminal',{
    title:'Resize a remote terminal',
    description:'Change the rows and columns of one existing PTY/ConPTY terminal without executing a command.',
    inputSchema:{sessionId:id,operationId:opId,terminalId:z.string().min(1).max(160),cols:z.number().int().min(20).max(500),rows:z.number().int().min(5).max(200)},securitySchemes:security(['remote:terminal']),annotations:annotations(false,false,false,true)
  },guarded(identity,['remote:terminal'],(a,x)=>terminalOperation(a,x,'resize')));

  add(server,'light_remote_signal_terminal',{
    title:'Signal a remote terminal process',
    description:'Send interrupt, terminate, or kill to the process group owned by one terminal. Terminate or kill can discard running work.',
    inputSchema:{sessionId:id,operationId:opId,terminalId:z.string().min(1).max(160),signal:z.enum(['interrupt','terminate','kill'])},securitySchemes:security(['remote:terminal']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:terminal'],(a,x)=>terminalOperation(a,x,'signal')));

  add(server,'light_remote_list_terminals',{
    title:'List remote terminals',
    description:'List PTY/ConPTY terminals owned by the current Light Remote session without changing them.',
    inputSchema:{sessionId:id,operationId:opId},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>terminalOperation(a,x,'list')));

  add(server,'light_remote_stop_terminal',{
    title:'Stop a remote terminal',
    description:'Stop one PTY/ConPTY terminal. Force mode may terminate its process group immediately and can discard running work.',
    inputSchema:{sessionId:id,operationId:opId,terminalId:z.string().min(1).max(160),force:z.boolean().optional()},securitySchemes:security(['remote:terminal']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:terminal'],(a,x)=>terminalOperation(a,x,'stop')));

  add(server,'light_remote_scp_download',{
    title:'Begin a large or binary file download',
    description:'Begin one resumable Light SCP download from an allowed remote path and return transfer metadata with SHA-256 integrity information.',
    inputSchema:{sessionId:id,operationId:opId,source:pathText,chunkBytes:z.number().int().min(64*1024).max(4*1024*1024).optional()},securitySchemes:security(['remote:read']),annotations:annotations(false,false,false,false)
  },guarded(identity,['remote:read'],(a,x)=>scpOperation(a,x,'download-begin',['source','chunkBytes'])));

  add(server,'light_remote_scp_download_chunk',{
    title:'Read a download chunk',
    description:'Read one indexed chunk from an existing Light SCP download without changing the source file.',
    inputSchema:{sessionId:id,operationId:opId,transferId:z.string().min(1).max(160),index:z.number().int().min(0)},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>scpOperation(a,x,'download-chunk',['transferId','index'])));

  add(server,'light_remote_scp_download_status',{
    title:'Read download status',
    description:'Read status and integrity metadata for one existing Light SCP download.',
    inputSchema:{sessionId:id,operationId:opId,transferId:z.string().min(1).max(160)},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>scpOperation(a,x,'status',['transferId'])));

  add(server,'light_remote_scp_download_cancel',{
    title:'Cancel a file download',
    description:'Cancel one in-progress Light SCP download and discard its transfer state without modifying the remote source file.',
    inputSchema:{sessionId:id,operationId:opId,transferId:z.string().min(1).max(160)},securitySchemes:security(['remote:read']),annotations:annotations(false,true,false,true)
  },guarded(identity,['remote:read'],(a,x)=>scpOperation(a,x,'cancel',['transferId'])));

  add(server,'light_remote_scp',{
    title:'Begin a large or binary file upload',
    description:'Begin one resumable Light SCP upload to an allowed destination. Data is staged until commit and integrity is verified with SHA-256.',
    inputSchema:{sessionId:id,operationId:opId,destination:pathText,totalBytes:z.number().int().min(0),sha256:z.string().regex(/^[a-f0-9]{64}$/i),chunkBytes:z.number().int().min(64*1024).max(4*1024*1024).optional(),overwrite:z.boolean().optional(),createParents:z.boolean().optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,false,false,false)
  },guarded(identity,['remote:write'],(a,x)=>scpOperation(a,x,'upload-begin',['destination','totalBytes','sha256','chunkBytes','overwrite','createParents'])));

  add(server,'light_remote_scp_upload_chunk',{
    title:'Write an upload chunk',
    description:'Stage one indexed data chunk for an existing Light SCP upload. This changes transfer state but does not commit the destination file.',
    inputSchema:{sessionId:id,operationId:opId,transferId:z.string().min(1).max(160),index:z.number().int().min(0),data:z.string().max(6_000_000),sha256:z.string().regex(/^[a-f0-9]{64}$/i).optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,false,false,false)
  },guarded(identity,['remote:write'],(a,x)=>scpOperation(a,x,'upload-chunk',['transferId','index','data','sha256'])));

  add(server,'light_remote_scp_upload_commit',{
    title:'Commit a file upload',
    description:'Verify and commit one completed Light SCP upload to its destination. If overwrite was requested, existing destination data can be replaced.',
    inputSchema:{sessionId:id,operationId:opId,transferId:z.string().min(1).max(160)},securitySchemes:security(['remote:write']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:write'],(a,x)=>scpOperation(a,x,'upload-commit',['transferId'])));

  add(server,'light_remote_scp_upload_status',{
    title:'Read upload status',
    description:'Read status and integrity metadata for one existing Light SCP upload.',
    inputSchema:{sessionId:id,operationId:opId,transferId:z.string().min(1).max(160)},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>scpOperation(a,x,'status',['transferId'])));

  add(server,'light_remote_scp_upload_cancel',{
    title:'Cancel a file upload',
    description:'Cancel one in-progress Light SCP upload and discard staged transfer data before commit.',
    inputSchema:{sessionId:id,operationId:opId,transferId:z.string().min(1).max(160)},securitySchemes:security(['remote:write']),annotations:annotations(false,true,false,true)
  },guarded(identity,['remote:write'],(a,x)=>scpOperation(a,x,'cancel',['transferId'])));

  add(server,'light_remote_desktop',{
    title:'Read remote desktop status',
    description:'Read Real Remote V2 desktop session status for the selected Light Remote session without attaching or sending input.',
    inputSchema:{sessionId:id,operationId:opId},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>desktopOperation(a,x,'status',['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes'])));

  add(server,'light_remote_desktop_attach',{
    title:'Attach remote desktop observation',
    description:'Attach a bounded Real Remote V2 desktop observation session. This creates observation state but does not send keyboard or pointer input.',
    inputSchema:{sessionId:id,operationId:opId,screen:z.number().int().min(-1).max(31).optional(),maxWidth:z.number().int().min(64).max(7680).optional(),maxHeight:z.number().int().min(64).max(4320).optional(),quality:z.number().int().min(1).max(100).optional(),minIntervalMs:z.number().int().min(0).max(5000).optional(),omitUnchanged:z.boolean().optional(),idleTimeoutMs:z.number().int().min(250).max(900000).optional()},securitySchemes:security(['remote:read']),annotations:annotations(false,false,false,false)
  },guarded(identity,['remote:read'],(a,x)=>desktopOperation(a,x,'attach',['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes'])));

  add(server,'light_remote_desktop_resume',{
    title:'Resume remote desktop observation',
    description:'Resume one existing Real Remote V2 desktop observation session without sending user input.',
    inputSchema:{sessionId:id,operationId:opId,desktopSessionId:z.string().min(1).max(160)},securitySchemes:security(['remote:read']),annotations:annotations(false,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>desktopOperation(a,x,'resume',['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes'])));

  add(server,'light_remote_desktop_detach',{
    title:'Detach remote desktop observation',
    description:'Detach one existing Real Remote V2 desktop observation session. This stops observation state and does not alter desktop content.',
    inputSchema:{sessionId:id,operationId:opId,desktopSessionId:z.string().min(1).max(160)},securitySchemes:security(['remote:read']),annotations:annotations(false,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>desktopOperation(a,x,'detach',['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes'])));

  add(server,'light_remote_desktop_windows',{
    title:'List remote desktop windows',
    description:'Read the visible window inventory from the authorized remote desktop without sending input.',
    inputSchema:{sessionId:id,operationId:opId,desktopSessionId:z.string().max(160).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>desktopOperation(a,x,'windows',['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes'])));

  add(server,'light_remote_desktop_frame',{
    title:'Read a remote desktop frame',
    description:'Read one bounded desktop frame for bootstrap or resynchronization without sending keyboard or pointer input.',
    inputSchema:{sessionId:id,operationId:opId,desktopSessionId:z.string().max(160).optional(),screen:z.number().int().min(-1).max(31).optional(),maxWidth:z.number().int().min(64).max(7680).optional(),maxHeight:z.number().int().min(64).max(4320).optional(),quality:z.number().int().min(1).max(100).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>desktopOperation(a,x,'frame',['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes'])));

  add(server,'light_remote_desktop_observe',{
    title:'Observe remote desktop state',
    description:'Read one bounded Real Remote V2 observation from an authorized desktop without sending input.',
    inputSchema:{sessionId:id,operationId:opId,desktopSessionId:z.string().max(160).optional(),screen:z.number().int().min(-1).max(31).optional(),maxWidth:z.number().int().min(64).max(7680).optional(),maxHeight:z.number().int().min(64).max(4320).optional(),quality:z.number().int().min(1).max(100).optional(),omitUnchanged:z.boolean().optional(),waitMs:z.number().int().min(0).max(7000).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,false)
  },guarded(identity,['remote:read'],(a,x)=>desktopOperation(a,x,'observe',['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes'])));

  add(server,'light_remote_semantic_attach',{
    title:'Attach semantic desktop observation',
    description:'Attach a bounded semantic desktop provider for structured UI observation. This creates observation state and does not send input.',
    inputSchema:{sessionId:id,operationId:opId,provider:z.enum(['windows-uia','browser-cdp']).optional(),scope:z.string().max(160).optional(),cdpEndpoint:z.string().max(256).optional(),targetId:z.string().max(256).optional(),urlMatch:z.string().max(512).optional(),maxDepth:z.number().int().min(1).max(64).optional(),maxNodes:z.number().int().min(1).max(20000).optional(),idleTimeoutMs:z.number().int().min(250).max(900000).optional()},securitySchemes:security(['remote:read']),annotations:annotations(false,false,false,false)
  },guarded(identity,['remote:read'],(a,x)=>desktopOperation(a,x,'semantic-attach',['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes'])));

  add(server,'light_remote_semantic_snapshot',{
    title:'Read a semantic desktop snapshot',
    description:'Read one structured semantic UI snapshot from an existing authorized semantic observation session.',
    inputSchema:{sessionId:id,operationId:opId,semanticSessionId:z.string().min(1).max(160),maxDepth:z.number().int().min(1).max(64).optional(),maxNodes:z.number().int().min(1).max(20000).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>desktopOperation(a,x,'semantic-snapshot',['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes'])));

  add(server,'light_remote_semantic_events',{
    title:'Read semantic desktop events',
    description:'Read bounded semantic UI events after a sequence number without changing the remote desktop.',
    inputSchema:{sessionId:id,operationId:opId,semanticSessionId:z.string().min(1).max(160),afterSeq:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1000).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>desktopOperation(a,x,'semantic-events',['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes'])));

  add(server,'light_remote_semantic_detach',{
    title:'Detach semantic desktop observation',
    description:'Detach one semantic observation session. This stops observation state and does not alter desktop content.',
    inputSchema:{sessionId:id,operationId:opId,semanticSessionId:z.string().min(1).max(160)},securitySchemes:security(['remote:read']),annotations:annotations(false,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>desktopOperation(a,x,'semantic-detach',['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes'])));

  add(server,'light_remote_desktop_live_open',{
    title:'Open live semantic desktop observation',
    description:'Open a bounded live semantic observation lane for an authorized desktop. This creates observation state and sends no keyboard or pointer input.',
    inputSchema:{sessionId:id,operationId:opId,provider:z.enum(['windows-uia','browser-cdp']).optional(),scope:z.string().max(160).optional(),cdpEndpoint:z.string().max(256).optional(),targetId:z.string().max(256).optional(),urlMatch:z.string().max(512).optional(),maxDepth:z.number().int().min(1).max(64).optional(),maxNodes:z.number().int().min(1).max(20000).optional(),idleTimeoutMs:z.number().int().min(250).max(900000).optional()},securitySchemes:security(['remote:read']),annotations:annotations(false,false,false,false)
  },guarded(identity,['remote:read'],(a,x)=>desktopOperation(a,x,'live-open',['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes'])));

  add(server,'light_remote_desktop_live_close',{
    title:'Close live semantic desktop observation',
    description:'Close one live semantic observation lane. This stops observation state and does not alter desktop content.',
    inputSchema:{sessionId:id,operationId:opId,semanticSessionId:z.string().min(1).max(160)},securitySchemes:security(['remote:read']),annotations:annotations(false,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>desktopOperation(a,x,'live-close',['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','cdpEndpoint','targetId','urlMatch','maxDepth','maxNodes'])));

  add(server,'light_remote_desktop_live_read',{
    title:'Read buffered Real Remote V2 live state',
    description:'Read already-buffered semantic deltas/snapshot from the Hub cache without dispatching a new Windows observation job.',
    inputSchema:{sessionId:id,semanticSessionId:z.string().min(1).max(160),afterSeq:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1000).optional(),includeSnapshot:z.boolean().optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>a.desktopLiveRead(x.sessionId,x)));

  add(server,'light_remote_desktop_input',{
    title:'Perform a semantic desktop action',
    description:'Perform one bounded semantic UI action on an explicitly authorized remote desktop. The action can cause external or irreversible effects in the active application.',
    inputSchema:{sessionId:id,operationId:opId,semanticSessionId:z.string().min(1).max(160),nodeId:z.string().min(1).max(512),action:z.string().min(1).max(80),value:z.any().optional(),waitMs:z.number().int().min(0).max(7000).optional()},securitySchemes:security(['remote:execute']),annotations:annotations(false,true,true,false)
  },guarded(identity,['remote:execute'],(a,x)=>desktopOperation(a,x,'act',['semanticSessionId','nodeId','action','value'])));

  add(server,'light_remote_desktop_input_batch',{
    title:'Send bounded desktop input',
    description:'Send one bounded batch of pointer, keyboard, wheel, drag, text, or key events to an authorized remote desktop. Input can cause external or irreversible effects.',
    inputSchema:{sessionId:id,operationId:opId,events:z.array(jsonObject).min(1).max(128),displayTopologyId:z.string().max(160).optional(),waitMs:z.number().int().min(0).max(7000).optional()},securitySchemes:security(['remote:execute']),annotations:annotations(false,true,true,false)
  },guarded(identity,['remote:execute'],(a,x)=>desktopOperation(a,x,'input',['events','displayTopologyId'])));

  add(server,'light_remote_desktop_action_await',{
    title:'Perform a desktop action and await state',
    description:'Perform one bounded desktop action and wait for a declared UI state condition. The action can cause external or irreversible effects in the active application.',
    inputSchema:{sessionId:id,operationId:opId,semanticSessionId:z.string().max(160).optional(),nodeId:z.string().max(512).optional(),action:z.string().max(80).optional(),value:z.any().optional(),events:z.array(jsonObject).max(128).optional(),displayTopologyId:z.string().max(160).optional(),afterSeq:z.number().int().min(0).optional(),settleMs:z.number().int().min(0).max(15000).optional(),await:z.object({foregroundTitleContains:z.string().max(512).optional(),foregroundTitleEquals:z.string().max(512).optional(),focusedNameContains:z.string().max(512).optional(),timeoutMs:z.number().int().min(50).max(15000).optional()}),waitMs:z.number().int().min(0).max(7000).optional()},securitySchemes:security(['remote:execute']),annotations:annotations(false,true,true,false)
  },guarded(identity,['remote:execute'],(a,x)=>desktopOperation(a,x,'run',['semanticSessionId','nodeId','action','value','events','displayTopologyId','afterSeq','settleMs','await'])));

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
