// Gold P2-I4C3c: fail-closed physical Agent boundary until an independent,
// signed device-local Guest authorization protocol is implemented.
// The classic owner Fleet command must never silently accept delegation
// metadata that could be interpreted as owner authority.
export class GoldGuestDeviceFenceError extends Error{
 constructor(message='gold_guest_agent_protocol_not_supported'){
  super(message);this.name='GoldGuestDeviceFenceError';this.status=403;
 }
}
export function assertLegacyOwnerCommandNotGuest(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))
  throw new GoldGuestDeviceFenceError('gold_guest_payload_invalid');
 const forbidden=['guestDelegation','delegation','delegationPurpose',
  'guestAccountId','guestJobId','guestGrantId','guestPermissionRevision',
  'guestPayloadSha256'];
 if(String(payload.type||'').startsWith('guest-')||
    forbidden.some(k=>Object.hasOwn(payload,k)))
  throw new GoldGuestDeviceFenceError();
 return true;
}
