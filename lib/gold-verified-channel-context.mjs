// Single Gold authenticated device-channel admission boundary.
// Fail closed on missing/expired/revoked enrolled device, stale payload,
// key/account drift, replay, or rate-limit. Both runtime and fixture use this.
export async function verifiedGoldChannelContext({
 body,action,enrollments,devices,sessions,rateLimiter,EnrollmentError
}={}){
 const payload=body?.payload;
 if(!payload||typeof payload!=='object'||Array.isArray(payload))
  throw new EnrollmentError('invalid_device_channel_payload');
 const proof=enrollments.verifyChannel(body,action,payload),binding=proof.binding;
 const device=devices.get(binding.deviceId,{
  activeSessionsForNode:id=>sessions.activeCountByNode(id)
 });
 if(device.accountId!==binding.accountId||
    device.publicIdentityKey!==binding.publicIdentityKey)
  throw new EnrollmentError('device_binding_mismatch',403);
 await rateLimiter.check(device.deviceId,action);
 return {payload,proof,binding,device};
}
