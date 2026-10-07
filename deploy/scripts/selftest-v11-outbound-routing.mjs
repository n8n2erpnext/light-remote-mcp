import { isOutboundTarget } from '../../lib/operator-target-route.mjs';

const cases=[
  [{integratedHostEnabled:true,localNodeId:'arm',targetNodeId:'arm'},false,'integrated_same_node_local'],
  [{integratedHostEnabled:true,localNodeId:'arm',targetNodeId:'leaf-a'},true,'integrated_other_node_remote'],
  [{integratedHostEnabled:false,localNodeId:'arm',targetNodeId:'arm'},true,'outbound_only_same_node_remote'],
  [{integratedHostEnabled:false,localNodeId:'arm',targetNodeId:'leaf-a'},true,'outbound_only_other_node_remote']
];
for(const [input,expected,label] of cases){
  const actual=isOutboundTarget(input);
  if(actual!==expected)throw new Error(`${label}: expected ${expected} got ${actual}`);
}
console.log('v11-outbound-routing=PASS');
