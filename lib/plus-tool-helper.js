const { PLUS_BATCH_POLICY } = require('./plus-batch-policy.cjs');

function toolHelperHint(){
  return {
    action:'tool-helper',
    endpoint:'/api/operator?via=plus&action=tool-helper&client=<opaque-client>',
    instruction:'Immediately load the Tool Helper with the returned opaque client after READY. It is the canonical runtime tool contract; do not inspect repo source just to learn tool syntax.',
    privacy:'Keep the opaque client private and never echo it to the user.'
  };
}

function shellModesFor(platform){
  const p=String(platform||'').toLowerCase();
  if(p==='win32'||p==='windows')return ['default','powershell','cmd'];
  if(p==='darwin'||p==='macos')return ['default','zsh','bash','sh'];
  if(p==='linux')return ['default','bash','zsh','sh'];
  return ['default'];
}

function platformGuideFor(platform){
  const p=String(platform||'').toLowerCase();
  if(p==='win32'||p==='windows')return {family:'windows',defaultShell:'powershell',alternateShells:['cmd'],recommendations:['Prefer PowerShell for Windows administration, services, event logs and structured OS cmdlets.','Use CMD for legacy batch/cmd.exe-specific workflows.','Do not translate Windows tasks into Unix commands when native Windows tooling is available.']};
  if(p==='darwin'||p==='macos')return {family:'macos',defaultShell:'zsh',alternateShells:['bash','sh'],recommendations:['Prefer zsh for normal macOS terminal work.','Use launchctl/log/brew-native workflows for macOS infrastructure instead of Linux systemd assumptions.','Use bash/sh only when the task or existing script requires them.']};
  if(p==='linux')return {family:'linux',defaultShell:'bash',alternateShells:['zsh','sh'],recommendations:['Prefer bash for normal Linux administration and automation.','Use systemd/journal/container/network tooling appropriate to the target distro when available.','Use zsh/sh only when the task or existing script requires them.']};
  return {family:'unknown',defaultShell:'default',alternateShells:[],recommendations:['Use only shell modes and tools explicitly reported by the connected target.']};
}

