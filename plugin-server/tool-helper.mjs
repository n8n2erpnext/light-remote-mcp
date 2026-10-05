const GROUPS=Object.freeze({
  workspace:{title:'Target, device and session',when:'Pairing, recovering or intentionally changing the exact device, workspace, or durable session.',tools:['light_remote_connection_helper','light_remote_list_devices','light_remote_context','light_remote_open_session','light_remote_list_sessions','light_remote_session_control','light_remote_hold_session','light_remote_close_session']},
  files:{title:'Files and search',when:'Reading, writing, editing, listing, metadata, multi-read, or recursive file/content discovery.',tools:['light_remote_list_files','light_remote_read_file','light_remote_read_multiple_files','light_remote_stat_path','light_remote_search_files','light_remote_search_results','light_remote_cancel_search','light_remote_write_file','light_remote_edit_file','light_remote_filesystem','light_remote_copy_path','light_remote_move_path','light_remote_delete_path']},
  shell:{title:'Commands, processes and terminals',when:'Running commands, managed processes, PTY/ConPTY, durable jobs, or bounded output recovery.',tools:['light_remote_exec','light_remote_process','light_remote_process_input','light_remote_process_output','light_remote_list_processes','light_remote_stop_process','light_remote_terminal','light_remote_terminal_input','light_remote_terminal_output','light_remote_resize_terminal','light_remote_signal_terminal','light_remote_list_terminals','light_remote_stop_terminal','light_remote_job','light_remote_output']},
  transfer:{title:'Binary and large-file transfer',when:'Moving binary or large files without tunneling bytes through command stdout.',tools:['light_remote_scp_download','light_remote_scp_download_chunk','light_remote_scp_download_status','light_remote_scp_download_cancel','light_remote_scp','light_remote_scp_upload_chunk','light_remote_scp_upload_commit','light_remote_scp_upload_status','light_remote_scp_upload_cancel']},
  desktop:{title:'Real Remote V2',when:'Observing or controlling the real interactive desktop.',tools:['light_remote_desktop','light_remote_desktop_attach','light_remote_desktop_resume','light_remote_desktop_detach','light_remote_desktop_windows','light_remote_desktop_frame','light_remote_desktop_observe','light_remote_semantic_attach','light_remote_semantic_snapshot','light_remote_semantic_events','light_remote_semantic_detach','light_remote_desktop_live_open','light_remote_desktop_live_read','light_remote_desktop_live_close','light_remote_desktop_input','light_remote_desktop_input_batch','light_remote_desktop_action_await']}
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
  return {kind:'light-remote-tool-helper-overview',helperMode:'index-only',target:targetFor(context),rule:'Reference menu only. Every model-callable action is independently exposed with its own schema; call the focused tool that matches the requested action.',selection:['Use structured filesystem/search tools before shell.','Use exec for one logical command, process for explicit stdin/stdout lifecycle, and terminal only for a real PTY/ConPTY.','Use SCP for binary/large files.','Use Real Remote V2 only for actual computer use.','Never silently switch devices or fall back to another target.'],groups};
}
const chapters={
  workspace:context=>({kind:'light-remote-tool-helper-group',helperMode:'group-detail',group:'workspace',target:targetFor(context),tools:{
    connection_helper:{name:'light_remote_connection_helper',use:'Pair through Local Wall A/B; when ready it also returns/reuses a working context and the helper menu.'},
    list_devices:{name:'light_remote_list_devices',use:'List only devices independently A/B-authorized for this plugin client.'},
    context:{name:'light_remote_context',use:'Recover or intentionally switch the working device/workspace/grace without opening duplicate sessions.',input:'{deviceId?,workspace?,gracePreset?}'},
    open_session:{name:'light_remote_open_session',use:'Explicit durable session open/reuse. openId makes retries idempotent.',input:'{deviceId,openId?,workspace?,gracePreset?}'},
    list_sessions:{name:'light_remote_list_sessions',use:'List durable sessions owned by this plugin client. Optional sessionId returns one exact session.'},
    resume_session:{name:'light_remote_session_control',use:'Resume one durable session that is on hold.'},
    hold_session:{name:'light_remote_hold_session',use:'Place one durable session on hold during an intentional transport interruption.'},
    close_session:{name:'light_remote_close_session',use:'Close one durable session when work is complete.'}
  },safety:['Keep the exact device/session target pinned.','Pair each additional device independently with A/B approval.','Never re-pair solely for a retryable continuity error.']}),
  files:context=>({kind:'light-remote-tool-helper-group',helperMode:'group-detail',group:'files',target:targetFor(context),tools:{
    list:{name:'light_remote_list_files',input:'{sessionId,path,maxEntries?,maxDepth?}'},
    read:{name:'light_remote_read_file',input:'{sessionId,path,startLine?,maxLines?,tailLines?,maxBytes?}'},
    read_many:{name:'light_remote_read_multiple_files',input:'{sessionId,paths,maxLines?,maxBytesPerFile?}'},
    stat:{name:'light_remote_stat_path',input:'{sessionId,path}'},
    search_start:{name:'light_remote_search_files',input:'{sessionId,path,searchType?,pattern,literalSearch?,ignoreCase?,filePattern?,contextLines?,maxResults?}'},
    search_results:{name:'light_remote_search_results',input:'{sessionId,searchId,offset?,limit?}'},
    search_cancel:{name:'light_remote_cancel_search',input:'{sessionId,searchId}'},
    write:{name:'light_remote_write_file',input:'{sessionId,operationId?,path,content,mode?,createParents?}'},
    edit:{name:'light_remote_edit_file',input:'{sessionId,operationId?,path,oldText,newText,expectedReplacements?}'},
    mkdir:{name:'light_remote_filesystem',use:'Create a directory.'},
    copy:{name:'light_remote_copy_path',use:'Copy one file or directory.'},
    move:{name:'light_remote_move_path',use:'Move or rename one file or directory.'},
    delete:{name:'light_remote_delete_path',use:'Delete one file or directory.'}
  },rule:'Absolute paths only. Device allowed roots and local policy are final deny boundaries.'}),
  shell:context=>({kind:'light-remote-tool-helper-group',helperMode:'group-detail',group:'shell',target:targetFor(context),platformGuide:shellGuide(context.platform),tools:{
    exec:{name:'light_remote_exec',input:'{sessionId,operationId?,script,shell?,cwd?,timeoutMs?,waitMs?,requiredCapabilities?}',use:'One logical command job not represented by a structured tool.'},
    process_start:{name:'light_remote_process',input:'{sessionId,script,shell?,cwd?,timeoutMs?,requiredCapabilities?}'},
    process_input:{name:'light_remote_process_input',input:'{sessionId,processId,data?,eof?}'},
    process_output:{name:'light_remote_process_output',input:'{sessionId,processId,stream?,offset?,limit?}'},
    process_list:{name:'light_remote_list_processes',input:'{sessionId}'},
    process_stop:{name:'light_remote_stop_process',input:'{sessionId,processId,force?}'},
    terminal_start:{name:'light_remote_terminal',input:'{sessionId,shell?,cwd?,cols?,rows?,term?}'},
    terminal_input:{name:'light_remote_terminal_input',input:'{sessionId,terminalId,data}'},
    terminal_output:{name:'light_remote_terminal_output',input:'{sessionId,terminalId,offset?,limit?}'},
    terminal_resize:{name:'light_remote_resize_terminal',input:'{sessionId,terminalId,cols,rows}'},
    terminal_signal:{name:'light_remote_signal_terminal',input:'{sessionId,terminalId,signal}'},
    terminal_list:{name:'light_remote_list_terminals',input:'{sessionId}'},
    terminal_stop:{name:'light_remote_stop_terminal',input:'{sessionId,terminalId,force?}'},
    job:{name:'light_remote_job',use:'Poll an existing durable job instead of repeating it.'},
    output:{name:'light_remote_output',input:'{jobId,stream?,offset?,limit?,full?}',use:'Recover bounded or full durable stdout/stderr.'}
  },rule:'Duration alone is not a reason to split. Prefer structured tools first.'}),
  transfer:context=>({kind:'light-remote-tool-helper-group',helperMode:'group-detail',group:'transfer',target:targetFor(context),tools:{
    download_begin:{name:'light_remote_scp_download',scope:'remote:read',integrity:'Whole-file and chunk SHA-256.'},
    download_chunk:{name:'light_remote_scp_download_chunk',scope:'remote:read'},
    download_status:{name:'light_remote_scp_download_status',scope:'remote:read'},
    download_cancel:{name:'light_remote_scp_download_cancel',scope:'remote:read'},
    upload_begin:{name:'light_remote_scp',scope:'remote:write',integrity:'Whole-file and chunk SHA-256.'},
    upload_chunk:{name:'light_remote_scp_upload_chunk',scope:'remote:write'},
    upload_commit:{name:'light_remote_scp_upload_commit',scope:'remote:write'},
    upload_status:{name:'light_remote_scp_upload_status',scope:'remote:read'},
    upload_cancel:{name:'light_remote_scp_upload_cancel',scope:'remote:write'}
  },note:'The old Vercel operator-payload bridge transfer is intentionally not part of Direct MCP.'}),
  desktop:context=>({kind:'light-remote-tool-helper-group',helperMode:'group-detail',group:'desktop',target:targetFor(context),tools:{
    status:{name:'light_remote_desktop'},
    attach:{name:'light_remote_desktop_attach'},
    resume:{name:'light_remote_desktop_resume'},
    detach:{name:'light_remote_desktop_detach'},
    windows:{name:'light_remote_desktop_windows'},
    frame:{name:'light_remote_desktop_frame'},
    observe:{name:'light_remote_desktop_observe'},
    semantic_attach:{name:'light_remote_semantic_attach',providers:['windows-uia','browser-cdp']},
    semantic_snapshot:{name:'light_remote_semantic_snapshot'},
    semantic_events:{name:'light_remote_semantic_events'},
    semantic_detach:{name:'light_remote_semantic_detach'},
    live_open:{name:'light_remote_desktop_live_open'},
    live_read:{name:'light_remote_desktop_live_read',use:'Read already-buffered semantic deltas/snapshot from Hub cache without forcing a new Windows scan.'},
    live_close:{name:'light_remote_desktop_live_close'},
    semantic_action:{name:'light_remote_desktop_input',semanticActions:['invoke','toggle','value','select','expand','collapse','focus','click']},
    input_batch:{name:'light_remote_desktop_input_batch',physicalEvents:['move','click','wheel','drag','text','key']},
    action_await:{name:'light_remote_desktop_action_await'}
  },loop:['Bootstrap with live-open.','Read live deltas from live-read.','Act semantically when possible, otherwise bounded OS input.','Follow returned sequence/observation state; snapshot only for resync.','Close with live-close.'],security:'desktop-input capability and Windows UIPI/secure-desktop boundaries remain authoritative.'})
};
export function helperGroup(group,context={}){
  const id=String(group||'').trim().toLowerCase();
  const fn=chapters[id];
  if(!fn){const e=new Error('invalid_tool_helper_group');e.allowed=Object.keys(GROUPS);throw e;}
  return fn(context);
}
export const HELPER_GROUPS=GROUPS;
