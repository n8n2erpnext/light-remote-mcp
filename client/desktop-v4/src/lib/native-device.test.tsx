import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {nativeDeviceRequest,projectDeviceReply,useNativeDevice} from './native-device';

const base=(accountId='owner',revision=5)=>({ok:true,accountId,deviceId:'device',view:{asOf:100,
 modules:{longMemory:true,codexBridge:false,revision},
 device:{deviceName:'Local PC',cloudDesiredConnected:true,cloudState:'connected',policy:{effectiveCapabilities:[],deniedCapabilities:[]}}}});
const pending=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
function host(invoke:ReturnType<typeof vi.fn>){Object.assign(window,{__TAURI_INTERNALS__:{invoke}});}
beforeEach(()=>{vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');});
afterEach(()=>{cleanup();vi.unstubAllEnvs();delete (window as unknown as Record<string,unknown>).__TAURI_INTERNALS__;});

describe('same-device API trust and async lifecycle',()=>{
 it('rejects another Owner/device and nested credential material',()=>{
  expect(projectDeviceReply(base('other'),'owner').state).toBe('unavailable');
  expect(projectDeviceReply(base(),'owner','other-device').state).toBe('unavailable');
  expect(projectDeviceReply({...base(),view:{...base().view,nested:{privateIdentityKey:'secret'}}},'owner').state).toBe('unavailable');
  expect(projectDeviceReply(base(),'owner','device').state).toBe('ready');
 });
 it('invokes one native verb with expected Owner binding, without browser tokens or URLs',async()=>{
  const invoke=vi.fn().mockResolvedValue(base());host(invoke);
  expect((await nativeDeviceRequest('device.read','owner',null)).state).toBe('ready');
  expect(invoke).toHaveBeenCalledWith('desktop_owner_device_request',{
   action:'device.read',expectedAccountId:'owner',deviceId:null,payload:{}});
  await nativeDeviceRequest('logs.clean','owner',null,{confirmed:true});
  expect(invoke).toHaveBeenCalledTimes(1);
  const incomplete=vi.fn().mockResolvedValue({...base(),view:{asOf:100,modules:base().view.modules}});host(incomplete);
  expect(await nativeDeviceRequest('memory.read','owner','device')).toEqual({state:'unavailable',reason:'desktop_api_contract_mismatch'});
 });
 it('never applies a slow read after an Owner swap',async()=>{
  const old=pending<ReturnType<typeof base>>();
  const invoke=vi.fn((_name:string,args:{expectedAccountId:string})=>args.expectedAccountId==='owner'?old.promise:Promise.resolve(base('new-owner')));host(invoke);
  const view=renderHook(({accountId})=>useNativeDevice('device.read',accountId),{initialProps:{accountId:'owner'}});
  await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(1));
  view.rerender({accountId:'new-owner'});
  await waitFor(()=>expect(view.result.current.reply?.accountId).toBe('new-owner'));
  await act(async()=>old.resolve(base()));
  expect(view.result.current.reply?.accountId).toBe('new-owner');
 });
 it('coalesces refreshes and retains confirmed data during a slow refresh',async()=>{
  const second=pending<ReturnType<typeof base>>();
  const invoke=vi.fn().mockResolvedValueOnce(base()).mockImplementationOnce(()=>second.promise).mockResolvedValue(base('owner',6));host(invoke);
  const view=renderHook(()=>useNativeDevice('device.read','owner'));
  await waitFor(()=>expect(view.result.current.view?.modules?.revision).toBe(5));
  act(()=>{view.result.current.refresh();view.result.current.refresh();view.result.current.refresh();});
  expect(view.result.current.view?.modules?.revision).toBe(5);
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async()=>second.resolve(base('owner',4)));
  await waitFor(()=>expect(view.result.current.view?.modules?.revision).toBe(6));
  expect(invoke).toHaveBeenCalledTimes(3);
 });
 it('serializes writes, reloads actual state and never retries an unconfirmed mutation',async()=>{
  const write=pending<unknown>();
  const invoke=vi.fn((_name:string,args:{action:string})=>args.action==='module.configure'?write.promise:Promise.resolve(base()));host(invoke);
  const view=renderHook(()=>useNativeDevice('device.read','owner'));
  await waitFor(()=>expect(view.result.current.available).toBe(true));
  let first!:Promise<unknown>;
  act(()=>{first=view.result.current.run('module.configure',{module:'longMemory',enabled:false,expectedRevision:5});});
  await act(async()=>{expect((await view.result.current.run('module.configure',{})).state).toBe('unavailable');});
  await act(async()=>{write.resolve(Promise.reject('desktop_device_outcome_unknown'));await first;});
  expect(view.result.current.message).toContain('not confirmed');
  expect(invoke.mock.calls.filter(x=>x[1].action==='module.configure')).toHaveLength(1);
  expect(view.result.current.view?.modules?.longMemory).toBe(true);
 });
 it('rejects a stale confirmation callback before sending a mutation under a new Owner',async()=>{
  const invoke=vi.fn((_name:string,args:{expectedAccountId:string;action:string})=>Promise.resolve(base(args.expectedAccountId)));host(invoke);
  const view=renderHook(({accountId})=>useNativeDevice('device.read',accountId),{initialProps:{accountId:'owner'}});
  await waitFor(()=>expect(view.result.current.available).toBe(true));
  const oldRun=view.result.current.run;view.rerender({accountId:'new-owner'});
  await act(async()=>{expect((await oldRun('device.disconnect',{confirmed:true})).state).toBe('unavailable');});
  expect(invoke.mock.calls.some(x=>x[1].action==='device.disconnect')).toBe(false);
 });
});
