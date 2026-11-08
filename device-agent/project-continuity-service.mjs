/* Opt-in standalone process; not imported from Agent/Wall or package manifest. */
import {startContinuityServer,continuityRequest} from './project-continuity-ipc.mjs';
import {continuityDefaultRoot} from './project-continuity-store.mjs';
import {pathToFileURL} from 'node:url';

function arg(name){const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];}
const root=arg('--root')||process.env.LIGHT_REMOTE_CONTINUITY_ROOT||continuityDefaultRoot();
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const op=process.argv[2];
 if(op==='serve'){
  const srv=startContinuityServer({root});
  let closed=false;
  const shutdown=()=>{if(closed)return;closed=true;srv.stop().then(()=>process.exit(0)).catch(()=>process.exit(1));};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
 }else if(op==='health'||op==='listProjects'){
  continuityRequest(op,{}, {root}).then(v=>{console.log(JSON.stringify(v,null,2));}).catch(e=>{console.error(e.message);process.exitCode=1;});
 }else if(op==='brief'){
  // Explicit project ID required. No guessed "current project", no token echo.
  const projectId=process.argv[3];
  if(!/^[a-f0-9-]{36}$/.test(String(projectId||'')))throw Error('continuity_invalid_id');
  continuityRequest('contextBrief',{projectId,maxChars:10000},{root}).then(v=>console.log(v.content)).catch(e=>{console.error(e.message);process.exitCode=1;});
 }else{
  console.error('usage: project-continuity-service.mjs serve|health|listProjects|brief PROJECT_ID [--root DIR]');process.exitCode=2;
 }
}
