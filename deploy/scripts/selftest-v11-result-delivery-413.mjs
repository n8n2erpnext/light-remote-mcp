import fs from 'node:fs';
import {
  RESULT_413_RETRY_BUDGET_BYTES,
  RESULT_DELIVERY_BUDGET_BYTES,
  compactResultAfter413,
  fitResultForDelivery,
  isCompacted413Result
} from '../../device-agent/result-delivery.mjs';

const bytes=value=>Buffer.byteLength(JSON.stringify(value));
const original={
  commandId:'cmd_result_413_regression_1234567890',
  status:'ok',
  exitCode:0,
  stdout:'A'.repeat(6_000_000),
  stderr:'',
  durationMs:10400,
  telemetry:{deviceReceivedAt:1,completedAt:2}
};
const fitted=fitResultForDelivery(original);
if(bytes(original)<5_000_000)throw new Error('fixture_not_large');
if(bytes(fitted)>RESULT_DELIVERY_BUDGET_BYTES)throw new Error('fitted_result_too_large');
if(fitted.status!=='ok'||fitted.exitCode!==0||!fitted.outputTruncated)throw new Error('fitted_result_outcome_changed');
if(Buffer.byteLength(fitted.stdout)<2_500_000||Buffer.byteLength(fitted.stdout)>=Buffer.byteLength(original.stdout))throw new Error('fitted_stdout_budget_invalid');

const signedEnvelope={deviceId:'dev_fixture',timestamp:1,nonce:'n'.repeat(24),signature:'s'.repeat(96),payload:fitted};
if(bytes(signedEnvelope)>=4*1024*1024)throw new Error('signed_envelope_headroom_missing');

const compact=compactResultAfter413(original);
if(bytes(compact)>RESULT_413_RETRY_BUDGET_BYTES)throw new Error('compacted_result_too_large');
if(compact.commandId!==original.commandId||compact.status!=='ok'||compact.exitCode!==0||!compact.outputTruncated||!isCompacted413Result(compact))throw new Error('compacted_result_contract_failed');
if(compact.deliveryOriginalBytes<5_000_000)throw new Error('compacted_original_size_missing');
if(String(compact.stderr||'').includes('device_result_payload_too_large'))throw new Error('compacted_result_became_synthetic_error');

const errorOriginal={...original,status:'error',exitCode:7,stdout:'',stderr:'E'.repeat(6_000_000)};
const errorFit=fitResultForDelivery(errorOriginal);
if(errorFit.status!=='error'||errorFit.exitCode!==7||!errorFit.stderr||bytes(errorFit)>RESULT_DELIVERY_BUDGET_BYTES)throw new Error('error_result_not_preserved');

const dataOriginal={commandId:'cmd_data_large',status:'ok',exitCode:0,stdout:'',stderr:'',durationMs:1,data:{ok:true,tree:'x'.repeat(4_000_000)}};
const dataFit=fitResultForDelivery(dataOriginal);
if(dataFit.status!=='ok'||dataFit.exitCode!==0||dataFit.data?.truncated!==true||dataFit.data?.ok!==true||bytes(dataFit)>RESULT_DELIVERY_BUDGET_BYTES)throw new Error('structured_data_compaction_failed');

const agent=fs.readFileSync(new URL('../../device-agent/operator-agent.mjs',import.meta.url),'utf8');
for(const token of [
  'Number(error.status)===413',
  'compactResultAfter413(result)',
  'fitResultForDelivery(result)',
  'return fitResultForDelivery(result);',
  'device_result_compacted_after_413',
  'device_result_delivery_abandoned_after_compaction'
])if(!agent.includes(token))throw new Error('agent_413_recovery_missing:'+token);
const resultLoop=agent.indexOf('while(!stopped&&!delivered)');
const pulseClear=agent.indexOf('finally{if(commandPulseTimer)clearInterval(commandPulseTimer);}',resultLoop);
if(resultLoop<0||pulseClear<0||pulseClear<resultLoop)throw new Error('command_liveness_not_kept_through_result_delivery');
console.log('v11-device-result-delivery-budget=PASS');
console.log('v11-device-result-outcome-preserved=PASS');
console.log('v11-device-result-413-compaction=PASS');
console.log('v11-device-result-delivery-liveness=PASS');
