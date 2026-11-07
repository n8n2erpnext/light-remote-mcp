import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {projectOwnerActivityPage,nativeOwnerActivityPage} from './native-activity';
const base={ok:true,accountId:'owner',kind:'usage',asOf:1000,month:'2026-11',
 rows:[{deviceId:'d-1',toolCalls:2,onlineMs:300,secret:'DO_NOT_EXPOSE'}],
 coverage:{returned:1,total:250,hasMore:true,nextCursor:'NextCursor_1234',
  source:'owner_current_month_usage'}};
describe('F15 Owner typed pages',()=>{
 beforeEach(()=>{vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');vi.stubEnv('VITE_LR_V4_OWNER_SNAPSHOT','1');});
 afterEach(()=>vi.unstubAllEnvs());
 it('sanitizes current-month usage and rejects fabricated coverage',()=>{
  const valid=projectOwnerActivityPage(base,'owner','usage');
  expect(valid.state).toBe('ready');
  expect(JSON.stringify(valid)).not.toContain('DO_NOT_EXPOSE');
  for(const patch of [
    {accountId:'other'}, {kind:'jobs'},
    {coverage:{...base.coverage,source:'in_memory_current_window'}},
    {coverage:{...base.coverage,total:0}},
    {coverage:{...base.coverage,returned:2}},
    {coverage:{...base.coverage,hasMore:false}},
    {month:'2026-13'},
    {rows:[base.rows[0],base.rows[0]]}
  ])expect(projectOwnerActivityPage({...base,...patch},'owner','usage').state).toBe('unavailable');
 });
 it('job and session views omit untrusted output, workspace and token fields',()=>{
  const jobs={...base,kind:'jobs',month:undefined,
   coverage:{...base.coverage,source:'in_memory_current_window'},
   rows:[{jobId:'job-1',deviceId:'d-1',state:'running',agentId:'agent-1',
     sessionId:'s-1',startedAt:10,finishedAt:null,exitCode:null,stdout:'PRIVATE'}]};
  const sessions={...jobs,kind:'sessions',rows:[
   {sessionId:'s-1',deviceId:'d-1',state:'active',agentId:'agent-1',
    createdAt:1,lastSeenAt:2,expiresAt:3,holdReason:null,activeJobs:0,
    workspace:'/private',name:'Agent'}
  ]};
  expect(projectOwnerActivityPage(jobs,'owner','jobs').state).toBe('ready');
  const result=projectOwnerActivityPage(sessions,'owner','sessions');
  expect(result.state).toBe('ready');
  expect(JSON.stringify(result)).not.toContain('workspace');
  expect(JSON.stringify(projectOwnerActivityPage(jobs,'owner','jobs'))).not.toContain('stdout');
  for(const value of [
    {...jobs,rows:[jobs.rows[0],jobs.rows[0]]},
    {...sessions,rows:[sessions.rows[0],sessions.rows[0]]},
    {...sessions,coverage:{...sessions.coverage,source:'owner_current_month_usage'}}
  ])expect(projectOwnerActivityPage(value,'owner',value.kind as 'jobs'|'sessions').state)
     .toBe('unavailable');
 });
 it('native call passes ONLY kind and cursor, never account, URL or token',async()=>{
  const invoke=vi.fn(async(_name:string,_args?:unknown)=>base);
  const host={__TAURI_INTERNALS__:{invoke}} as unknown as Window;
  const view=await nativeOwnerActivityPage('owner','usage',null,host);
  expect(view.state).toBe('ready');
  expect(invoke).toHaveBeenCalledWith('desktop_owner_inventory_page',
   {kind:'usage',cursor:null});
  expect(Object.keys(invoke.mock.calls[0]![1] as Record<string,unknown>))
   .toEqual(['kind','cursor']);
 });
 it('native unavailable, malformed cursor or revoked Owner fails closed',async()=>{
  const invoke=vi.fn(async(_name:string,_args?:unknown)=>{throw Error('denied');});
  const host={__TAURI_INTERNALS__:{invoke}} as unknown as Window;
  expect((await nativeOwnerActivityPage('owner','usage','BAD!',host)).state).toBe('unavailable');
  expect(invoke).not.toHaveBeenCalled();
  expect((await nativeOwnerActivityPage('owner','jobs',null,host)).state).toBe('unavailable');
  vi.stubEnv('VITE_LR_V4_OWNER_SNAPSHOT','0');
  expect((await nativeOwnerActivityPage('owner','sessions',null,host)).state).toBe('unavailable');
 });
});

describe('F15-H2 durable PG and Redis retention source discrimination',()=>{
 it('accepts sanitized PG job history and Redis-backed session windows',()=>{
  const c={...base.coverage,source:'postgresql_owner_job_history'};
  const jobs={...base,kind:'jobs',coverage:c,rows:[{
   jobId:'j-1',deviceId:'d-1',state:'ok',startedAt:10,finishedAt:12,
   agentId:'agent',sessionId:'s-1',exitCode:0,stdout:'NEVER_SEND'
  }]};
  const v=projectOwnerActivityPage(jobs,'owner','jobs');
  expect(v.state).toBe('ready');
  if(v.state==='ready')expect(v.coverage.source).toBe('postgresql_owner_job_history');
  expect(JSON.stringify(v)).not.toContain('NEVER_SEND');
  const sessions={...base,kind:'sessions',
   coverage:{...base.coverage,source:'redis_retained_session_window',
    retention:{snapshotTtlSeconds:604800,terminalPruneAfterMs:604800000,immutableAudit:false}},
   rows:[{sessionId:'s-1',deviceId:'d-1',agentId:'agent',name:'Agent',
     state:'hold',createdAt:1,lastSeenAt:2,expiresAt:3,holdReason:'restarted',
     activeJobs:0,workspace:'SECRET_PATH'}]};
  const s=projectOwnerActivityPage(sessions,'owner','sessions');
  expect(s.state).toBe('ready');
  if(s.state==='ready')expect(s.coverage.source).toBe('redis_retained_session_window');
  expect(JSON.stringify(s)).not.toContain('SECRET_PATH');
 });
 it('rejects unauthorized cross-kind source and forged metadata',()=>{
  for(const [kind,source] of [
    ['usage','postgresql_owner_job_history'],
    ['jobs','redis_retained_session_window'],
    ['sessions','postgresql_owner_job_history'],
    ['jobs','attacker_arbitrary_source']
  ]){
   const invalid={...base,kind,coverage:{...base.coverage,source}};
   expect(projectOwnerActivityPage(invalid,'owner',kind as 'usage'|'jobs'|'sessions').state)
    .toBe('unavailable');
  }
 });
});

describe('F15-H3 verified Owner session retention provenance',()=>{
 const retention={snapshotTtlSeconds:604800,
  terminalPruneAfterMs:86400000,immutableAudit:false};
 const session={
  ...base,kind:'sessions',
  coverage:{...base.coverage,source:'redis_retained_session_window',retention},
  rows:[{sessionId:'s-1',deviceId:'d-1',name:'Agent',agentId:'agent',
   state:'closed',createdAt:1,lastSeenAt:2,expiresAt:null,
   holdReason:null,activeJobs:0,workspace:'PRIVATE_WORKSPACE'}]
 };
 it('projects only verified retention numbers and strips extra metadata/private fields',()=>{
  const input={...session,coverage:{...session.coverage,
   retention:{...retention,redisKey:'SECRET_REDIS_KEY',oauthToken:'SECRET_TOKEN'}}};
  const result=projectOwnerActivityPage(input,'owner','sessions');
  expect(result.state).toBe('ready');
  if(result.state==='ready'){
   expect(result.coverage.retention).toEqual(retention);
   expect(result.coverage.source).toBe('redis_retained_session_window');
  }
  expect(JSON.stringify(result)).not.toContain('SECRET_REDIS_KEY');
  expect(JSON.stringify(result)).not.toContain('SECRET_TOKEN');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_WORKSPACE');
 });
 it('fails closed without a policy or with false permanence, invalid TTL and forged source',()=>{
  const bad=[
   {...session,coverage:{...session.coverage,retention:undefined}},
   {...session,coverage:{...session.coverage,retention:{...retention,immutableAudit:true}}},
   {...session,coverage:{...session.coverage,retention:{...retention,snapshotTtlSeconds:0}}},
   {...session,coverage:{...session.coverage,retention:{...retention,terminalPruneAfterMs:-1}}},
   {...session,coverage:{...session.coverage,retention:{...retention,terminalPruneAfterMs:Infinity}}},
   {...session,coverage:{...session.coverage,retention:{...retention,terminalPruneAfterMs:366*86400000}}},
   {...session,coverage:{...session.coverage,source:'in_memory_current_window',retention}},
   {...base,coverage:{...base.coverage,retention}}
  ];
  for(const sample of bad){
   const kind=sample.kind as 'sessions'|'usage';
   expect(projectOwnerActivityPage(sample,'owner',kind).state).toBe('unavailable');
  }
 });
});
