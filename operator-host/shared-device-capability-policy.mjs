// Shared Pro Team/Pro Share operation fence. It deliberately does NOT grant
// access: actor, A/B, billing, owner and current connection are checked by
// the calling team's or share's independent authority.
export const SHARED_DEVICE_OPERATION_FAMILIES=Object.freeze([
 'exec','fs','search','process','terminal','scp','desktop'
]);
const ID=/^[A-Za-z0-9._:-]{1,80}$/;
export class SharedDeviceCapabilityError extends Error{
 constructor(message,status=403){super(message);this.status=status;}
}
export function assertSharedDeviceCapabilityPolicy({
 operation,requiredCapabilities=[],approvedCapabilities,routeCapabilities
}={}){
 const action=String(operation||'');
 if(!SHARED_DEVICE_OPERATION_FAMILIES.includes(action))
  throw new SharedDeviceCapabilityError('shared_operation_not_allowed',403);
 if(!Array.isArray(requiredCapabilities)||requiredCapabilities.length>32||
    requiredCapabilities.some(c=>typeof c!=='string'||!ID.test(c)))
  throw new SharedDeviceCapabilityError('shared_required_capabilities_invalid',400);
 if(!Array.isArray(approvedCapabilities)||!Array.isArray(routeCapabilities))
  throw new SharedDeviceCapabilityError('shared_device_policy_required',403);
 const approved=new Set(approvedCapabilities),routed=new Set(routeCapabilities);
 if(requiredCapabilities.some(c=>!approved.has(c)||!routed.has(c)))
  throw new SharedDeviceCapabilityError('shared_device_capability_denied',403);
 return Object.freeze({operation:action,
  requiredCapabilities:Object.freeze([...new Set(requiredCapabilities)].sort())});
}
