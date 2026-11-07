import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {nativeOwnerInventoryPage,projectOwnerInventoryPage} from './native-inventory';

const ONE={
 ok:true,accountId:'owner',kind:'devices',asOf:1000,
 rows:[{deviceId:'dev-1',name:'Test PC',shortId:'R01KAP',os:'windows',state:'online',
  lastSeenAt:1000,privateKey:'SECRET'}],
 coverage:{returned:1,total:240,hasMore:true,nextCursor:'validCursor1234_A',
  source:'owner_live_membership_revision'}
};
describe('native-only Owner page is bounded, scoped and typed',()=>{
 beforeEach(()=>{vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');vi.stubEnv('VITE_LR_V4_OWNER_SNAPSHOT','1');});
 afterEach(()=>vi.unstubAllEnvs());
 it('sanitizes device page and never exposes bearer, tokens or private metadata',()=>{
  const page=projectOwnerInventoryPage(ONE,'owner','devices');
  expect(page.state).toBe('ready');
  if(page.state==='ready'&&page.kind==='devices'){
    expect(page.rows[0]?.shortId).toBe('R01KAP');
    expect(page.coverage.total).toBe(240);
    expect(JSON.stringify(page)).not.toContain('SECRET');
  }
 });
 it('rejects foreign owner, cross-kind and malformed coverage',()=>{
  for(const invalid of [
    {...ONE,accountId:'other'},
    {...ONE,kind:'grants'},
    {...ONE,coverage:{...ONE.coverage,returned:2}},
    {...ONE,coverage:{...ONE.coverage,nextCursor:null}},
    {...ONE,coverage:{...ONE.coverage,source:'untrusted'}},
    {...ONE,rows:Array(101).fill(ONE.rows[0])},
    {...ONE,rows:[ONE.rows[0],ONE.rows[0]]},
    {...ONE,rows:[{deviceId:'foreign!'}]},
    {...ONE,coverage:{...ONE.coverage,hasMore:false,nextCursor:'cursor'}}
  ])expect(projectOwnerInventoryPage(invalid,'owner','devices').state).toBe('unavailable');
  expect(projectOwnerInventoryPage(ONE,'owner','grants').state).toBe('unavailable');
 });
 it('grants never receive a scope field the client can override',()=>{
  const grant={...ONE,kind:'grants',rows:[
    {deviceId:'dev-1',grantId:'grant-1',agentId:'agent-1',approvedAt:1,
     expiresAt:2,absoluteExpiresAt:3,token:'SECRET'}
  ]};
  const page=projectOwnerInventoryPage(grant,'owner','grants');
  expect(page.state).toBe('ready');
  if(page.state==='ready')expect(JSON.stringify(page)).not.toContain('SECRET');
  expect(projectOwnerInventoryPage({...grant,rows:[grant.rows[0],grant.rows[0]]},'owner','grants').state).toBe('unavailable');
 });
 it('invokes ONLY Tauri native Owner read, without cookies, URL or account identity in args',async()=>{
  const invoke=vi.fn(async (_command:string,_args?:unknown)=>ONE);
  const host={__TAURI_INTERNALS__:{invoke}} as unknown as Window;
  const result=await nativeOwnerInventoryPage('owner','devices',null,host);
  expect(result.state).toBe('ready');
  expect(invoke).toHaveBeenCalledWith('desktop_owner_inventory_page',{kind:'devices',cursor:null});
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(Object.keys(invoke.mock.calls[0]![1] as Record<string,unknown>)).toEqual(['kind','cursor']);
 });
 it('invalid cursor and native permission errors fail closed before rendering',async()=>{
  const invoke=vi.fn(async()=>{throw Error('denied')});
  const host={__TAURI_INTERNALS__:{invoke}} as unknown as Window;
  expect((await nativeOwnerInventoryPage('owner','devices','invalid!',host)).state).toBe('unavailable');
  expect(invoke).not.toHaveBeenCalled();
  expect((await nativeOwnerInventoryPage('owner','devices',null,host)).state).toBe('unavailable');
  vi.stubEnv('VITE_LR_V4_OWNER_SNAPSHOT','0');
  expect((await nativeOwnerInventoryPage('owner','devices',null,host)).state).toBe('unavailable');
 });
});
