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
export function leafCapabilityAdmission({
  reported=[],approved=[],required=[],reportedRevision=null,approvedRevision=null
}={}) {
  const advertised=new Set(normalized(reported)),permitted=new Set(normalized(approved));
  // A stale *reported* revision is diagnostic evidence only. Never promote
  // capabilities that are missing from the authenticated Agent advertisement.
  const validRevision=value=>value!==null&&value!==undefined&&Number.isSafeInteger(Number(value))&&Number(value)>=0;
  const policyRevisionStale=validRevision(reportedRevision)&&validRevision(approvedRevision)
    &&Number(approvedRevision)>=1&&Number(reportedRevision)<Number(approvedRevision);
  const capabilities=[...advertised].filter(cap=>permitted.has(cap)).sort();
  const missingCapabilities=[],missingCapabilityReasons={};
  for(const cap of normalized(required)){
    if(advertised.has(cap)&&permitted.has(cap))continue;
    missingCapabilities.push(cap);
    missingCapabilityReasons[cap]=!permitted.has(cap)
      ?'enrollment_not_approved'
      :policyRevisionStale?'agent_policy_revision_stale':'agent_not_advertising';
  }
  return {capabilities,missingCapabilities,missingCapabilityReasons};
}
