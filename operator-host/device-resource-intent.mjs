import path from 'node:path';
// Source of locks: verified session.deviceId + known structured tool arguments.
// Never take caller-supplied account/device/lock ownership or guessed aliases.
const windowsDrive=x=>/^[a-zA-Z]:[\\/]/.test(x);
function normalizedPath(raw){
 const value=String(raw||'').trim();
 if(!value||value.includes('\0')||value.length>4096||!path.isAbsolute(value)&&!windowsDrive(value))return null;
 const win=windowsDrive(value)||value.startsWith('\\\\');
 const result=win?path.win32.normalize(value).toLowerCase():path.posix.normalize(value);
 if(!result||result==='/'||/^[a-z]:\\?$/i.test(result))return null;
 return result.replaceAll('\\','/');
}
function scopePath(p){
 // Conservative directory scope, not per-file exact-text identity. A
 // device-realpath canonicalization/fencing check is required before enabling
 // full arbitrary-path parallel writes across symlink/junction aliases.
 return p?path.posix.dirname(p):null;
}
function intent(resourceKey,mode='exclusive',workerWeight=1){
 return {resourceKey:String(resourceKey).slice(0,480),mode,workerWeight};
}
const readOnly=new Set(['read','list','stat','search','results','output','status']);
const writeCommands=/(?:^|[;&|\s])(?:npm|pnpm|yarn|make|cmake|cargo|go\s+build|dotnet\s+build|gradle|mvn|pip\s+install|apt|apk|dpkg|docker\s+build|git\s+(?:checkout|reset|pull|merge)|rm|mv|cp|touch|tee|sed\s+-i)(?:\s|$)/i;
const downloadCommands=/(?:^|[\s;&|])(?:curl(?:\.exe)?|wget|Invoke-WebRequest|Start-BitsTransfer)(?:\s|$)/i;
export function deviceResourceIntent({family='',op='',request={},cwd='',script=''}={}){
 const action=String(op),type=String(family);
 if(type==='fs'){
  const p=normalizedPath(request.path||request.destination||request.source);
  if(!p)return intent('filesystem:unknown','exclusive');
  // All file mutations within a directory serialize, reads are shared.
  return intent('file-dir:'+scopePath(p),readOnly.has(action)?'shared':'exclusive');
 }
 if(type==='scp'){
  const p=normalizedPath(request.destination||request.source);
  return intent(p?'file-dir:'+scopePath(p):'filesystem:unknown',
   ['download-begin','download-chunk'].includes(action)?'shared':'exclusive');
 }
 if(type==='search')return intent('file-dir:'+(normalizedPath(request.path)||'unknown'),'shared',0);
 if(type==='terminal')return intent('terminal:'+ (normalizedPath(request.cwd)||'unknown'),'shared',0);
 if(type==='process'||type==='exec'){
  const workspace=normalizedPath(request.cwd||cwd)||'unknown';
  const command=String(request.script||script||'');
  // curl/wget can write to disk for minutes even when the command otherwise
  // appears read-only. A shared `download:cwd` key did not conflict with
  // builds (`project:cwd`) or filesystem edits (`file-dir:cwd`) and could
  // allow concurrent writes. Keep a worker weight throughout M4.1 lease.
  if(downloadCommands.test(command)){
   if(workspace==='unknown')return intent('filesystem:unknown','exclusive',1);
   // When a download explicitly targets an absolute output file, lock its
   // destination directory (including when outside cwd). Complex shell
   // quoting and redirections cannot be safely inferred lexically, so
   // those cases conservatively hold a device-wide filesystem lock.
   const explicit=command.match(/(?:^|\s)(?:-o|--output|-O|--output-document)(?:=|\s+)(?:["']?)(\/[^\s"';|&]+)(?:["']?)(?=\s|$|[;&|])/i);
   if(explicit){
    const dest=normalizedPath(explicit[1]);
    return intent(dest?'file-dir:'+scopePath(dest):'filesystem:unknown','exclusive',1);
   }
   // Output-directory flags and compact -oFILE forms are too ambiguous
   // without executing a shell parser and resolving the remote path.
   if(/[|;&<>]|(?:\s(?:--output-dir|--directory-prefix|-P|--output|-o|-O|--output-document)(?:\s|=|\/|\.))/.test(command))
    return intent('filesystem:unknown','exclusive',1);
   return intent('project:'+workspace,'exclusive',1);
  }
  if(writeCommands.test(command)||workspace==='unknown')return intent('project:'+workspace,'exclusive',1);
  return intent('project:'+workspace,'shared',0);
 }
 return intent('device:unknown','exclusive');
}
export function resourcePathsOverlap(a,b){
 const x=String(a||''),y=String(b||'');
 if(x===y)return true;
 // Unknown filesystem *or workspace* paths cannot be proven disjoint.
 // Treat an unknown project path as a device-wide conflict. Otherwise an
 // old background worker with cwd=unknown may overlap an apparently distinct
 // file-dir:C:/... write, silently breaking the M4 exclusive-lease guarantee.
 if(x==='device:unknown'||y==='device:unknown'||
    x==='filesystem:unknown'||y==='filesystem:unknown'||
    x==='project:unknown'||y==='project:unknown')return true;
 const resource=q=>q.slice(q.indexOf(':')+1);
 const pathClass=x.startsWith('file-dir:')||x.startsWith('project:');
 const otherPathClass=y.startsWith('file-dir:')||y.startsWith('project:');
 if(pathClass&&otherPathClass){
  const p=resource(x),q=resource(y);
  return p===q||p.startsWith(q+'/')||q.startsWith(p+'/');
 }
 return false;
}
