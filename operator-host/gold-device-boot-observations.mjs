import {sanitizeWindowsBootEvidence} from '../lib/device-boot-telemetry.mjs';

// Durable account + enrolled-device-scoped read-only diagnostic. A reported
// estimate NEVER authorizes owner orphan recovery or relaxes M4 admission.
export class GoldDeviceBootObservations{
  constructor(pool,{now=()=>Date.now()}={}){this.pool=pool;this.now=now;}
  async record({accountId,deviceId,agentVersion,value}={}){
    if(!accountId||!deviceId)return false;
    const evidence=sanitizeWindowsBootEvidence(value,{now:this.now()});
    if(!evidence)return false; // Old Windows/Linux clients may omit the field.
    const {sampledAtMs,bootEstimateMs,systemUptimeMs,agentUptimeMs,source,assurance}=evidence;
    // Atomic replay guard: only a *newer* signed-channel sample can update.
    const result=await this.pool.query(`
      INSERT INTO lr_gold_device_boot_observations
        (account_id,device_id,sampled_at_ms,boot_estimate_ms,system_uptime_ms,
         agent_uptime_ms,source,assurance,agent_version,received_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())
      ON CONFLICT (account_id,device_id) DO UPDATE SET
        sampled_at_ms=EXCLUDED.sampled_at_ms,boot_estimate_ms=EXCLUDED.boot_estimate_ms,
        system_uptime_ms=EXCLUDED.system_uptime_ms,agent_uptime_ms=EXCLUDED.agent_uptime_ms,
        source=EXCLUDED.source,assurance=EXCLUDED.assurance,
        agent_version=EXCLUDED.agent_version,received_at=clock_timestamp()
      WHERE lr_gold_device_boot_observations.sampled_at_ms<EXCLUDED.sampled_at_ms
      RETURNING device_id`,
      [accountId,deviceId,sampledAtMs,bootEstimateMs,systemUptimeMs,agentUptimeMs,
        source,assurance,String(agentVersion||'').slice(0,100)]);
    return result.rowCount===1;
  }
  async inspect({accountId,deviceId}={}){
    if(!accountId||!deviceId)return {state:'missing',evidence:null,releaseEligible:false};
    const row=(await this.pool.query(`
      SELECT sampled_at_ms,boot_estimate_ms,system_uptime_ms,agent_uptime_ms,
             source,assurance,agent_version,received_at
      FROM lr_gold_device_boot_observations
      WHERE account_id=$1 AND device_id=$2`,[accountId,deviceId])).rows[0];
    if(!row)return {state:'missing',evidence:null,releaseEligible:false};
    const receivedAtMs=new Date(row.received_at).getTime();
    const ageMs=this.now()-receivedAtMs;
    return {state:ageMs>=0&&ageMs<=120000?'reported':'stale',releaseEligible:false,
      evidenceClass:'uptime_derived_estimate_not_os_attestation',
      evidence:{sampledAtMs:Number(row.sampled_at_ms),
        bootEstimateMs:Number(row.boot_estimate_ms),systemUptimeMs:Number(row.system_uptime_ms),
        agentUptimeMs:Number(row.agent_uptime_ms),source:row.source,assurance:row.assurance,
        agentVersion:row.agent_version,receivedAtMs,ageMs}};
  }
}
