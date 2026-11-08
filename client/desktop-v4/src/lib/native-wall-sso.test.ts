import {afterEach,describe,expect,it,vi} from 'vitest';
import {nativeWallSsoCandidateAvailable,nativeApproveWallCode} from './native-wall-sso';

afterEach(()=>vi.unstubAllEnvs());
const host=(invoke?: (name:string,args?:Record<string,unknown>)=>Promise<unknown>)=>
  ({__TAURI_INTERNALS__:invoke?{invoke}:undefined} as unknown as Window);

describe('T04b9c3c explicit native Owner Wall code confirmation',()=>{
  it('is absent from UI-only and ordinary Owner LAB candidates',async()=>{
    const fn=vi.fn().mockResolvedValue({phase:'verified',accountId:'acct_A'});
    vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');
    vi.stubEnv('VITE_LR_V4_WALL_SSO_CANDIDATE','0');
    expect(nativeWallSsoCandidateAvailable(host(fn))).toBe(false);
    expect(await nativeApproveWallCode('Ab12_-34',host(fn))).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
  it('will never invoke native on malformed or missing code',async()=>{
    vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');
    vi.stubEnv('VITE_LR_V4_WALL_SSO_CANDIDATE','1');
    const fn=vi.fn().mockResolvedValue({phase:'verified',accountId:'owner'});
    for(const code of ['', 'bad', 'a'.repeat(9), 'with space', 'bad/../!']){
      expect(await nativeApproveWallCode(code,host(fn))).toBe(false);
    }
    expect(fn).not.toHaveBeenCalled();
  });
  it('sends ONLY the 8-character public browser code, no tokens or URL',async()=>{
    vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');
    vi.stubEnv('VITE_LR_V4_WALL_SSO_CANDIDATE','1');
    const fn=vi.fn().mockResolvedValue({
      phase:'verified',accountId:'owner_abc',
      ticket:'do-not-return',accessToken:'do-not-return',deviceId:'do-not-return'
    });
    expect(await nativeApproveWallCode('Ab12_-34',host(fn))).toBe(true);
    expect(fn).toHaveBeenCalledWith('desktop_owner_wall_sso_approve',
      {approvalCode:'Ab12_-34'});
    const wire=JSON.stringify(fn.mock.calls);
    expect(wire).not.toContain('do-not-return');
    expect(wire).not.toContain('127.0.0.1');
  });
  it('never treats native errors or malformed projection as Owner authorization',async()=>{
    vi.stubEnv('VITE_LR_V4_OWNER_LOGIN','1');
    vi.stubEnv('VITE_LR_V4_WALL_SSO_CANDIDATE','1');
    for(const row of [{phase:'verified',accountId:null},
      {phase:'expired',accountId:'owner'},null]){
      const fn=vi.fn().mockResolvedValue(row);
      expect(await nativeApproveWallCode('Ab12_-34',host(fn))).toBe(false);
    }
    const fn=vi.fn().mockRejectedValue(Error('internal private key: redacted'));
    expect(await nativeApproveWallCode('Ab12_-34',host(fn))).toBe(false);
  });
});
