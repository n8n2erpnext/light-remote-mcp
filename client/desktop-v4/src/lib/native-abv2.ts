/**
 * Desktop V4 A/B V2: native Owner -> private SAME-DEVICE Agent IPC.
 * React never receives Owner Bearer/refresh tokens, signed Agent secrets,
 * or accepts arbitrary local/remote URLs. B is a one-use human entry only.
 */
export type NativeAbv2Request = Readonly<{
  requestId: string;
  attempt: number;
  expiresAt: number;
  aCode: string | null;
}>;
export type NativeAbv2Status =
  | Readonly<{
      state: 'ready';
      deviceId: string;
      shortId: string | null;
      ownerApproveEnabled: boolean;
      ownerConsentRequired: boolean;
      pending: readonly NativeAbv2Request[];
    }>
  | Readonly<{ state: 'unavailable'; reason: string }>;
export type NativeAbv2Approval =
  | Readonly<{ state: 'granted'; requestId: string; expiresAt: number | null }>
  | Readonly<{ state: 'unavailable' }>;

type Host = Window & {
  __TAURI_INTERNALS__?: {
    invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
};
const ID = /^av2_[a-f0-9]{32}$/;
const DEVICE = /^[A-Za-z0-9._:-]{1,160}$/;
const B = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const CONSENT = /^[A-Za-z0-9_-]{32}$/;

export function nativeAbv2Available(host:Window=window):boolean {
  return import.meta.env.VITE_LR_V4_OWNER_LOGIN === '1' &&
    import.meta.env.VITE_LR_V4_ABV2_NATIVE === '1' &&
    typeof (host as Host).__TAURI_INTERNALS__?.invoke === 'function';
}
function rec(v:unknown):Record<string,unknown>|null {
  return v!==null&&typeof v==='object'&&!Array.isArray(v)
    ?v as Record<string,unknown>:null;
}
export function projectAbv2Pending(value:unknown):NativeAbv2Status {
  const v=rec(value);
  const requests=Array.isArray(v?.pending)?v.pending:null;
  if (v?.state!=='ready'||!DEVICE.test(String(v.deviceId||''))||
      !requests||requests.length>5||typeof v.ownerApproveEnabled!=='boolean'||
      typeof v.ownerConsentRequired!=='boolean'||
      (v.shortId!==null&&!/^[0-9A-HJKMNP-TV-Z]{6}$/.test(String(v.shortId))))
    return {state:'unavailable',reason:'invalid_agent_response'};
  const pending:NativeAbv2Request[]=[];
  for (const request of requests) {
    const r=rec(request);
    if (!r||typeof r.requestId!=='string'||!ID.test(r.requestId)||
        !Number.isSafeInteger(r.attempt)||Number(r.attempt)<1||
        !Number.isSafeInteger(r.expiresAt)||Number(r.expiresAt)<=0||
        (r.aCode!==null&&(typeof r.aCode!=='string'||r.aCode.length>32)))
      return {state:'unavailable',reason:'invalid_agent_response'};
    pending.push(Object.freeze({
      requestId:r.requestId,attempt:r.attempt as number,
      expiresAt:r.expiresAt as number,aCode:r.aCode as string|null
    }));
  }
  return Object.freeze({
    state:'ready',deviceId:v.deviceId as string,
    shortId:v.shortId as string|null,
    ownerApproveEnabled:v.ownerApproveEnabled as boolean,
    ownerConsentRequired:v.ownerConsentRequired as boolean,
    pending:Object.freeze(pending)
  });
}
export async function nativeAbv2Pending(host:Window=window):Promise<NativeAbv2Status> {
  if (!nativeAbv2Available(host))return {state:'unavailable',reason:'native_unavailable'};
  try {
    const reply=await (host as Host).__TAURI_INTERNALS__!.invoke!('desktop_owner_abv2_pending');
    return projectAbv2Pending(reply);
  } catch {
    return {state:'unavailable',reason:'agent_or_owner_unavailable'};
  }
}
export async function nativeAbv2Approve(
  request:NativeAbv2Request,bCode:string,consentCode:string,host:Window=window
):Promise<NativeAbv2Approval> {
  if (!nativeAbv2Available(host)||!ID.test(request.requestId)||
      !Number.isSafeInteger(request.attempt)||request.attempt<1||
      !B.test(bCode)||(consentCode!==''&&!CONSENT.test(consentCode)))
    return {state:'unavailable'};
  try {
    const reply=rec(await (host as Host).__TAURI_INTERNALS__!.invoke!(
      'desktop_owner_abv2_approve',{
        requestId:request.requestId,expectedAttempt:request.attempt,
        bCode,consentCode
      }));
    if(reply?.state==='granted'&&reply.requestId===request.requestId&&
       (reply.expiresAt===null||Number.isSafeInteger(reply.expiresAt)))
      return {state:'granted',requestId:request.requestId,
        expiresAt:reply.expiresAt as number|null};
  } catch { /* Owner/revocation/failure remain unavailable. */ }
  return {state:'unavailable'};
}
