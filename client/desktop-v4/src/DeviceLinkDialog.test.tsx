import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {render,waitFor,cleanup} from '@testing-library/react';
import {DeviceLinkDialog,nativeLinkAvailable} from './DeviceLinkDialog';

describe('Desktop V4 native Link IPC target scope and stable lifecycle',()=>{
 beforeEach(()=>{
  vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');
  vi.stubEnv('VITE_LR_V4_NATIVE_WINDOWS','1');
 });
 afterEach(()=>{cleanup();vi.unstubAllEnvs();delete (window as any).__TAURI_INTERNALS__;});
 it('renders Link controls only for Windows packaged Owner with native bridge',()=>{
  const invoke=vi.fn(async()=>({ok:true}));
  (window as any).__TAURI_INTERNALS__={invoke};
  expect(nativeLinkAvailable()).toBe(true);
  vi.stubEnv('VITE_LR_V4_NATIVE_WINDOWS','0');
  expect(nativeLinkAvailable()).toBe(false);
  vi.stubEnv('VITE_LR_V4_NATIVE_WINDOWS','1');
  delete (window as any).__TAURI_INTERNALS__;
  expect(nativeLinkAvailable()).toBe(false);
 });
 it('does not restart status/preview when a parent rerenders with a new onClose',async()=>{
  const seen:string[]=[];
  (window as any).__TAURI_INTERNALS__={invoke:async(name:string,args:any)=>{
    expect(name).toBe('desktop_native_action');
    seen.push(args.action);
    return args.action==='status'
     ?{ok:true,Enrolled:true,connected:false,ShortId:'R01KAP'}
     :{ok:true,state:'none'};
  }};
  const view=render(<DeviceLinkDialog onClose={()=>{}}/>);
  await waitFor(()=>expect(seen).toEqual(['status','preview']));
  for(let i=0;i<5;i++)view.rerender(<DeviceLinkDialog onClose={()=>{}}/>);
  await Promise.resolve();
  expect(seen).toEqual(['status','preview']);
 });
});
