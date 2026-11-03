import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  nativeOwnerAvailable, nativeOwnerBegin, nativeOwnerStatus,
  nativeOwnerRestore, nativeOwnerLogout
} from './native-owner';

afterEach(() => vi.unstubAllEnvs());

function host(invoke?: (name:string)=>Promise<unknown>): Window {
  return {__TAURI_INTERNALS__:invoke?{invoke}:undefined} as unknown as Window;
}

describe('Native Owner V4 projection and trust boundary',()=>{
  it('does not unlock or invoke native commands in ordinary UI-only builds',async()=>{
    vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','0');
    const fn=vi.fn().mockResolvedValue({phase:'verified',accountId:'owner'});
    expect(nativeOwnerAvailable(host(fn))).toBe(false);
    expect(await nativeOwnerStatus(host(fn))).toEqual({phase:'unavailable',accountId:null});
    expect(fn).not.toHaveBeenCalled();
  });
  it('does not unlock without native IPC even if frontend opt-in is set',async()=>{
    vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');
    expect(nativeOwnerAvailable(host())).toBe(false);
    expect(await nativeOwnerBegin(host())).toEqual({phase:'unavailable',accountId:null});
  });
  it('returns only native-sanitized phase and accountId, never credentials',async()=>{
    vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');
    const fn=vi.fn().mockResolvedValue({
      phase:'verified',accountId:'acct123',
      access_token:'secret',refresh_token:'secret',agentGrant:'forged'
    });
    expect(await nativeOwnerStatus(host(fn))).toEqual({phase:'verified',accountId:'acct123'});
    expect(JSON.stringify(await nativeOwnerStatus(host(fn)))).not.toContain('secret');
    expect(fn).toHaveBeenCalledWith('desktop_owner_status');
  });
  it('verified phase cannot be forged without a valid account identity',async()=>{
    vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');
    for(const bad of [
      {phase:'verified',accountId:null},
      {phase:'verified',accountId:'x'.repeat(200)},
      {phase:'verified',accountId:'attacker user'},
      {phase:'root',accountId:'owner'},
      null,
      'verified'
    ]){
      const fn=vi.fn().mockResolvedValue(bad);
      expect(await nativeOwnerStatus(host(fn))).toEqual({phase:'unavailable',accountId:null});
    }
  });
  it('fixed native-only calls have no token or URL arguments',async()=>{
    vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');
    const fn=vi.fn().mockResolvedValue({phase:'signed_out',accountId:null});
    const h=host(fn);
    await nativeOwnerBegin(h);
    await nativeOwnerStatus(h);
    await nativeOwnerRestore(h);
    await nativeOwnerLogout(h);
    expect(fn.mock.calls).toEqual([
      ['desktop_owner_begin'],['desktop_owner_status'],
      ['desktop_owner_restore'],['desktop_owner_logout']
    ]);
  });
  it('any native error locks UI instead of granting Owner status',async()=>{
    vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');
    const fn=vi.fn().mockRejectedValue(new Error('unavailable'));
    expect(await nativeOwnerStatus(host(fn))).toEqual({phase:'unavailable',accountId:null});
  });
});
