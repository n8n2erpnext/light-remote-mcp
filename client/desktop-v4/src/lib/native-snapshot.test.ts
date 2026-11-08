import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {nativeOwnerSnapshot,nativeOwnerSnapshotAvailable,projectOwnerSnapshot} from './native-snapshot';
const DATA={
 ok:true,accountId:'owner',asOf:1000,
 account:{email:'owner@example.test',plan:'pro',status:'active',emailVerified:true,passwordHash:'SECRET'},
 entitlements:{plan:'pro',toolCallLimit:500,privateKey:'SECRET'},
 usage:{month:'2026-11',toolCallsThisMonth:22,access_token:'SECRET',byDevice:[{deviceId:'dev-a',toolCalls:19,onlineMs:7200000,secret:'SECRET'}]},
 devices:[{deviceId:'dev-a',name:'Home',shortId:'R01KAP',os:'windows',state:'online',lastSeenAt:999,privateKey:'SECRET'}],
 sessions:[{sessionId:'s-1',deviceId:'dev-a',agentId:'agent-a',name:'Agent A',
   state:'active',createdAt:100,lastSeenAt:900,expiresAt:2000,holdReason:null,activeJobs:0,workspace:'SECRET'}],
 grants:[{grantId:'dag-1',deviceId:'dev-a',agentId:'agent-a',approvedAt:100,expiresAt:2000,absoluteExpiresAt:3000,rawToken:'SECRET'}],
 coverage:{jobs:{returned:1,total:1,hasMore:false,source:'in_memory_current_window'}},
 jobs:[{jobId:'job-a',deviceId:'dev-a',agentId:'agent-a',sessionId:'s-1',state:'running',startedAt:1000,finishedAt:null,exitCode:null,script:'SECRET'}],
 events:[{deviceId:'dev-a',eventType:'job_started',status:'running',at:1000,detail:'SECRET'}]
};
describe('Owner snapshot is a bounded native-only projection',()=>{
 beforeEach(()=>{vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');vi.stubEnv('VITE_LR_V4_OWNER_SNAPSHOT','1');});
 afterEach(()=>{vi.unstubAllEnvs();});
 it('keeps only trusted Owner device/session/grant fields',()=>{
   const result=projectOwnerSnapshot(DATA,'owner');
   expect(result.state).toBe('ready');
   expect(JSON.stringify(result)).not.toContain('SECRET');
   if(result.state==='ready'){
     expect(result.devices[0]?.deviceId).toBe('dev-a');
     expect(result.sessions[0]?.state).toBe('active');
     expect(result.grants[0]?.grantId).toBe('dag-1');
     expect(result.usage.toolCallsThisMonth).toBe(22);
     expect(result.usage.month).toBe('2026-11');
     expect(result.usage.byDevice[0]?.toolCalls).toBe(19);
     expect(result.jobs[0]?.state).toBe('running');
     expect(result.coverage?.jobs.hasMore).toBe(false);
     expect(result.events[0]?.eventType).toBe('job_started');
   }
 });
 it('denies wrong account, foreign session device, missing arrays, excessive records',()=>{
   expect(projectOwnerSnapshot(DATA,'other').state).toBe('unavailable');
   expect(projectOwnerSnapshot({...DATA,devices:[]},'owner').state).toBe('unavailable');
   expect(projectOwnerSnapshot({...DATA,grants:Array(201).fill(DATA.grants[0])},'owner').state).toBe('unavailable');
   expect(projectOwnerSnapshot({...DATA,account:{...DATA.account,emailVerified:false}},'owner').state).toBe('unavailable');
   expect(projectOwnerSnapshot({...DATA,jobs:[{...DATA.jobs[0],deviceId:'other'}]},'owner').state).toBe('unavailable');
   expect(projectOwnerSnapshot({...DATA,events:[{...DATA.events[0],deviceId:'other'}]},'owner').state).toBe('unavailable');
 });
 it('keeps a bounded over-200 in-memory window while rejecting dishonest coverage',()=>{
   const many={...DATA,coverage:{jobs:{returned:1,total:257,hasMore:true,source:'in_memory_current_window'}}};
   const view=projectOwnerSnapshot(many,'owner');
   expect(view.state).toBe('ready');
   if(view.state==='ready')expect(view.coverage?.jobs.total).toBe(257);
   const fake={...many,coverage:{jobs:{returned:2,total:257,hasMore:true,source:'in_memory_current_window'}}};
   expect(projectOwnerSnapshot(fake,'owner').state).toBe('unavailable');
 });
 it('rejects dishonest session window metadata and keeps verified counts',()=>{
   const sessions={returned:1,total:201,hasMore:true,activeTotal:1,holdTotal:0,
     source:'in_memory_current_window'};
   const view=projectOwnerSnapshot({...DATA,coverage:{...DATA.coverage,sessions}},'owner');
   expect(view.state).toBe('ready');
   if(view.state==='ready'){
     expect(view.coverage?.sessions?.total).toBe(201);
     expect(view.coverage?.sessions?.activeTotal).toBe(1);
   }
   for(const invalid of [
     {...sessions,returned:2},{...sessions,activeTotal:0},
     {...sessions,source:'unverified_cloud'},{...sessions,hasMore:false},
     {...sessions,total:0},{...sessions,holdTotal:202},
     null,'bogus'
   ])expect(projectOwnerSnapshot({...DATA,coverage:{...DATA.coverage,sessions:invalid}},'owner').state)
       .toBe('unavailable');
   expect(projectOwnerSnapshot(DATA,'owner').state).toBe('ready');
 });
 it('F14 validates all bounded Owner device, grant and usage coverage, rejects forged totals',()=>{
   const viewport={returned:1,total:201,hasMore:true,source:'owner_bounded_viewport'};
   const view=projectOwnerSnapshot({...DATA,coverage:{...DATA.coverage,
     devices:viewport,grants:viewport,usage:viewport}},'owner');
   expect(view.state).toBe('ready');
   if(view.state==='ready'){
     expect(view.coverage?.devices?.total).toBe(201);
     expect(view.coverage?.grants?.hasMore).toBe(true);
     expect(view.coverage?.usage?.total).toBe(201);
   }
   for(const key of ['devices','grants','usage'] as const){
     for(const invalid of [
       {...viewport,returned:2},{...viewport,total:0},
       {...viewport,hasMore:false},{...viewport,source:'foreign'}
     ])expect(projectOwnerSnapshot({...DATA,coverage:{...DATA.coverage,[key]:invalid}},'owner').state)
       .toBe('unavailable');
   }
   expect(projectOwnerSnapshot(DATA,'owner').state).toBe('ready');
 });
 it('uses exact Tauri IPC and never fetch, cookies or a URL from JS',async()=>{
   const invoke=vi.fn(async()=>DATA);
   const host={__TAURI_INTERNALS__:{invoke}} as unknown as Window;
   expect(nativeOwnerSnapshotAvailable(host)).toBe(true);
   expect((await nativeOwnerSnapshot('owner',host)).state).toBe('ready');
   expect(invoke).toHaveBeenCalledWith('desktop_owner_snapshot');
   expect(invoke).toHaveBeenCalledTimes(1);
 });
 it('fails closed if native IPC unavailable or denied',async()=>{
   const host={__TAURI_INTERNALS__:{invoke:vi.fn(async()=>{throw Error('denied');})}} as unknown as Window;
   expect((await nativeOwnerSnapshot('owner',host)).state).toBe('unavailable');
   vi.stubEnv('VITE_LR_V4_OWNER_SNAPSHOT','0');
   expect((await nativeOwnerSnapshot('owner',host)).state).toBe('unavailable');
 });
});
