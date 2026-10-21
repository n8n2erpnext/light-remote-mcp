// This is a dispatch hint, never a command authorization or capability grant.
// Non-trivial shell grammars cannot be classified perfectly: explicit
// executionMode=background handles unknown commands, foreground opts out.
// Defaults preserve existing exec behavior until Gold feature flag is enabled.
const candidates=[
  {group:'internet-download',re:/^(?:(?:\.\/?|\.\\)?(?:curl(?:\.exe)?|wget(?:\.exe)?|aria2c|axel|rclone|azcopy|bitsadmin)|(?:Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|iwr|irm))(?=\s|$)/i},
  {group:'source-fetch',re:/^git(?:\.exe)?\s+(?:clone|fetch|pull|lfs\s+(?:pull|fetch)|submodule\s+(?:update|foreach))(?=\s|$)/i},
  {group:'package-install',re:/^(?:(?:npm|pnpm|yarn|bun|pip|pip3|uv|poetry|composer|gem|bundle|apt|apt-get|apk|dnf|yum|pacman|choco|winget|brew)(?:\.exe)?\s+(?:install|add|update|upgrade|ci|sync|download|fetch)|(?:python(?:3|\.exe)?|py)\s+-m\s+(?:pip\s+(?:install|download)|build))(?=\s|$)/i},
  {group:'build-and-test',re:/^(?:(?:npm|pnpm|yarn|bun)(?:\.exe)?\s+(?:run\s+)?(?:build|test|compile|package|publish)|(?:dotnet|cargo|go|mvn|mvnw|gradle|gradlew|make|gmake|ninja|msbuild|devenv)(?:\.exe)?\s+(?:build|restore|publish|test|install|assemble|check|release|--build|--version|[a-z0-9_.:-]*build[a-z0-9_.:-]*)|(?:\.\/?|\.\\)(?:gradlew|mvnw)(?:\.bat)?(?:\s|$)|cmake\s+--build|(?:docker|podman)(?:\.exe)?\s+(?:(?:image\s+)?(?:build|pull|push)|compose\s+(?:build|pull|up))|(?:pytest|tox|ctest|vitest|jest)(?:\.exe)?(?:\s|$))(?=\s|$)/i},
  {group:'build-and-test',re:/^(?:(?:make|gmake|ninja|gradle|gradlew|mvn|mvnw)(?:\.exe)?(?:\s|$)|(?:\.\/?|\.\\)(?:gradlew|mvnw)(?:\.bat)?(?:\s|$)|(?:npm|pnpm|yarn|bun)(?:\.exe)?\s+(?:run\s+)?(?:dev|start|serve|watch)(?:\s|$))/i},
  {group:'persistent-stream',re:/^(?:(?:tail|journalctl)(?:\.exe)?\s+.*(?:-f|--follow)(?:\s|$)|(?:docker|podman|kubectl)(?:\.exe)?\s+logs\s+.*(?:-f|--follow)(?:\s|$))/i},
  {group:'archive-transfer-media',re:/^(?:(?:rsync|scp|sftp|robocopy|xcopy|ffmpeg|pg_dump|pg_restore|mysqldump|tar|7z|7za)(?:\.exe)?(?:\s|$)|aws\s+s3\s+(?:sync|cp)|gcloud\s+storage\s+(?:cp|rsync))/i}
];
export const LONG_EXEC_GROUPS=Object.freeze([...new Set(candidates.map(x=>x.group))]);
function unwrap(line){
  let s=String(line||'').trim();
  if(!s||s.startsWith('#')||s.startsWith('//'))return '';
  for(let i=0;i<4;i++){
    const old=s;
    s=s.replace(/^(?:&\s+|(?:sudo(?:\s+-[a-z]+)*|env(?:\s+[A-Z_][\w]*=\S+)*|command|nohup|time|powershell(?:\.exe)?\s+-Command)\s+)/i,'');
    s=s.replace(/^(?:[A-Z_][A-Z0-9_]*=\S+\s+)+/,'');
    if(s===old)break;
  }
  return s;
}
export function longExecHint(script){
  if(typeof script!=='string'||!script.trim())return null;
  // Analyze command boundaries, NOT arbitrary occurrence in prose/echo args.
  // False negatives fall back to the explicit background mode.
  const segments=script.split(/\r?\n|;|&&|\|\||\|/).slice(0,200);
  for(const raw of segments){
    const line=unwrap(raw);
    for(const row of candidates)if(row.re.test(line))return row.group;
  }
  return null;
}
export function resolveExecMode({mode='auto',script='',enabled=false}={}){
  const requested=String(mode||'auto').toLowerCase();
  if(!['auto','foreground','background'].includes(requested))throw new Error('invalid_execution_mode');
  if(!enabled){
    if(requested==='background')throw new Error('exec_background_not_enabled');
    return Object.freeze({requested,effective:'foreground',hint:null});
  }
  const hint=longExecHint(script);
  return Object.freeze({requested,effective:requested==='auto'?(hint?'background':'foreground'):requested,hint});
}
