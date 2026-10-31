import crypto from 'node:crypto';

/**
 * Gold Connection Lifecycle GC. Device/plan-neutral, PG authoritative.
 * Default 60m of continuous disconnect. Reconnecting resets eligibility.
 * A signed terminal ACK is the only evidence of a completed OS effect.
 * GC may retire server jobs as UNKNOWN but fences unresolved OS processes.
 */
export const DEFAULT_OFFLINE_GC_MS = 60 * 60 * 1000;
export function offlineGcEligibility({connection=null,device=null,channelFresh=false,now=Date.now(),delayMs=DEFAULT_OFFLINE_GC_MS}={}) {
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(delayMs)||delayMs<60000)throw Error('gc_invalid_clock');
  if(channelFresh)return {eligible:false,reason:'channel_fresh'};
  const latest=connection;
  const closed=latest?.closedAt==null?null:Number(latest.closedAt);
  const expires=latest?.hardExpiresAt==null?null:Number(latest.hardExpiresAt);
  const seen=device?.lastSeenAt==null?null:Number(device.lastSeenAt);
  // Latest connection is authoritative. A newly connected lease must be
  // rejected by a fresh channel/presence sample before any irreversible GC.
  const active=latest&&closed==null&&Number.isFinite(expires)&&expires>now;
  let since=null,reason=null;
  if(Number.isFinite(closed)&&closed>0){since=closed;reason='connection_disconnected';}
  else if(Number.isFinite(expires)&&expires>0&&expires<=now){since=expires;reason='plan_lease_expired';}
  else if(active&&Number.isFinite(seen)&&seen>0&&now-seen>=delayMs){
    // Presence records can still say ONLINE after an ungraceful network drop.
    since=seen;reason='network_lost';
  }else if(!latest&&Number.isFinite(seen)&&seen>0&&now-seen>=delayMs){
    since=seen;reason='network_lost';
  }
  if(since==null||since>now)return {eligible:false,reason:'not_offline'};
  const elapsedMs=now-since;
  return {eligible:elapsedMs>=delayMs,reason,offlineSinceMs:since,elapsedMs};
}
const positiveInt=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export class GoldConnectionJobReaper {
  constructor({pool,channelFresh=async()=>false,offlineMs=DEFAULT_OFFLINE_GC_MS,limit=64,allowedDevices=null,now=()=>Date.now(),event=()=>{},onRetired=()=>{}}={}) {
    if(!pool?.connect||!pool?.query||typeof channelFresh!=='function'||!positiveInt(offlineMs,60000,604800000)||!positiveInt(limit,1,128))
      throw Error('gold_connection_gc_invalid_config');
    // An explicit allowlist protects unrelated historical claims during UAT.
    // null = account-wide production behavior; [] or invalid IDs fail closed.
    if(allowedDevices!==null&&(!Array.isArray(allowedDevices)||!allowedDevices.length||
        allowedDevices.length>128||allowedDevices.some(id=>!/^[A-Za-z0-9._:-]{1,160}$/.test(String(id||'')))))
      throw Error('gold_connection_gc_invalid_device_allowlist');
    this.allowedDevices=allowedDevices===null?null:[...new Set(allowedDevices)].sort();
    this.pool=pool;this.channelFresh=channelFresh;this.offlineMs=offlineMs;this.limit=limit;this.now=now;this.event=event;this.onRetired=onRetired;this.cursor='';
  }
  async candidates() {
    // Iterate only devices with unfinished work or resource leases.
    const base=`SELECT DISTINCT device_id FROM (
      SELECT device_id FROM lr_gold_device_resource_claims
      UNION ALL SELECT device_id FROM lr_gold_personal_agent_work WHERE state IN ('queued','running')
      UNION ALL SELECT device_id FROM lr_gold_job_records WHERE status IN ('queued','running')
      ) AS pending WHERE device_id IS NOT NULL`;
    const scoped=this.allowedDevices?' AND device_id=ANY($3::text[])':'';
    const params=[this.cursor,this.limit,...(this.allowedDevices?[this.allowedDevices]:[])];
    const forward=(await this.pool.query(base+scoped+' AND device_id>$1 ORDER BY device_id LIMIT $2',params)).rows.map(r=>r.device_id);
    const more=forward.length<this.limit?(await this.pool.query(base+scoped+' AND device_id<=$1 ORDER BY device_id LIMIT $2',
      [this.cursor,this.limit-forward.length,...(this.allowedDevices?[this.allowedDevices]:[])])).rows.map(r=>r.device_id):[];
    const ids=[...forward,...more];if(ids.length)this.cursor=ids.at(-1);
    return ids;
  }
  async sweep({dryRun=true}={}) {
    const result={scanned:0,eligible:0,cleaned:0,skipped:0,details:[]};
    for(const deviceId of await this.candidates()){
      result.scanned++;
      try{
        const row=await this.sweepDevice(deviceId,{dryRun});
        if(row.eligible)result.eligible++;else result.skipped++;
        if(row.cleaned)result.cleaned++;
        result.details.push(row);
      }catch(error){
        result.details.push({deviceId,error:String(error?.code||error?.message||'gc_failed').slice(0,100)});
        this.event({type:'gold_connection_gc_error',deviceId,code:String(error?.code||'GC_FAILED')});
      }
    }
    return result;
  }
  async sweepDevice(deviceId,{dryRun=true,expectedOnlyJobId=null,actorAccountId=null,adminReason=null}={}) {
    // Exact-job selection is only for authenticated admin recovery; normal GC remains device-scoped.
    if(expectedOnlyJobId!==null&&(!/^[a-f0-9-]{36}$/i.test(String(expectedOnlyJobId))||
      !/^[A-Za-z0-9._:-]{1,160}$/.test(String(actorAccountId||''))||
      typeof adminReason!=='string'||adminReason.trim().length<8||adminReason.length>300))
      throw Error('gold_admin_gc_selection_invalid');
    if(!/^[A-Za-z0-9._:-]{1,160}$/.test(String(deviceId||'')))throw Error('gc_invalid_device');
    // Defense in depth: even an accidental direct sweepDevice() call must
    // honor UAT scoping, not merely the enumerator's SQL filter.
    if(this.allowedDevices&&!this.allowedDevices.includes(deviceId))
      return {deviceId,eligible:false,cleaned:false,reason:'not_in_gc_allowlist'};
    const now=this.now(),client=await this.pool.connect();let begun=false;
    try {
      await client.query('BEGIN');begun=true;
      // Reconcile M3 account -> M4 device locks, always in that order.
      const accounts=(await client.query(`SELECT DISTINCT account_id FROM (
          SELECT account_id FROM lr_gold_personal_agent_work WHERE device_id=$1 AND state IN ('queued','running')
          UNION ALL SELECT account_id FROM lr_gold_device_resource_claims WHERE device_id=$1
          UNION ALL SELECT account_id FROM lr_gold_job_records WHERE device_id=$1 AND status IN ('queued','running')
        ) q ORDER BY account_id`,[deviceId])).rows.map(r=>r.account_id);
      for(const account of accounts)await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['lr_gold_personal_agent:'+account]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['lr_gold_m4_resource:'+deviceId]);
      const conn=(await client.query(`SELECT connection_id,connected_at,closed_at,hard_expires_at
          FROM lr_device_connections WHERE device_id=$1
          ORDER BY connected_at DESC,connection_id DESC LIMIT 1 FOR UPDATE`,[deviceId])).rows[0];
      const dev=(await client.query('SELECT state,last_seen_at FROM lr_devices WHERE device_id=$1 FOR UPDATE',[deviceId])).rows[0];
      // Post-lock recheck is mandatory: old disconnect must not win against a reconnect.
      const channelFresh=await this.channelFresh(deviceId);
      const eligibility=offlineGcEligibility({
        connection:conn?{closedAt:conn.closed_at?.getTime?.()??(conn.closed_at?Date.parse(conn.closed_at):null),
          hardExpiresAt:conn.hard_expires_at?.getTime?.()??(conn.hard_expires_at?Date.parse(conn.hard_expires_at):null)}:null,
        device:dev?{state:dev.state,lastSeenAt:dev.last_seen_at?.getTime?.()??(dev.last_seen_at?Date.parse(dev.last_seen_at):null)}:null,
        channelFresh,now,delayMs:this.offlineMs
      });
      if(!eligibility.eligible){await client.query('ROLLBACK');begun=false;return {deviceId,eligible:false,reason:eligibility.reason};}
      const base={deviceId,eligible:true,cleaned:false,reason:eligibility.reason,offlineSinceMs:eligibility.offlineSinceMs};
      if(dryRun){await client.query('ROLLBACK');begun=false;return {...base,dryRun:true};}
      const activeJobs=(await client.query(`SELECT job_id,account_id,status
        FROM lr_gold_job_records WHERE device_id=$1 AND status IN ('queued','running') FOR UPDATE`,[deviceId])).rows;
      const work=(await client.query(`SELECT job_id,account_id,resource_key,resource_mode,state
        FROM lr_gold_personal_agent_work WHERE device_id=$1 AND state IN ('queued','running') FOR UPDATE`,[deviceId])).rows;
      const realClaims=(await client.query(`SELECT job_id,account_id,resource_key,resource_mode,worker_state,process_id
        FROM lr_gold_device_resource_claims WHERE device_id=$1 FOR UPDATE`,[deviceId])).rows;
      const claimed=new Set(realClaims.map(c=>c.job_id));
      // A crash can happen BETWEEN the scheduler's RUNNING transition and
      // M4 claim persistence. Such an admitted operation still needs a fence.
      const unclaimedRunning=work.filter(w=>w.state==='running'&&!claimed.has(w.job_id))
        .map(w=>({job_id:w.job_id,account_id:w.account_id,resource_key:w.resource_key||'device:unknown',
          resource_mode:w.resource_mode||'exclusive',worker_state:'running_unclaimed',process_id:null}));
      const classified=new Set([...claimed,...unclaimedRunning.map(w=>w.job_id)]);
      // When only the job ledger survived the crash, conservatively fence the
      // entire device; never infer a missing resource intent from user input.
      const orphanLedger=activeJobs.filter(j=>j.status==='running'&&!classified.has(j.job_id))
        .map(j=>({job_id:j.job_id,account_id:j.account_id,resource_key:'device:unknown',
          resource_mode:'exclusive',worker_state:'ledger_running_unclaimed',process_id:null}));
      const claims=[...realClaims,...unclaimedRunning,...orphanLedger];
      const retiredJobIds=[...new Set([...activeJobs.map(j=>j.job_id),...work.map(w=>w.job_id),...claims.map(c=>c.job_id)])];
      if(expectedOnlyJobId!==null&&
        (retiredJobIds.length!==1||retiredJobIds[0]!==expectedOnlyJobId||
          !realClaims.some(c=>c.job_id===expectedOnlyJobId))){
        await client.query('ROLLBACK');begun=false;
        return {...base,eligible:false,cleaned:false,reason:'admin_exact_job_scope_changed'};
      }
      // No forged ACK: known background processes remain fenced even after
      // their SERVER claim is retired. The device must reconcile them before
      // any new conflicting OS effect can start.
      const verifiedAck=new Map();
      for(const claim of claims){
        const ack=(await client.query(`SELECT 1 FROM lr_gold_terminal_receipt_acks
          WHERE account_id=$1 AND device_id=$2
            AND (job_id=$3 OR ($4::text IS NOT NULL AND process_id=$4))
          LIMIT 1`,[claim.account_id,deviceId,claim.job_id,claim.process_id])).rowCount>0;
        verifiedAck.set(claim.job_id,ack);
        if(!ack){
          await client.query(`INSERT INTO lr_gold_device_gc_fences
           (job_id,account_id,device_id,resource_key,resource_mode,process_id,recovery_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(job_id) DO NOTHING`,
           [claim.job_id,claim.account_id,deviceId,claim.resource_key,claim.resource_mode,claim.process_id,eligibility.reason]);
        }
      }
      // A previous signed ACK is an integrity/replay case, never an admin
      // reason to synthesize an UNKNOWN retirement or overwrite real evidence.
      if(expectedOnlyJobId!==null&&verifiedAck.get(expectedOnlyJobId)===true){
        await client.query('ROLLBACK');begun=false;
        return {...base,eligible:false,cleaned:false,reason:'signed_terminal_ack_replay_required'};
      }
      // An un-dispatched queue has no OS effects. An admitted/running job
      // becomes UNKNOWN; never use cancelled/success without a device receipt.
      await client.query(`UPDATE lr_gold_personal_agent_work SET
        state=CASE WHEN state='queued' THEN 'finished' ELSE 'unknown' END,
        finished_at=clock_timestamp(),queue_reason=NULL,
        disposition=CASE WHEN state='queued' THEN 'offline_gc_before_dispatch' ELSE 'offline_gc_unknown' END
        WHERE device_id=$1 AND state IN ('queued','running')`,[deviceId]);
      await client.query(`UPDATE lr_gold_job_records SET
         status='interrupted',finished_at=clock_timestamp(),exit_code=NULL,
         public_view=jsonb_set(jsonb_set(jsonb_set(public_view,'{status}','"interrupted"'::jsonb,true),
           '{effectState}','"unknown"'::jsonb,true),'{signedResultVerified}','false'::jsonb,true),
         updated_at=clock_timestamp()
         WHERE device_id=$1 AND status IN ('queued','running')`,[deviceId]);
      await client.query('DELETE FROM lr_gold_device_resource_claims WHERE device_id=$1',[deviceId]);
      for(const claim of claims){
        const hasReceipt=verifiedAck.get(claim.job_id)===true;
        await client.query(`INSERT INTO lr_audit_events(event_id,actor_account_id,owner_account_id,kind,resource_type,resource_id,metadata)
          VALUES($1,$2,$3,$4,'managed_process',$5,$6::jsonb)`,[
            'gold_gc_'+crypto.randomUUID(),actorAccountId||claim.account_id,claim.account_id,
            expectedOnlyJobId!==null?'gold_admin_connection_gc_unknown':
              hasReceipt?'gold_connection_gc_existing_receipt':'gold_connection_gc_unknown',claim.job_id,
            JSON.stringify({deviceId,disposition:hasReceipt?'offline_gc_existing_receipt':'offline_gc_unknown',
              offlineSinceMs:eligibility.offlineSinceMs,reason:eligibility.reason,
              previousWorkerState:claim.worker_state,processOutcome:hasReceipt?'verified_terminal_receipt_present':'unknown',
              terminalReceiptCreated:false,fenced:!hasReceipt,
              ...(expectedOnlyJobId!==null?{adminAccountId:actorAccountId,
                adminReason:adminReason.trim(),manualRecovery:true}: {})})
          ]);
      }
      // Refresh the PostgreSQL connection/presence *after* the cleanup writes.
      // A reconnect committed while this transaction was processing claims
      // invalidates the original offline snapshot, even on another Operator.
      // The device row lock serializes durable heartbeat updates; a future
      // execution-epoch gate must additionally protect in-flight dispatch.
      const newConn=(await client.query(`SELECT connection_id,connected_at,closed_at,hard_expires_at
          FROM lr_device_connections WHERE device_id=$1
          ORDER BY connected_at DESC,connection_id DESC LIMIT 1 FOR UPDATE`,[deviceId])).rows[0];
      const newDev=(await client.query('SELECT state,last_seen_at FROM lr_devices WHERE device_id=$1 FOR UPDATE',[deviceId])).rows[0];
      const asMs=v=>v==null?null:(v instanceof Date?v.getTime():Date.parse(String(v)));
      const sameConnection=String(newConn?.connection_id||'')===String(conn?.connection_id||'')&&
        asMs(newConn?.connected_at)===asMs(conn?.connected_at)&&
        asMs(newConn?.closed_at)===asMs(conn?.closed_at)&&
        asMs(newConn?.hard_expires_at)===asMs(conn?.hard_expires_at);
      const current=offlineGcEligibility({
        connection:newConn?{closedAt:asMs(newConn.closed_at),hardExpiresAt:asMs(newConn.hard_expires_at)}:null,
        device:newDev?{state:newDev.state,lastSeenAt:asMs(newDev.last_seen_at)}:null,
        channelFresh:await this.channelFresh(deviceId),now:this.now(),delayMs:this.offlineMs
      });
      const samePresence=String(newDev?.state||'')===String(dev?.state||'')&&
        asMs(newDev?.last_seen_at)===asMs(dev?.last_seen_at);
      if(!sameConnection||!samePresence||!current.eligible||current.offlineSinceMs!==eligibility.offlineSinceMs){
        await client.query('ROLLBACK');begun=false;
        return {...base,eligible:false,cleaned:false,reason:'connection_changed_during_gc'};
      }
      await client.query('COMMIT');begun=false;
      try{this.onRetired({deviceId,jobIds:retiredJobIds,reason:eligibility.reason});}catch(error){this.event({type:'gold_connection_gc_retire_callback_failed',deviceId,code:String(error?.code||'CALLBACK_FAILED')});}
      this.event({type:'gold_connection_gc_completed',deviceId,reason:eligibility.reason,retiredClaims:claims.length,retiredJobs:retiredJobIds.length});
      return {...base,cleaned:true,retiredClaims:claims.length,retiredJobs:retiredJobIds.length};
    }catch(error){if(begun)await client.query('ROLLBACK').catch(()=>{});throw error}
    finally{client.release()}
  }
}
