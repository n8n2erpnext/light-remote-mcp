const GROUPS=Object.freeze({
  workspace:{title:'Target, device and session',when:'Pairing, recovering or intentionally changing the exact device, workspace, or durable session.',tools:['light_remote_connection_helper','light_remote_list_devices','light_remote_context','light_remote_open_session','light_remote_list_sessions','light_remote_session_control','light_remote_close_session']},
  files:{title:'Files and search',when:'Reading, writing, editing, listing, metadata, multi-read, or recursive file/content discovery.',tools:['light_remote_list_files','light_remote_read_file','light_remote_read_multiple_files','light_remote_stat_path','light_remote_search_files','light_remote_write_file','light_remote_edit_file','light_remote_filesystem']},
  shell:{title:'Commands, processes and terminals',when:'Running commands, managed processes, PTY/ConPTY, durable jobs, or bounded output recovery.',tools:['light_remote_exec','light_remote_process','light_remote_terminal','light_remote_job','light_remote_output']},
  transfer:{title:'Binary and large-file transfer',when:'Moving binary or large files without tunneling bytes through command stdout.',tools:['light_remote_scp_download','light_remote_scp']},
  desktop:{title:'Real Remote V2',when:'Observing or controlling the real interactive desktop. Load only for computer use.',tools:['light_remote_desktop','light_remote_desktop_live_read','light_remote_desktop_input']}
});
function shellGuide(platform){
  const p=String(platform||'').toLowerCase();
  if(p==='win32'||p==='windows')return {family:'windows',defaultShell:'powershell',alternateShells:['cmd']};
  if(p==='darwin'||p==='macos')return {family:'macos',defaultShell:'zsh',alternateShells:['bash','sh']};
  if(p==='linux')return {family:'linux',defaultShell:'bash',alternateShells:['zsh','sh']};
  return {family:'unknown',defaultShell:'default',alternateShells:[]};
}
function targetFor(context={}){
  return {deviceId:context.deviceId||null,sessionId:context.sessionId||null,nodeId:context.nodeId||null,platform:context.platform||null,architecture:context.architecture||null,workspace:context.workspace||'',gracePreset:context.gracePreset||null};
}
export function helperOverview(context={}){
  const groups=Object.fromEntries(Object.entries(GROUPS).map(([id,row])=>[id,{title:row.title,when:row.when,tools:[...row.tools]}]));
  return {kind:'light-remote-tool-helper-overview',helperMode:'index-only',target:targetFor(context),rule:'This is the menu only. Before first use of an unfamiliar family, call light_remote_connection_helper again with helperGroup set to exactly one group. Do not preload every chapter.',selection:['Use structured filesystem/search tools before shell.','Use exec for one logical command, process for explicit stdin/stdout lifecycle, and terminal only for a real PTY/ConPTY.','Use SCP for binary/large files.','Use Real Remote V2 only for actual computer use.','Never silently switch devices or fall back to another target.'],groups};
}
const chapters={
  workspace:context=>({kind:'light-remote-tool-helper-group',helperMode:'group-detail',group:'workspace',target:targetFor(context),tools:{
    connection_helper:{name:'light_remote_connection_helper',use:'Pair through Local Wall A/B; when ready it also returns/reuses a working context and the helper menu.'},
    list_devices:{name:'light_remote_list_devices',use:'List only devices independently A/B-authorized for this plugin client.'},
    context:{name:'light_remote_context',use:'Recover or intentionally switch the working device/workspace/grace without opening duplicate sessions.',input:'{deviceId?,workspace?,gracePreset?}'},
    open_session:{name:'light_remote_open_session',use:'Explicit durable session open/reuse. openId makes retries idempotent.',input:'{deviceId,openId?,workspace?,gracePreset?}'},
    list_sessions:{name:'light_remote_list_sessions',use:'List durable sessions owned by this plugin client. Optional sessionId returns one exact session.'},
    session_control:{name:'light_remote_session_control',operations:['resume','hold'],use:'Resume a durable session or explicitly hold it across transport interruption.'},
    close_session:{name:'light_remote_close_session',use:'Close one durable session when work is complete.'}
  },safety:['Keep the exact device/session target pinned.','Pair each additional device independently with A/B approval.','Never re-pair solely for a retryable continuity error.']}),
  files:context=>({kind:'light-remote-tool-helper-group',helperMode:'group-detail',group:'files',target:targetFor(context),tools:{
    list:{name:'light_remote_list_files',input:'{sessionId,path,maxEntries?,maxDepth?}'},
    read:{name:'light_remote_read_file',input:'{sessionId,path,startLine?,maxLines?,tailLines?,maxBytes?}'},
    read_many:{name:'light_remote_read_multiple_files',input:'{sessionId,paths,maxLines?,maxBytesPerFile?}'},
    stat:{name:'light_remote_stat_path',input:'{sessionId,path}'},
    search:{name:'light_remote_search_files',operations:['start','results','cancel'],start:'{path,searchType,pattern,literalSearch?,ignoreCase?,filePattern?,contextLines?,maxResults?}'},
    write:{name:'light_remote_write_file',input:'{sessionId,operationId?,path,content,mode?,createParents?}'},
    edit:{name:'light_remote_edit_file',input:'{sessionId,operationId?,path,oldText,newText,expectedReplacements?}'},
    filesystem:{name:'light_remote_filesystem',operations:['mkdir','copy','move','delete'],use:'Structured mutations only; readMany/stat stay on read-scoped tools.'}
  },rule:'Absolute paths only. Device allowed roots and local policy are final deny boundaries.'}),
  shell:context=>({kind:'light-remote-tool-helper-group',helperMode:'group-detail',group:'shell',target:targetFor(context),platformGuide:shellGuide(context.platform),tools:{
    exec:{name:'light_remote_exec',input:'{sessionId,operationId?,script,shell?,cwd?,timeoutMs?,waitMs?,requiredCapabilities?}',use:'One logical command job not represented by a structured tool.'},
    process:{name:'light_remote_process',operations:['start','input','output','list','stop'],start:'{script,shell?,cwd?,timeoutMs?,requiredCapabilities?}'},
    terminal:{name:'light_remote_terminal',operations:['start','input','output','resize','signal','list','stop'],start:'{shell?,cwd?,cols?,rows?,term?}',use:'Real PTY/ConPTY for interactive programs, Ctrl-C, resize, or persistent shell.'},
    job:{name:'light_remote_job',use:'Poll an existing durable job instead of repeating it.'},
    output:{name:'light_remote_output',input:'{jobId,stream?,offset?,limit?,full?}',use:'Recover bounded or full durable stdout/stderr.'}
  },rule:'Duration alone is not a reason to split. Prefer structured tools first.'}),
  transfer:context=>({kind:'light-remote-tool-helper-group',helperMode:'group-detail',group:'transfer',target:targetFor(context),tools:{
    download:{name:'light_remote_scp_download',operations:['download-begin','download-chunk','status','cancel'],scope:'remote:read',integrity:'Whole-file and chunk SHA-256.'},
    upload:{name:'light_remote_scp',operations:['upload-begin','upload-chunk','upload-commit','status','cancel'],scope:'remote:write',integrity:'Whole-file and chunk SHA-256.',rule:'Use SCP for binary/large files; never tunnel file bytes through exec stdout.'}
  },note:'The old Vercel operator-payload bridge transfer is intentionally not part of Direct MCP.'}),
  desktop:context=>({kind:'light-remote-tool-helper-group',helperMode:'group-detail',group:'desktop',target:targetFor(context),tools:{
    observe:{name:'light_remote_desktop',operations:['status','attach','resume','detach','windows','frame','observe','semantic-attach','semantic-snapshot','semantic-events','semantic-detach','live-open','live-close'],providers:['windows-uia','browser-cdp'],rule:'Use windows-uia semantic state for normal reasoning. Full frame is bootstrap/resync fallback.'},
    live_read:{name:'light_remote_desktop_live_read',use:'Read already-buffered semantic deltas/snapshot from Hub cache without forcing a new Windows scan.'},
    input:{name:'light_remote_desktop_input',operations:['act','input','run'],semanticActions:['invoke','toggle','value','select','expand','collapse','focus','click'],physicalEvents:['move','click','wheel','drag','text','key'],rule:'Prefer semantic act. Use bounded OS input only when needed. run is action-and-await.'}
  },loop:['Bootstrap with live-open.','Read live deltas from live-read.','Act semantically when possible, otherwise bounded OS input.','Follow returned sequence/observation state; snapshot only for resync.','Close with live-close.'],security:'desktop-input capability and Windows UIPI/secure-desktop boundaries remain authoritative.'})
};
export function helperGroup(group,context={}){
  const id=String(group||'').trim().toLowerCase();
  const fn=chapters[id];
  if(!fn){const e=new Error('invalid_tool_helper_group');e.allowed=Object.keys(GROUPS);throw e;}
  return fn(context);
}
export const HELPER_GROUPS=GROUPS;
