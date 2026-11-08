export const REAL_REMOTE_VIEW_CAPABILITY='desktop';
export const REAL_REMOTE_INPUT_CAPABILITY='desktop-input';

function clean(value){
  const out=[];
  for(const raw of Array.isArray(value)?value:[]){
    const item=String(raw||'').trim();
    if(item&&!out.includes(item))out.push(item);
  }
  return out;
}

export function withRealRemoteCapabilities(capabilities,{available=false}={}){
  const out=clean(capabilities);
  if(available){
    if(!out.includes(REAL_REMOTE_VIEW_CAPABILITY))out.push(REAL_REMOTE_VIEW_CAPABILITY);
    if(!out.includes(REAL_REMOTE_INPUT_CAPABILITY))out.push(REAL_REMOTE_INPUT_CAPABILITY);
  }
  return out.sort();
}

export function defaultRealRemoteDenied({discovered=[],denied=[],inputDecision=null}={}){
  const found=clean(discovered),out=clean(denied).filter(cap=>found.includes(cap));
  if(!found.includes(REAL_REMOTE_INPUT_CAPABILITY))return out.sort();
  const decision=String(inputDecision||'').trim().toLowerCase();
  if(decision==='allow')return out.filter(cap=>cap!==REAL_REMOTE_INPUT_CAPABILITY).sort();
  if(!out.includes(REAL_REMOTE_INPUT_CAPABILITY))out.push(REAL_REMOTE_INPUT_CAPABILITY);
  return out.sort();
}

export function realRemotePolicyAfterSave(policy,{grantable=[],allowed=[]}={}){
  const next={...(policy||{})};
  const grants=clean(grantable),allows=clean(allowed);
  if(grants.includes(REAL_REMOTE_INPUT_CAPABILITY)){
    next.realRemoteInputDecision=allows.includes(REAL_REMOTE_INPUT_CAPABILITY)?'allow':'deny';
    next.realRemoteInputDecisionAt=Date.now();
  }
  return next;
}
