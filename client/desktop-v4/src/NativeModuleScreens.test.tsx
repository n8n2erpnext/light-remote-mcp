import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {LongMemoryScreen,CodexBridgeScreen} from './NativeModuleScreens';

const scopeId='123e4567-e89b-42d3-a456-426614174000';
let enabled:boolean,revision:number,invoke:ReturnType<typeof vi.fn>;
function reply(action:string){return {ok:true,accountId:'owner',deviceId:'device',view:{asOf:100,
 modules:{longMemory:enabled,codexBridge:false,revision},
 ...(action==='device.read'?{device:{deviceName:'Workstation',policy:{effectiveCapabilities:[],deniedCapabilities:[]}}}:{}),
 ...(action==='memory.read'?{memory:enabled?{localFileBytes:1048576,liveBytes:500,checkpointBytes:200,lastConfirmedSyncAt:100,
  scopes:[{scopeId,displayName:'Project receipt',homeDeviceId:'device',status:'active',tombstoned:false,captureMode:'manual',revision:1,checkpoints:3,bytes:200,lastConfirmedSyncAt:100}],
  sync:{state:'unavailable'}}:null}:{}),...(action==='codex.read'?{codex:null}:{})}};}
beforeEach(()=>{
 enabled=true;revision=7;vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');
 invoke=vi.fn(async(_command:string,args:{action:string;payload:Record<string,unknown>})=>{
  if(args.action==='module.configure'){
   expect(args.payload.expectedRevision).toBe(revision);enabled=args.payload.enabled===true;revision++;
   return {ok:true,accountId:'owner',deviceId:'device',view:{modules:{longMemory:enabled,codexBridge:false,revision}}};
  }
  if(args.action==='memory.delete-local')return {ok:true,accountId:'owner',deviceId:'device',view:{saved:true}};
  return reply(args.action);
 });
 Object.assign(window,{__TAURI_INTERNALS__:{invoke}});
});
afterEach(()=>{cleanup();vi.unstubAllEnvs();delete (window as unknown as Record<string,unknown>).__TAURI_INTERNALS__;});
describe('Desktop module controls backed by native Agent state',()=>{
 it('loads retained local work even when cloud sync is offline, and disables immediately through CAS',async()=>{
  render(<LongMemoryScreen accountId="owner"/>);
  await screen.findByText('Project receipt');
  expect(screen.getByText('1.00 MiB')).toBeTruthy();
  expect(screen.getByText(/Local saved work remains available/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Save modules'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Disable Long Memory'}));
  await screen.findByRole('button',{name:'Enable Long Memory'});
  expect(invoke.mock.calls.filter(c=>c[1].action==='module.configure')).toHaveLength(1);
  expect(screen.queryByText('Project receipt')).toBeNull();
 });
 it('requires the exact scope name before destructive local deletion',async()=>{
  render(<LongMemoryScreen accountId="owner"/>);await screen.findByText('Project receipt');
  fireEvent.click(screen.getByRole('button',{name:'Delete locally'}));
  const confirm=screen.getByRole('button',{name:'Confirm'}) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox',{name:'Exact confirmation text'}),{target:{value:'Project receipt'}});
  fireEvent.click(confirm);
  await waitFor(()=>expect(invoke.mock.calls.some(c=>c[1].action==='memory.delete-local')).toBe(true));
  expect(invoke.mock.calls.find(c=>c[1].action==='memory.delete-local')?.[1].payload).toEqual({scopeId,confirmName:'Project receipt',confirmed:true});
 });
 it('opening Codex reads its persisted module status without login, installation or process execution',async()=>{
  render(<CodexBridgeScreen accountId="owner"/>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Enable Codex Bridge'}) as HTMLButtonElement).disabled).toBe(false));
  expect(invoke.mock.calls.map(c=>c[1].action)).toEqual(['device.read','codex.read']);
  expect((screen.getByRole('button',{name:'Sign in to Codex'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it('cancels a pending destructive confirmation when the verified Owner changes',async()=>{
  const view=render(<LongMemoryScreen accountId="owner"/>);await screen.findByText('Project receipt');
  fireEvent.click(screen.getByRole('button',{name:'Delete locally'}));
  view.rerender(<LongMemoryScreen accountId={null}/>);
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  expect(invoke.mock.calls.some(c=>c[1].action==='memory.delete-local')).toBe(false);
 });
});
