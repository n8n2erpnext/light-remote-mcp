// Operator-side capability diagnostics. This helper never grants authority.
// Effective Fleet capabilities always remain the intersection of current
// authenticated Agent advertisements and enrollment-approved permissions.
function normalized(value) {
  const out=[];
  for(const raw of Array.isArray(value)?value:[]){
    const cap=String(raw||'').trim();
    if(/^[A-Za-z0-9._:-]{1,80}$/.test(cap)&&!out.includes(cap)&&out.length<64)out.push(cap);
  }
  return out.sort();
}
export function leafCapabilityAdmission({reported=[],approved=[],required=[]}={}) {
  const advertised=new Set(normalized(reported)),permitted=new Set(normalized(approved));
  const capabilities=[...advertised].filter(cap=>permitted.has(cap)).sort();
  const missingCapabilities=[],missingCapabilityReasons={};
  for(const cap of normalized(required)){
    if(advertised.has(cap)&&permitted.has(cap))continue;
    missingCapabilities.push(cap);
    missingCapabilityReasons[cap]=!permitted.has(cap)
      ?'enrollment_not_approved'
      :'agent_not_advertising';
  }
  return {capabilities,missingCapabilities,missingCapabilityReasons};
}
