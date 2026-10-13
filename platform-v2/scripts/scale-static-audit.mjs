/**
 * Static source-only scale audit. Intentionally never opens env files,
 * registry state, secret files, active process sockets, or any customer data.
 * Rule matches identify scaling review targets, not confirmed outages.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const rules=[
 {id:'sync-account-snapshot',severity:'P0',file:'operator-host/account-registry.mjs',need:['fs.writeFileSync','this.sessions=new Map'],issue:'Full account/session registry snapshot is synchronously rewritten; not safe as multi-instance authoritative store'},
 {id:'sync-usage-snapshot',severity:'P0',file:'operator-host/usage-registry.mjs',need:['durableAtomicWriteSync','_accrueOpen(aid)'],issue:'Crash-durable atomic JSON usage snapshots remain synchronous and lack multi-process writer fencing'},
 {id:'volatile-oauth-replay',severity:'P0',file:'plugin-server/oauth.mjs',need:['usedCodes=new Map','usedRefresh=new Map'],issue:'OAuth one-time/replay state is scoped to one Node process'},
 {id:'volatile-fleet-jobs',severity:'P0',file:'operator-host/fleet-router.mjs',need:['this.commands=new Map','this.nodes=new Map'],issue:'Device commands, queue and in-flight records are held in a process-local router'},
 {id:'sync-billing-snapshot',severity:'P0',file:'plugin-server/paddle-billing.mjs',need:['durableAtomicWriteSync','slice(0, 1000)'],issue:'Paddle dedupe snapshot now fsyncs, but concurrent writers and its 1,000-event bounded replay history remain unresolved'},
 {id:'volatile-rate-limits',severity:'P1',file:'plugin-server/device-public.mjs',need:['const buckets=new Map'],issue:'Public device/channel rate limits are process-local'},
 {id:'per-request-mcp-allocation',severity:'P1',file:'plugin-server/server.mjs',need:['new StreamableHTTPServerTransport','const server=mcpServer(identity)'],issue:'MCP server and transport are recreated per HTTP POST; benchmark allocation, latency and memory'},
 {id:'sync-static-page-reads',severity:'P2',file:'plugin-server/server.mjs',need:["fs.readFileSync(new URL('./ai-guide.md'"],issue:'Public page handlers read static HTML/guide source synchronously per request'},
 {id:'bounded-active-sessions',severity:'P1',file:'operator-host/session-manager.mjs',need:['this.maxActive','session_capacity_reached'],issue:'Per-Operator active-session ceiling; partition by device/account, do not simply raise global cap'},
 {id:'process-local-event-ring',severity:'P1',file:'operator-host/executor.mjs',need:['const ring = []','const jobs = new Map()'],issue:'Job output/event rings are local to one Operator instance, requiring affinity/durable lookup'},
 {id:'large-json-request-envelopes',severity:'P1',file:'plugin-server/server.mjs',need:["express.json({limit:'12mb'})"],issue:'12 MB JSON requests can cause high transient memory under concurrent large uploads'},
 {id:'sync-pro-team-snapshot',severity:'P0',file:'operator-host/pro-team-registry.mjs',need:['durableAtomicWriteSync','this.teams=new Map'],issue:'Team invite/revoke/seat state now fsyncs, but process-local snapshots still require transactional concurrent writer fencing'},
];
function firstLine(text,marker){
 const index=text.indexOf(marker);
 if(index<0)return null;
 return text.slice(0,index).split('\n').length;
}
const findings=rules.map(rule=>{
 const absolute=path.resolve(repo,rule.file);
 if(!absolute.startsWith(repo+path.sep))throw Error('path_not_in_repo');
 const content=fs.readFileSync(absolute,'utf8');
 const evidence=rule.need.map(mark=>({marker:mark,line:firstLine(content,mark)}));
 return {...rule,evidence,matched:evidence.every(row=>Number.isInteger(row.line))};
});
const report={scope:'source-only',environment:'rc50-mjs-scale-uat',checkedFiles:rules.length,
 counts:Object.fromEntries(['P0','P1','P2'].map(level=>[level,findings.filter(f=>f.severity===level&&f.matched).length])),
 findings};
if(import.meta.url===new URL('file://'+process.argv[1]).href || path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)){
 const json=process.argv.includes('--json');
 if(json)process.stdout.write(JSON.stringify(report,null,2)+'\n');
 else for(const item of findings){
  process.stdout.write((item.matched?'FOUND':'SOURCE_CHANGED')+' '+item.severity+' '+item.id+' '+item.file+' '+item.evidence.map(e=>e.line||'?').join(',')+'\n');
 }
 if(findings.some(x=>!x.matched))process.exitCode=2;
}
export {report};
