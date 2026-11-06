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
 grants:[{grantId:'dag-1',deviceId:'dev-a',agentId:'agent-a',approvedAt:100,expiresAt:2000,absoluteExpiresAt:3000,rawToken:'SECRET'}]
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
   }
 });
 it('denies wrong account, foreign session device, missing arrays, excessive records',()=>{
   expect(projectOwnerSnapshot(DATA,'other').state).toBe('unavailable');
   expect(projectOwnerSnapshot({...DATA,devices:[]},'owner').state).toBe('unavailable');
   expect(projectOwnerSnapshot({...DATA,grants:Array(201).fill(DATA.grants[0])},'owner').state).toBe('unavailable');
   expect(projectOwnerSnapshot({...DATA,account:{...DATA.account,emailVerified:false}},'owner').state).toBe('unavailable');
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
