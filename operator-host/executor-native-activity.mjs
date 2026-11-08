export function createNativeActivityFormatter({redact}) {
function fsActivityMeta(request={}){
  const op=String(request.op||'unknown'),meta={kind:'fs',op};
  if(request.path!=null)meta.path=String(request.path);
  if(Array.isArray(request.paths)){meta.paths=request.paths.slice(0,4).map(value=>String(value));meta.pathCount=request.paths.length;}
  if(request.source!=null)meta.source=String(request.source);
  if(request.destination!=null)meta.destination=String(request.destination);
  if(op==='write'){meta.bytes=Buffer.byteLength(String(request.content||''),'utf8');meta.mode=String(request.mode||'rewrite');meta.atomic=request.atomic!==false;meta.createParents=request.createParents===true;}
  if(op==='edit'){meta.oldBytes=Buffer.byteLength(String(request.oldText||''),'utf8');meta.newBytes=Buffer.byteLength(String(request.newText||''),'utf8');if(request.expectedReplacements!=null)meta.expectedReplacements=Number(request.expectedReplacements);}
  if(op==='read'){for(const key of ['startLine','maxLines','tailLines','maxBytes'])if(request[key]!=null)meta[key]=Number(request[key]);}
  if(op==='readMany'){if(request.maxLines!=null)meta.maxLines=Number(request.maxLines);if(request.maxBytesPerFile!=null)meta.maxBytesPerFile=Number(request.maxBytesPerFile);}
  if(op==='list'){if(request.maxEntries!=null)meta.maxEntries=Number(request.maxEntries);if(request.maxDepth!=null)meta.maxDepth=Number(request.maxDepth);}
  if(op==='mkdir')meta.parents=request.parents===true;
  if(op==='copy'||op==='move')meta.overwrite=request.overwrite===true;
  if(op==='delete')meta.recursive=request.recursive===true;
  return meta;
}
function fsActivityResult(meta,data){
  if(!data||data.ok===false)return '';
  const op=String(meta?.op||data.operation||'');
  if(op==='write')return `wrote ${Number(data.writtenBytes??meta?.bytes??0)} B`;
  if(op==='edit'){const count=Number(data.replacements||0);return `${count} replacement${count===1?'':'s'}`;}
  if(op==='read'){const bytes=Buffer.byteLength(String(data.text||''),'utf8');return `read ${bytes} B${data.truncated?' (truncated)':''}`;}
  if(op==='readMany')return `${Array.isArray(data.files)?data.files.length:Number(meta?.pathCount||0)} files`;
  if(op==='list')return `${Array.isArray(data.entries)?data.entries.length:0} entries${data.truncated?' (truncated)':''}`;
  if(op==='stat')return `${String(data.type||'item')}${Number.isFinite(Number(data.size))?' '+Number(data.size)+' B':''}`;
  if(op==='copy'||op==='move'||op==='mkdir'||op==='delete')return 'completed';
  return '';
}

function shortNativeId(value){const text=String(value||'');return text.length>18?text.slice(0,18)+'…':text;}
function scpActivityMeta(request={}){
  const op=String(request.op||'unknown').toLowerCase(),meta={kind:'scp',op};
  if(request.source!=null)meta.source=String(request.source);
  if(request.destination!=null)meta.destination=String(request.destination);
  if(request.transferId!=null)meta.transferId=String(request.transferId);
  if(request.offset!=null)meta.offset=Number(request.offset);
  if(request.index!=null)meta.index=Number(request.index);
  if(request.totalBytes!=null)meta.totalBytes=Number(request.totalBytes);
  if(request.chunkBytes!=null)meta.chunkBytes=Number(request.chunkBytes);
  if(request.overwrite!=null)meta.overwrite=request.overwrite===true;
  if(request.createParents!=null)meta.createParents=request.createParents===true;
  if(request.data!=null)meta.bytes=Buffer.byteLength(String(request.data),'utf8');
  return meta;
}
function processActivityMeta(request={}){
  const op=String(request.op||'unknown').toLowerCase(),meta={kind:'process',op};
  if(request.processId!=null)meta.processId=String(request.processId);
  if(request.cwd!=null)meta.cwd=String(request.cwd);
  if(request.shell!=null)meta.shell=String(request.shell);
  if(request.timeoutMs!=null)meta.timeoutMs=Number(request.timeoutMs);
  if(op==='input'){meta.inputBytes=Buffer.byteLength(String(request.data||''),'utf8');meta.eof=request.eof===true;}
  if(op==='output'){meta.stream=String(request.stream||'stdout');meta.offset=Math.max(0,Number(request.offset)||0);meta.limit=Math.max(1,Number(request.limit)||262144);}
  if(op==='stop')meta.force=request.force===true;
  return meta;
}
function searchActivityMeta(request={}){
  const op=String(request.op||'unknown').toLowerCase(),meta={kind:'search',op};
  if(request.path!=null)meta.path=String(request.path);
  if(request.searchType!=null)meta.searchType=String(request.searchType);
  if(request.pattern!=null)meta.pattern=redact(String(request.pattern)).slice(0,180);
  if(request.filePattern!=null)meta.filePattern=String(request.filePattern);
  if(request.searchId!=null)meta.searchId=String(request.searchId);
  if(request.offset!=null)meta.offset=Math.max(0,Number(request.offset)||0);
  if(request.limit!=null)meta.limit=Math.max(1,Number(request.limit)||0);
  if(request.maxResults!=null)meta.maxResults=Math.max(1,Number(request.maxResults)||0);
  return meta;
}
function nativeActivityResult(meta,data){if(!data||typeof data!=='object')return '';if(data.ok===false)return 'error · '+redact(String(data.error||'operation failed'));const kind=String(meta?.kind||''),op=String(meta?.op||data.operation||'');if(kind==='fs')return fsActivityResult(meta,data);if(kind==='terminal')return terminalResultSummary(data);if(kind==='search'){const v=data.search&&typeof data.search==='object'?data.search:data,p=[];if(v.state)p.push(String(v.state));if(Number.isFinite(Number(v.returned)))p.push(String(Number(v.returned))+' returned');if(Number.isFinite(Number(v.resultCount)))p.push(String(Number(v.resultCount))+' result'+(Number(v.resultCount)===1?'':'s'));if(Number.isFinite(Number(v.scannedFiles)))p.push(String(Number(v.scannedFiles))+' files scanned');if(Number.isFinite(Number(v.scannedDirs)))p.push(String(Number(v.scannedDirs))+' dirs');if(v.hasMore===true)p.push('more available');return p.join(' · ')||'completed';}if(kind==='process'){if(op==='list'&&Array.isArray(data.processes)){const r=data.processes.filter(x=>x?.state==='running').length;return data.processes.length+' process'+(data.processes.length===1?'':'es')+' · '+r+' running';}const v=data.process&&typeof data.process==='object'?data.process:data,p=[];if(v.state)p.push(String(v.state));if(v.processId)p.push(shortNativeId(v.processId));if(v.pid)p.push('pid '+String(v.pid));if(Number.isFinite(Number(v.exitCode)))p.push('exit '+String(v.exitCode));if(Number.isFinite(Number(v.stdoutBytes)))p.push('stdout '+String(v.stdoutBytes)+' B');if(Number.isFinite(Number(v.stderrBytes)))p.push('stderr '+String(v.stderrBytes)+' B');if(data.output&&Number.isFinite(Number(data.output.returnedBytes)))p.push(String(data.output.returnedBytes)+' B returned');return p.join(' · ')||'completed';}if(kind==='scp'){const v=data.transfer&&typeof data.transfer==='object'?data.transfer:data.result&&typeof data.result==='object'?data.result:data.chunk&&typeof data.chunk==='object'?data.chunk:data,p=[];if(v.mode)p.push(String(v.mode));if(v.path)p.push(String(v.path));if(Number.isFinite(Number(v.progressBytes))&&Number.isFinite(Number(v.totalBytes)))p.push(String(v.progressBytes)+'/'+String(v.totalBytes)+' B');else if(Number.isFinite(Number(v.bytes)))p.push(String(v.bytes)+' B');else if(Number.isFinite(Number(v.totalBytes)))p.push(String(v.totalBytes)+' B');if(Number.isFinite(Number(v.progressChunks))&&Number.isFinite(Number(v.totalChunks)))p.push(String(v.progressChunks)+'/'+String(v.totalChunks)+' chunks');if(v.complete===true)p.push('complete');if(v.cancelled===true)p.push('cancelled');return p.join(' · ')||'completed';}return '';}


function shortTerminalId(value){const text=String(value||'');return text.length>18?text.slice(0,18)+'…':text;}
function terminalInputPreview(value){
  const raw=String(value||''),bytes=Buffer.byteLength(raw),unsafeControl=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw);
  let text=raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g,'').replace(/\n+/g,' ↵ ').trim();
  const safeBare=/^(?:pwd|ls|id|whoami|date|uptime|clear|exit|env|set|help|history|jobs|fg|bg|ps|top|htop|df|du|free|uname|hostname|stty)$/i.test(text),bare=/^[^\s|;&<>]+$/.test(text);
  const suspicious=(bare&&!safeBare)||/^(?:[A-Za-z0-9._~+\/=-]{16,})$/.test(text)||/(?:password|passwd|token|secret|api[_-]?key|authorization|bearer|private key)/i.test(text);
  if(unsafeControl||suspicious)text='';else text=redact(text).slice(0,180);
  return {bytes,preview:text};
}
function terminalWallMeta(request={}){
  const op=String(request.op||'unknown').toLowerCase(),terminalId=String(request.terminalId||''),handle=shortTerminalId(terminalId),input=op==='input'?terminalInputPreview(request.data):{bytes:0,preview:''};
  let label='PTY '+op.toUpperCase();
  if(op==='start')label+=' · '+String(request.shell||'default')+' · '+String(Number(request.cols)||120)+'×'+String(Number(request.rows)||32)+(request.cwd?' · '+String(request.cwd):'');
  else if(op==='input')label+=' · '+(handle||'terminal')+' · '+(input.preview||String(input.bytes)+' B input');
  else if(op==='output')label+=' · '+(handle||'terminal')+' · offset '+String(Math.max(0,Number(request.offset)||0))+' · limit '+String(Math.max(1,Number(request.limit)||262144))+' B';
  else if(op==='resize')label+=' · '+(handle||'terminal')+' · '+String(Number(request.cols)||120)+'×'+String(Number(request.rows)||32);
  else if(op==='signal')label+=' · '+(handle||'terminal')+' · '+String(request.signal||'interrupt');
  else if(op==='stop')label+=' · '+(handle||'terminal')+' · '+(request.force?'force':'graceful');
  return {kind:'terminal',op,terminalId:terminalId||null,shell:op==='start'?String(request.shell||'default'):null,cwd:op==='start'?String(request.cwd||''):null,cols:['start','resize'].includes(op)?Number(request.cols)||null:null,rows:['start','resize'].includes(op)?Number(request.rows)||null:null,signal:op==='signal'?String(request.signal||'interrupt'):null,force:op==='stop'?Boolean(request.force):null,inputBytes:op==='input'?input.bytes:null,inputPreview:op==='input'?(input.preview||null):null,label:redact(label)};
}
function terminalResultSummary(data){
  if(!data||typeof data!=='object')return '';
  const op=String(data.operation||''),list=Array.isArray(data.terminals)?data.terminals:null;
  if(op==='list'&&list){const running=list.filter(x=>x&&x.state==='running').length;return list.length+' terminal'+(list.length===1?'':'s')+' · '+running+' running';}
  const t=data.terminal&&typeof data.terminal==='object'?data.terminal:data,parts=[];
  if(t.state)parts.push(String(t.state));if(t.terminalId)parts.push(shortTerminalId(t.terminalId));if(op==='start'&&t.pid)parts.push('pid '+String(t.pid));
  if(op==='resize'&&t.cols&&t.rows)parts.push(String(t.cols)+'×'+String(t.rows));
  if(op==='output'&&data.output){parts.push(String(Number(data.output.returnedBytes)||0)+' B');parts.push('offset '+String(Number(data.output.nextOffset)||0)+'/'+String(Number(data.output.totalBytes)||0));}
  else if((op==='input'||op==='signal'||op==='stop')&&Number.isFinite(Number(t.outputBytes)))parts.push('buffer '+String(Number(t.outputBytes)||0)+' B');
  return parts.join(' · ');
}


  return {fsActivityMeta,fsActivityResult,shortNativeId,scpActivityMeta,processActivityMeta,searchActivityMeta,nativeActivityResult,shortTerminalId,terminalInputPreview,terminalWallMeta,terminalResultSummary};
}
