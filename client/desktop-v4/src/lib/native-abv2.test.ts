import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {
 nativeAbv2Available,nativeAbv2Pending,nativeAbv2Approve,projectAbv2Pending
} from './native-abv2';
const REQUEST='av2_'+'a'.repeat(32);
const PENDING={
 state:'ready',deviceId:'dev_x',shortId:'R01KAP',
 ownerApproveEnabled:true,ownerConsentRequired:false,
 pending:[{requestId:REQUEST,attempt:1,expiresAt:1799999999999,aCode:'R01KAP-ABCDE'}]
};

describe('Desktop V4 enrolled Agent native A/B V2, no browser credentials',()=>{
 beforeEach(()=>{
  vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');
  vi.stubEnv('VITE_LR_V4_ABV2_NATIVE','1');
 });
 afterEach(()=>{vi.unstubAllEnvs();});
 it('rejects arbitrary and unverified pending claims',()=>{
  expect(projectAbv2Pending({...PENDING,deviceId:'https://evil'}).state).toBe('unavailable');
  expect(projectAbv2Pending({...PENDING,pending:[{requestId:REQUEST,attempt:0,expiresAt:1}]}).state).toBe('unavailable');
  expect(projectAbv2Pending({...PENDING,pending:new Array(6).fill(PENDING.pending[0])}).state).toBe('unavailable');
 });
 it('reads native signed-channel projection only through Tauri; never via fetch',async()=>{
  const invoke=vi.fn(async()=>({...PENDING,token:'NEVER_EXPOSE',
    pending:[{...PENDING.pending[0],agentSecret:'FORBIDDEN'}]}));
  const host={__TAURI_INTERNALS__:{invoke}} as unknown as Window;
  expect(nativeAbv2Available(host)).toBe(true);
  const result=await nativeAbv2Pending(host);
  expect(result.state).toBe('ready');
  expect(invoke).toHaveBeenCalledWith('desktop_owner_abv2_pending');
  expect(JSON.stringify(result)).not.toContain('FORBIDDEN');
  expect(JSON.stringify(result)).not.toContain('NEVER_EXPOSE');
 });
 it('passes only human B/request/attempt, not Owner tokens or user-controlled URLs',async()=>{
  const invoke=vi.fn(async()=>({state:'granted',requestId:REQUEST,expiresAt:1799999999999}));
  const host={__TAURI_INTERNALS__:{invoke}} as unknown as Window;
  const row=PENDING.pending[0]!;
  const result=await nativeAbv2Approve(row,'4RFG-F3C6','',host);
  expect(result.state).toBe('granted');
  expect(invoke).toHaveBeenCalledWith(
    'desktop_owner_abv2_approve',{requestId:REQUEST,
      expectedAttempt:1,bCode:'4RFG-F3C6',consentCode:''});
  expect(await nativeAbv2Approve(row,'INVALID','',host)).toEqual({state:'unavailable'});
  expect(invoke).toHaveBeenCalledTimes(1);
 });
 it('fails closed when the same-host Agent is not ready',async()=>{
  const invoke=vi.fn(async()=>{throw Error('not running');});
  const host={__TAURI_INTERNALS__:{invoke}} as unknown as Window;
  expect((await nativeAbv2Pending(host)).state).toBe('unavailable');
  expect((await nativeAbv2Approve(PENDING.pending[0]!,'4RFG-F3C6','',host)).state).toBe('unavailable');
 });
});