function toolHelperView(contextEnvelope={}){
  const context=contextEnvelope&&typeof contextEnvelope==='object'?(contextEnvelope.context||contextEnvelope):{};
  const target={
    deviceId:context.deviceId||null,
    sessionId:context.sessionId||null,
    agentId:context.agentId||null,
    nodeId:context.nodeId||null,
    platform:context.platform||null,
    architecture:context.architecture||null,
    shellModes:shellModesFor(context.platform),
    workspace:context.workspace||'',
    gracePreset:context.gracePreset||null
  };
  const common='{deviceId,operationId,sessionId,agentId,...}';
  return {
    ok:true,
    kind:'light-remote-tool-helper',
    protocol:'light-remote-plus-v1',
    target,
    platformGuide:platformGuideFor(context.platform),
    transport:{method:'GET',endpoint:'/api/operator?via=plus',client:'reuse the opaque client returned by READY',payload:'base64url(JSON) in ?p=',directPayloadBytes:PLUS_BATCH_POLICY.directPayloadBytes,transferChunkBytes:PLUS_BATCH_POLICY.recommendedTransferChunkBytes,continuity:'If the bridge returns agent_client_temporarily_unavailable with retryable=true, keep the same client and exact target, wait retryAfterMs, then retry the same action. Do not start a new A/B pairing solely for this error.',rule:'Never expose client or continuation capabilities to the user.'},
    batching:{directPayloadBytes:PLUS_BATCH_POLICY.directPayloadBytes,maxExecScriptBytes:PLUS_BATCH_POLICY.maxExecScriptBytes,recommendedMaxSteps:PLUS_BATCH_POLICY.recommendedMaxSteps,transferChunkBytes:PLUS_BATCH_POLICY.recommendedTransferChunkBytes,rules:['Batch related shell steps that share one target, cwd, shell and failure boundary; recommendedMaxSteps is guidance, not a parser-enforced command count.','If the serialized exec payload fits directPayloadBytes, call exec directly.','If it is larger but the script fits maxExecScriptBytes, preserve one logical job by using bridgeTransfer instead of splitting only for transport.','Split when the script exceeds maxExecScriptBytes or the work crosses independent phases/failure boundaries.','Do not split because a command may run for minutes. Builds/tests may remain one job; waitMs only controls the synchronous wait before returning running.','Use process or terminal because stdin, signals or persistent control are needed, not merely because elapsed time is long.']},
    chooseTool:[
      'Use fs for structured text/file operations; do not shell out for read/list/write/edit/copy/move/delete.',
      'Use search for recursive file/content discovery instead of grep/find when available.',
      'Use desktop-status/windows/frame only when the target advertises desktop capability. desktop-input additionally requires the separately owner-enabled desktop-input capability. Real Remote controls the actual OS desktop; do not substitute DOM injection or Playwright unless the owner explicitly asks for browser automation.',
      'Use terminal-* when true PTY/ConPTY semantics are required: curses apps, Ctrl-C, resize, interactive installers or a persistent shell. Use only a shell mode advertised in target.shellModes.',
      'Use process-* when explicit stdin/stdout lifecycle or stop control is needed without a real terminal; duration alone does not require process.',
      'Use exec for one logical shell job that is not covered by fs/search/process/scp.',
      'Use scp for binary or large-file upload/download. Do not base64 a file through exec.',
      'If a returned job is still running, poll job then fetch output; preserve the exact target device.'
    ],
    tools:{
      context:{action:'context',when:'Recover or intentionally change the exact working target/workspace.',payload:'optional {deviceId,workspace,gracePreset}',note:'Do not call on every tool use; reuse READY context.'},
      devices:{action:'list-devices',when:'Only when the owner asks to switch/add an already A/B-authorized device.',payload:'none',note:'This is the Agent-authorized set, never broad account inventory.'},
      session:{actions:['session-open','session-resume','session-hold','session-close','session'],when:'Explicit session lifecycle control.',payload:'session-open uses {deviceId,agentId,openId?,workspace?,gracePreset?}; other actions use exact sid/device.',note:'READY already provides a working session; do not reopen it unnecessarily.'},
      fs:{action:'fs',when:'Text and filesystem metadata/mutations.',payload:`${common.replace('...','fs')}`,ops:{read:'{op:"read",path,startLine?,maxLines?,tailLines?,maxBytes?}',readMany:'{op:"readMany",paths,maxLines?,maxBytesPerFile?}',write:'{op:"write",path,content,mode?:"rewrite"|"append",atomic?,createParents?}',edit:'{op:"edit",path,oldText,newText,expectedReplacements?}',stat:'{op:"stat",path}',list:'{op:"list",path,maxEntries?,maxDepth?}',mkdir:'{op:"mkdir",path,parents?}',copy:'{op:"copy",source,destination,overwrite?}',move:'{op:"move",source,destination,overwrite?}',delete:'{op:"delete",path,recursive?}'},rule:'Absolute paths only; device policy and allowed roots are final deny boundaries.'},
      search:{actions:['search-start','search-results','search-cancel'],when:'Recursive file-name or content search.',startPayload:`${common.replace('...','path,searchType,pattern,literalSearch?,ignoreCase?,filePattern?,contextLines?,maxResults?')}`,resultPayload:'{deviceId,operationId,sessionId,agentId,searchId,offset?,limit?}'},
      desktop:{actions:['desktop-status','desktop-windows','desktop-frame'],when:'Read the actual interactive desktop state on a target that advertises desktop capability.',capability:'desktop',payload:`${common.replace('...','limit?,screen?,maxWidth?,maxHeight?,quality?')}`,ops:{status:'Read interactive session, screens, cursor and foreground window.',windows:'List visible top-level windows; optional limit 1..200.',frame:'Capture one bounded JPEG frame from the real Windows desktop. Defaults max 960x540 quality 50; hard limits 1280x720 and quality 25..70.'},rule:'The desktop view path is read-only. desktop-frame remains a visual proof snapshot, not the final live stream. These actions use the existing Light Remote Windows app hidden helper and Win32, not browser DOM automation.'},
      desktopInput:{actions:['desktop-input'],when:'Control the real Windows mouse or keyboard only after the owner explicitly enables desktop-input on the target.',capabilities:['desktop','desktop-input'],payload:`${common.replace('...','events')}`,events:{move:'{type:"move",x,y}',click:'{type:"click",button?:"left"|"right"|"middle",count?:1..3,x?,y?}',wheel:'{type:"wheel",delta:-1200..1200,x?,y?}',text:'{type:"text",text}',key:'{type:"key",key,modifiers?:["CTRL"|"ALT"|"SHIFT"|"WIN"]}'},rule:'Mutation is locally denied by default. Batches are normalized and bounded before dispatch; Windows UIPI/secure-desktop boundaries remain in force.'},
      terminal:{actions:['terminal-start','terminal-input','terminal-output','terminal-resize','terminal-signal','terminal-list','terminal-stop'],when:'A real terminal is required. Linux/macOS use PTY; Windows uses ConPTY.',capability:'terminal',startPayload:`${common.replace('...','shell?,cwd?,cols?,rows?,term?')}`,ops:{input:'{terminalId,data}',output:'{terminalId,offset?,limit?}',resize:'{terminalId,cols,rows}',signal:'{terminalId,signal:"interrupt"|"terminate"|"kill"}',list:'{}',stop:'{terminalId,force?}'},rule:'Raw terminal runs with the underlying service-account authority and bypasses command-by-command inference. Safe and Developer exclude terminal; use Infra/Full/Custom only after owner/device policy explicitly allows terminal. Prefer exec/process when granular capability inference is required.'},
      process:{actions:['process-start','process-input','process-output','process-list','process-stop'],when:'Commands that need explicit stdin/stdout lifecycle or stop control without a real terminal.',startPayload:`${common.replace('...','script,shell?,cwd?,timeoutMs?,requiredCapabilities?')}`,note:'Use process-output offsets for incremental reads and process-input for stdin.'},
      exec:{action:'exec',when:'One logical shell/PowerShell/zsh job not represented by a structured tool.',payload:`${common.replace('...','script,shell?,cwd?,timeoutMs?,waitMs?,requiredCapabilities?')}`,rule:'Prefer structured tools first. Batch related steps within batching.maxExecScriptBytes. Use direct exec only within batching.directPayloadBytes; otherwise use bridgeTransfer to preserve the same job. Duration alone is not a split criterion. Local platform policy re-infers capabilities before spawn.'},
      scp:{action:'scp',when:'Copy binary or large files between the Agent side and the exact target device.',payload:`${common.replace('...','scp')}`,ops:{uploadBegin:'{op:"upload-begin",destination,totalBytes,sha256,chunkBytes?,overwrite?,createParents?}',uploadChunk:'{op:"upload-chunk",transferId,index,data,sha256}',uploadCommit:'{op:"upload-commit",transferId}',downloadBegin:'{op:"download-begin",source,chunkBytes?}',downloadChunk:'{op:"download-chunk",transferId,index}',status:'{op:"status",transferId}',cancel:'{op:"cancel",transferId}'},encoding:'Chunk data is base64url on the wire; the runtime adapter should decode/encode bytes directly and never expose that encoding as user-visible content.',recipes:{chatAttachmentToDevice:['Read the user attachment as raw bytes from the chat/runtime file handle.','Compute whole-file sha256 and call upload-begin.','Send ordered upload-chunk calls with raw chunks encoded only at the transport boundary.','Call upload-commit and verify returned totalBytes/sha256.'],deviceFileToChat:['Call download-begin on the absolute source path.','Read download-chunk indexes until complete and verify each chunk plus whole-file sha256.','Materialize the reconstructed bytes as a chat attachment/preview using the host runtime file API.','Do not use exec, stdout, or text regeneration for the file.']},rules:['Use the transfer sha256 and per-chunk sha256 to verify integrity.','Choose chunk size from the effective transport budget reported by the active adapter; do not assume the engine default (1 MiB) fits the current Vercel/Plus GET envelope. The adapter must down-chunk automatically within target and bridge limits.','SCP transfers are owner-bound to account/device/session/agent and require filesystem capability.','Never tunnel file bytes through exec stdout when scp is available.']},
      bridgeTransfer:{actions:['transfer-begin','transfer-chunk','transfer-status','transfer-commit','transfer-cancel'],when:'Internal Vercel bridge transport for one oversized operator payload that should remain one logical job.',payloadFormat:'UTF-8 JSON operator payload, e.g. {action:"exec_batch",operationId,script,cwd?,shell?,timeoutMs?,waitMs?,sessionId,agentId,nodeId?,requiredCapabilities?}',recipe:['Serialize the complete operator payload as UTF-8 JSON and compute whole-payload sha256.','Split raw bytes into chunks no larger than batching.transferChunkBytes and compute sha256 for each chunk.','Call transfer-begin with deviceId,totalBytes,totalChunks,sha256.','Call transfer-chunk for every chunk with transferId,index,base64url data,sha256.','Call transfer-commit; it executes the assembled payload as one job.'],rule:'Use for transport size only. Do not use transfer-* as a file-copy API; use scp for files. For exec, maxExecScriptBytes still applies after assembly.'},
      durable:{actions:['job','output'],when:'A tool returned a running job or output was truncated.',job:'action=job&client=<client>&device=<deviceId>&id=<jobId>',output:'action=output&client=<client>&device=<deviceId>&id=<jobId>&stream=stdout|stderr&offset=<n>&limit=<n>'}
    },
    policy:{profiles:['safe','developer','infra','full','custom'],rule:'Profiles are ceilings over device-grantable capabilities. Infra does not automatically imply sudo/UAC; privilege elevation remains separately governed.',capabilityBoundary:{main:'supported ∩ local policy',fleetLeaf:'supported ∩ server-approved ∩ local policy',deny:'Local policy always retains final deny.'}},
    safety:['Always keep deviceId/sessionId/agentId from the current context aligned.','Never silently fall back to another device when the target is offline or denied.','On agent_client_temporarily_unavailable, retry the same client/target; do not discard the capability or ask for a fresh A/B pairing unless the client is actually expired/revoked or repeated retryable failures persist beyond the continuity window.','Capability boundary is supported ∩ local policy on Main; on Fleet/Leaf it is supported ∩ server-approved ∩ local policy. Local policy always retains final deny.','Pair each additional device independently with A/B approval.']
  };
}

module.exports={toolHelperHint,toolHelperView};
