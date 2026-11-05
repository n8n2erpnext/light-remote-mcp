/**
 * T04b9c3c: public short-code handoff from Owner's local Wall browser.
 * This is only available in an explicit unsigned SSO candidate and never
 * receives an Owner credential, raw ticket, full challenge, deviceId, URL or
 * A/B grant. Rust independently obtains the enrolled device from OS-private
 * IPC and revalidates Owner generation/server identity.
 */
const CODE=/^[A-Za-z0-9_-]{8}$/;
type Host=Window&{__TAURI_INTERNALS__?:{
  invoke?:(command:string,args?:Record<string,unknown>)=>Promise<unknown>
}};
export function nativeWallSsoCandidateAvailable(host:Window=window){
  return import.meta.env.VITE_LR_V4_WALL_SSO_CANDIDATE==='1' &&
    import.meta.env.VITE_LR_V4_OWNER_LOGIN==='1' &&
    typeof (host as Host).__TAURI_INTERNALS__?.invoke==='function';
}
export async function nativeApproveWallCode(
  code:string,host:Window=window
):Promise<boolean>{
  if(!nativeWallSsoCandidateAvailable(host)||!CODE.test(code))return false;
  try{
    const value=await (host as Host).__TAURI_INTERNALS__!.invoke!(
      'desktop_owner_wall_sso_approve',{approvalCode:code}
    );
    if(!value||typeof value!=='object')return false;
    const result=value as Record<string,unknown>;
    return result.phase==='verified'&&
      typeof result.accountId==='string'&&
      /^[A-Za-z0-9._:-]{1,128}$/.test(result.accountId);
  }catch{return false;}
}
