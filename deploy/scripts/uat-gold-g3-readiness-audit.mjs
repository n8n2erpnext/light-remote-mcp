// Read-only Gold G3 deployed Operator acceptance gate.
// Reports counts and readiness-contract violations, never device/account IDs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

export function evaluateGoldG3Readiness({nodes,sourceParity}){
  if(!Array.isArray(nodes))throw Error('gold_g3_fleet_nodes_required');
  const leaves=nodes.filter(n=>n.mode==='outbound-leaf');
  const fresh=leaves.filter(n=>n.channelFresh===true);
  const explicit=leaves.filter(n=>typeof n.executorReady==='boolean');
  const unknownFresh=fresh.filter(n=>typeof n.executorReady!=='boolean');
  const optimistic=fresh.filter(n=>n.dispatchReady===true&&n.executorReady!==true);
  const unsafeFalse=leaves.filter(n=>n.executorReady===false&&n.dispatchReady===true);
  const staleRoutable=leaves.filter(n=>n.channelFresh!==true&&n.dispatchReady===true);
  return {
    sourceParity:sourceParity===true,
    outboundLeaves:leaves.length,
    freshOutboundChannels:fresh.length,
    explicitExecutorSignals:explicit.length,
    unknownOnFreshChannels:unknownFresh.length,
    optimisticAdmissionWithoutExecutorProof:optimistic.length,
    unsafeExecutorFalseAdmission:unsafeFalse.length,
    staleChannelAdmission:staleRoutable.length,
    gate:sourceParity!==true?'BLOCKED_OPERATOR_SOURCE_MISMATCH':
      staleRoutable.length||unsafeFalse.length?'FAIL_ROUTING_SAFETY':
      !fresh.length||unknownFresh.length?'BLOCKED_EXECUTOR_EVIDENCE':
      'SOURCE_AND_FLEET_EVIDENCE_PRESENT',
    warning:'transport online and dispatchReady alone do not constitute executor health'
  };
}
export async function queryGoldFleet(socketPath){
  const payload=await new Promise((resolve,reject)=>{
    const req=http.get({socketPath,path:'/v1/fleet',timeout:2500},res=>{
      let body='';res.on('data',d=>body+=d);res.on('end',()=>{
        if(res.statusCode!==200)return reject(Error('gold_fleet_http_'+res.statusCode));
        try{resolve(JSON.parse(body));}catch{return reject(Error('gold_fleet_invalid_json'));}
      });
    });
    req.on('error',reject);req.on('timeout',()=>req.destroy(Error('gold_fleet_timeout')));
  });
  if(payload.ok!==true||!Array.isArray(payload.nodes))throw Error('gold_fleet_invalid_contract');
  return payload.nodes;
}
function fileSha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
export function activeGoldOperatorFleetPath(){
  const pid=Number(execFileSync('systemctl',['show','-p','MainPID','--value','light-remote-gold-operator'],{encoding:'utf8',timeout:2500}).trim());
  if(!Number.isSafeInteger(pid)||pid<2)throw Error('gold_operator_not_running');
  const cmdline=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0').filter(Boolean);
  const execPath=cmdline.find(arg=>arg.endsWith('/operator-host/executor.mjs'));
  if(!execPath)throw Error('gold_operator_entrypoint_not_found');
  const file=fs.realpathSync(execPath),dir=path.dirname(path.dirname(file));
  if(dir!=='/opt/light-remote-gold-uat'&&
    !(path.dirname(dir)==='/opt/light-remote-gold-uat-candidates'&&/^[a-f0-9]{40}$/.test(path.basename(dir))))
    throw Error('gold_operator_unexpected_source_root');
  return path.join(dir,'operator-host/fleet-router.mjs');
}
if(process.argv[1]&&process.argv[1].endsWith('uat-gold-g3-readiness-audit.mjs')){
  const installed=activeGoldOperatorFleetPath();
  const expected=String(process.env.GOLD_G3_EXPECTED_FLEET_SHA||'');
  if(!/^[a-f0-9]{64}$/i.test(expected))throw Error('gold_g3_expected_source_sha_required');
  const actual=fileSha(installed);
  const nodes=await queryGoldFleet('/run/light-remote-gold-uat/operator.sock');
  const report=evaluateGoldG3Readiness({nodes,sourceParity:actual===expected});
  console.log('G3_GOLD_LIVE_OPERATOR_ACCEPTANCE='+JSON.stringify({
    ...report,sourceMatch:actual===expected,
    // No account identifiers, node IDs, capabilities or host IPs.
  }));
  console.log('G3_GOLD_LIVE_OPERATOR_GATE='+report.gate);
}
