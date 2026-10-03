import { z } from 'zod';
import { AccountOperatorAdapter } from './operator-adapter.mjs';
import { requireScopes } from './oauth.mjs';
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
    title:'Understand this Light Remote account',
    description:'Start here. Returns the authenticated account topology, Main/Fleet state, current device capabilities, local-first A/B enrollment boundary, and routing rules. It never authorizes a new device by itself.',
    securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],a=>a.connectionHelper()));

  add(server,'light_remote_list_devices',{
    title:'List enrolled Light Remote devices',
    description:'List devices owned by the authenticated account. Targeting remains explicit; no silent fallback.',
    securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],a=>a.devices()));

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
    inputSchema:{deviceId:id,workspace:z.string().max(512).optional(),gracePreset:z.enum(['15m','30m','45m','60m']).optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,false,false,true)
  },guarded(identity,['remote:write'],(a,x)=>a.openSession(x)));

  add(server,'light_remote_list_sessions',{
    title:'List durable sessions',
    description:'List account-scoped sessions owned by this MCP connection for recovery and continuation.',
    securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],a=>a.sessions()));

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
    inputSchema:{sessionId:id,operation:z.enum(['start','results','cancel']),operationId:opId,path:pathText.optional(),searchId:z.string().max(160).optional(),searchType:z.enum(['content','files']).optional(),pattern:z.string().max(4096).optional(),literalSearch:z.boolean().optional(),ignoreCase:z.boolean().optional(),filePattern:z.string().max(1024).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(500).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,false)
  },guarded(identity,['remote:read'],async(a,x)=>{
    const search=x.operation==='start'?{op:'start',path:x.path,searchType:x.searchType||'content',pattern:x.pattern,literalSearch:Boolean(x.literalSearch),ignoreCase:x.ignoreCase!==false,filePattern:x.filePattern||'',maxResults:500}:x.operation==='results'?{op:'results',searchId:x.searchId,offset:x.offset||0,limit:x.limit||100}:{op:'cancel',searchId:x.searchId};
    return operationView(await a.search(x.sessionId,search,x.operationId));
  }));

  add(server,'light_remote_filesystem',{
    title:'Perform a structured filesystem operation',
    description:'Use structured filesystem operations instead of shell commands. Device allowed roots and policy remain final deny boundaries.',
    inputSchema:{sessionId:id,operationId:opId,operation:z.enum(['stat','mkdir','copy','move','delete','readMany']),path:pathText.optional(),paths:z.array(pathText).max(100).optional(),source:pathText.optional(),destination:pathText.optional(),parents:z.boolean().optional(),recursive:z.boolean().optional(),overwrite:z.boolean().optional(),maxLines:z.number().int().min(1).max(5000).optional(),maxBytesPerFile:z.number().int().min(1).max(8_000_000).optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:write'],async(a,x)=>{
    const fs={op:x.operation};
    Object.assign(fs,pick(x,['path','paths','source','destination','parents','recursive','overwrite','maxLines','maxBytesPerFile']));
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
    inputSchema:{sessionId:id,operationId:opId,script:z.string().min(1).max(1_000_000),cwd:pathText.optional(),timeoutMs:z.number().int().min(1000).max(7_200_000).optional(),waitMs:z.number().int().min(0).max(7000).optional()},securitySchemes:security(['remote:execute']),annotations:annotations(false,true,true,false)
  },guarded(identity,['remote:execute'],async(a,x)=>operationView(await a.exec(x.sessionId,x.script,{cwd:x.cwd,operationId:x.operationId,timeoutMs:x.timeoutMs,waitMs:x.waitMs}))));

  add(server,'light_remote_process',{
    title:'Control a managed remote process',
    description:'Start or control a persistent non-PTY process with explicit stdin/stdout lifecycle.',
    inputSchema:{sessionId:id,operation:z.enum(['start','input','output','list','stop']),operationId:opId,processId:z.string().max(160).optional(),script:z.string().max(1_000_000).optional(),cwd:pathText.optional(),data:z.string().max(1_048_576).optional(),eof:z.boolean().optional(),stream:z.enum(['stdout','stderr']).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1_048_576).optional(),force:z.boolean().optional(),timeoutMs:z.number().int().min(0).max(86_400_000).optional()},securitySchemes:security(['remote:execute']),annotations:annotations(false,true,true,false)
  },guarded(identity,['remote:execute'],async(a,x)=>{
    const process=x.operation==='start'?{op:'start',script:x.script,cwd:x.cwd,timeoutMs:x.timeoutMs}:x.operation==='input'?{op:'input',processId:x.processId,data:x.data||'',eof:Boolean(x.eof)}:x.operation==='output'?{op:'output',processId:x.processId,stream:x.stream||'stdout',offset:x.offset||0,limit:x.limit||262144}:x.operation==='list'?{op:'list'}:{op:'stop',processId:x.processId,force:Boolean(x.force)};
    return operationView(await a.process(x.sessionId,process,x.operationId));
  }));

  add(server,'light_remote_terminal',{
    title:'Control a real PTY/ConPTY terminal',
    description:'Use for interactive programs, persistent shells, Ctrl-C, resize, and terminal input. Local policy remains authoritative.',
    inputSchema:{sessionId:id,operation:z.enum(['start','input','output','resize','signal','list','stop']),operationId:opId,terminalId:z.string().max(160).optional(),shell:z.string().max(80).optional(),cwd:pathText.optional(),data:z.string().max(1_048_576).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1_048_576).optional(),cols:z.number().int().min(20).max(400).optional(),rows:z.number().int().min(5).max(200).optional(),signal:z.enum(['interrupt','terminate','kill']).optional(),force:z.boolean().optional()},securitySchemes:security(['remote:terminal']),annotations:annotations(false,true,true,false)
  },guarded(identity,['remote:terminal'],async(a,x)=>{
    const terminal={op:x.operation};Object.assign(terminal,pick(x,['terminalId','shell','cwd','data','offset','limit','cols','rows','signal','force']));
    return operationView(await a.terminal(x.sessionId,terminal,x.operationId));
  }));

  add(server,'light_remote_scp',{
    title:'Transfer a large or binary file',
    description:'Use the resumable Light SCP plane for binary/large files. Upload and download integrity are verified by SHA-256. This mixed read/write surface requires remote:write.',
    inputSchema:{sessionId:id,operationId:opId,operation:z.enum(['upload-begin','upload-chunk','upload-commit','download-begin','download-chunk','status','cancel']),transferId:z.string().max(160).optional(),destination:pathText.optional(),source:pathText.optional(),totalBytes:z.number().int().min(0).optional(),sha256:z.string().regex(/^[a-f0-9]{64}$/i).optional(),chunkBytes:z.number().int().min(64*1024).max(4*1024*1024).optional(),index:z.number().int().min(0).optional(),data:z.string().max(6_000_000).optional(),overwrite:z.boolean().optional(),createParents:z.boolean().optional()},securitySchemes:security(['remote:write']),annotations:annotations(false,true,false,false)
  },guarded(identity,['remote:write'],async(a,x)=>{
    const scp={op:x.operation};Object.assign(scp,pick(x,['transferId','destination','source','totalBytes','sha256','chunkBytes','index','data','overwrite','createParents']));
    return operationView(await a.scp(x.sessionId,scp,x.operationId));
  }));

  add(server,'light_remote_desktop',{
    title:'Observe or manage a Real Remote V2 semantic lane',
    description:'Read the real interactive desktop using RC.30 semantic observation. Prefer live-open/live-read and semantic deltas; use full frame only for bootstrap or resync.',
    inputSchema:{sessionId:id,operationId:opId,operation:z.enum(['status','attach','resume','detach','windows','frame','observe','semantic-attach','semantic-snapshot','semantic-events','semantic-detach','live-open','live-close']),desktopSessionId:z.string().max(160).optional(),semanticSessionId:z.string().max(160).optional(),afterSeq:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1000).optional(),screen:z.number().int().min(0).max(32).optional(),maxWidth:z.number().int().min(64).max(7680).optional(),maxHeight:z.number().int().min(64).max(4320).optional(),quality:z.number().int().min(1).max(100).optional(),minIntervalMs:z.number().int().min(0).max(5000).optional(),omitUnchanged:z.boolean().optional(),idleTimeoutMs:z.number().int().min(250).max(900000).optional(),provider:z.string().max(80).optional(),scope:z.string().max(160).optional(),maxDepth:z.number().int().min(1).max(64).optional(),maxNodes:z.number().int().min(1).max(20000).optional(),waitMs:z.number().int().min(0).max(7000).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,false)
  },guarded(identity,['remote:read'],async(a,x)=>{
    const desktop={op:x.operation};Object.assign(desktop,pick(x,['desktopSessionId','semanticSessionId','afterSeq','limit','screen','maxWidth','maxHeight','quality','minIntervalMs','omitUnchanged','idleTimeoutMs','provider','scope','maxDepth','maxNodes']));
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
    inputSchema:{jobId:id,stream:z.enum(['stdout','stderr']).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(1_048_576).optional()},securitySchemes:security(['remote:read']),annotations:annotations(true,false,false,true)
  },guarded(identity,['remote:read'],(a,x)=>a.output(x.jobId,x.stream,x.offset,x.limit)));
}
