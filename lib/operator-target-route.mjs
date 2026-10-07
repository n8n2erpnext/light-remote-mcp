export function isOutboundTarget({integratedHostEnabled=true,localNodeId='',targetNodeId=''}={}){
  return !Boolean(integratedHostEnabled)||String(targetNodeId||'')!==String(localNodeId||'');
}
