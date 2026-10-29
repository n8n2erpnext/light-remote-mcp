import crypto from 'node:crypto';
import {canonicalJson,devicePayloadSha256} from './device-proof.mjs';
import {validateReconnectInventory,verifyReconnectInventory} from './gold-reconnect-proof.mjs';

const identity=/^[A-Za-z0-9._:-]{1,160}$/;
const cmd=/^cmd_[A-Za-z0-9-]{20,}$/;
const i64=/^[1-9][0-9]{0,18}$/;
export const executionTicketMessage=payload=>canonicalJson({kind:'gold-execution-command-v1',...payload});
export const executionGrantMessage=payload=>canonicalJson({kind:'gold-execution-grant-v1',...payload});
const ensure=(condition,code)=>{if(!condition)throw Error(code);};
const epochString=v=>String(v);
function validScope({accountId,deviceId,connectionId}={}) {
  ensure([accountId,deviceId,connectionId].every(v=>identity.test(String(v||''))),'execution_epoch_identity_invalid');
}
const sign=(value,key)=>crypto.sign(null,Buffer.from(value),key).toString('base64url');
const utcMs=v=>v instanceof Date?v.getTime():Date.parse(String(v));
export class GoldExecutionEpochs {
  constructor({pool,signer,now=()=>Date.now()}={}){
    ensure(pool?.connect&&pool?.query&&signer?.privateKey,'execution_epoch_store_invalid');
    this.pool=pool;this.signer=signer;this.now=now;
  }
  async locked(deviceId,fn){
    const client=await this.pool.connect();let active=false;
    try{
      await client.query('BEGIN');active=true;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['lr_gold_m4_resource:'+deviceId]);
      const result=await fn(client);
      await client.query('COMMIT');active=false;
      return result;
    }catch(error){if(active)await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}
  }
  async assertConnection(c,{deviceId,connectionId}){
    const connection=(await c.query(`SELECT connection_id,closed_at,hard_expires_at FROM lr_device_connections
      WHERE device_id=$1 ORDER BY connected_at DESC,connection_id DESC LIMIT 1 FOR UPDATE`,[deviceId])).rows[0];
    ensure(connection?.connection_id===connectionId&&connection.closed_at==null&&
      utcMs(connection.hard_expires_at)>this.now(),'execution_pg_connection_not_current');
  }
  async issue({accountId,deviceId,connectionId,instanceId}={}){
    validScope({accountId,deviceId,connectionId});
    ensure(identity.test(String(instanceId||'')),'execution_epoch_instance_invalid');
    return this.locked(deviceId,async c=>{
      await this.assertConnection(c,{deviceId,connectionId});
      const old=(await c.query('SELECT * FROM lr_gold_device_execution_epochs WHERE device_id=$1 FOR UPDATE',[deviceId])).rows[0];
      ensure(!old||old.account_id===accountId,'execution_epoch_owner_changed');
      // Reconnect has a new instance ID; retransmission within one instance
      // is idempotent. An Agent restart must generate a different instance ID.
      const repeat=old?.connection_id===connectionId&&old?.agent_instance_id===instanceId;
      const epoch=repeat?epochString(old.epoch):old?(BigInt(old.epoch)+1n).toString():'1';
      ensure(i64.test(epoch)&&BigInt(epoch)<=9223372036854775807n,'execution_epoch_exhausted');
      const challenge=repeat?old.challenge:crypto.randomBytes(24).toString('hex');
      if(!repeat)await c.query(`INSERT INTO lr_gold_device_execution_epochs
        (device_id,account_id,connection_id,epoch,agent_instance_id,challenge)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(device_id) DO UPDATE SET
        connection_id=EXCLUDED.connection_id,epoch=EXCLUDED.epoch,
        agent_instance_id=EXCLUDED.agent_instance_id,challenge=EXCLUDED.challenge,
        issued_at=clock_timestamp(),inventory_at=NULL,inventory_sha256=NULL`,
        [deviceId,accountId,connectionId,epoch,instanceId,challenge]);
      await c.query('UPDATE lr_devices SET last_seen_at=clock_timestamp() WHERE device_id=$1',[deviceId]);
      const grant={version:1,accountId,deviceId,connectionId,instanceId,executionEpoch:epoch,challenge};
      return {grant,signature:sign(executionGrantMessage(grant),this.signer.privateKey)};
    });
  }
  async assertReady({accountId,deviceId,connectionId,instanceId}={}){
    validScope({accountId,deviceId,connectionId});
    ensure(identity.test(String(instanceId||'')),'execution_epoch_instance_invalid');
    const row=(await this.pool.query('SELECT account_id,connection_id,agent_instance_id,inventory_at FROM lr_gold_device_execution_epochs WHERE device_id=$1',[deviceId])).rows[0];
    ensure(row?.account_id===accountId&&row.connection_id===connectionId&&
      row.agent_instance_id===instanceId&&row.inventory_at!=null,'execution_inventory_not_reconciled');
    return true;
  }
  async authorizeCommand({accountId,deviceId,connectionId,instanceId,command}={}){
    validScope({accountId,deviceId,connectionId});
    ensure(identity.test(String(instanceId||'')),'execution_command_instance_invalid');
    ensure(cmd.test(String(command?.commandId||''))&&identity.test(String(command?.jobId||'')),'execution_command_id_invalid');
    const hash=devicePayloadSha256(command.payload||{});
    return this.locked(deviceId,async c=>{
      await this.assertConnection(c,{deviceId,connectionId});
      const row=(await c.query('SELECT * FROM lr_gold_device_execution_epochs WHERE device_id=$1 FOR UPDATE',[deviceId])).rows[0];
      ensure(row?.account_id===accountId&&row.connection_id===connectionId&&row.agent_instance_id===instanceId&&row.inventory_at!=null,'execution_epoch_connection_stale');
      const previous=(await c.query('SELECT * FROM lr_gold_execution_command_issuance WHERE command_id=$1 FOR UPDATE',[command.commandId])).rows[0];
      if(previous)ensure(previous.account_id===accountId&&previous.device_id===deviceId&&
        previous.connection_id===connectionId&&epochString(previous.epoch)===epochString(row.epoch)&&
        previous.job_id===command.jobId&&previous.payload_sha256===hash,'execution_old_command_replay_fenced');
      else await c.query(`INSERT INTO lr_gold_execution_command_issuance
        (command_id,job_id,account_id,device_id,connection_id,epoch,payload_sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [command.commandId,command.jobId,accountId,deviceId,connectionId,epochString(row.epoch),hash]);
      const ticket={version:1,accountId,deviceId,connectionId,executionEpoch:epochString(row.epoch),
        commandId:command.commandId,jobId:command.jobId,payloadSha256:hash};
      return {...command,executionAuthorization:{ticket,signature:sign(executionTicketMessage(ticket),this.signer.privateKey)}};
    });
  }
  async validateStart({accountId,deviceId,connectionId,instanceId,authorization}={}){
    validScope({accountId,deviceId,connectionId});
    ensure(identity.test(String(instanceId||'')),'execution_start_instance_invalid');
    const ticket=authorization?.ticket;
    ensure(ticket?.version===1&&ticket.accountId===accountId&&ticket.deviceId===deviceId&&
      ticket.connectionId===connectionId&&cmd.test(String(ticket.commandId||''))&&
      identity.test(String(ticket.jobId||''))&&/^[0-9a-f]{64}$/.test(String(ticket.payloadSha256||'')),
      'execution_start_ticket_invalid');
    ensure(crypto.verify(null,Buffer.from(executionTicketMessage(ticket)),this.signer.publicKey,
      Buffer.from(String(authorization.signature||''),'base64url')),'execution_start_signature_invalid');
    return this.locked(deviceId,async c=>{
      await this.assertConnection(c,{deviceId,connectionId});
      const epoch=(await c.query('SELECT * FROM lr_gold_device_execution_epochs WHERE device_id=$1 FOR UPDATE',[deviceId])).rows[0];
      ensure(epoch?.account_id===accountId&&epoch.connection_id===connectionId&&
        epoch.agent_instance_id===instanceId&&epoch.inventory_at!=null&&
        epochString(epoch.epoch)===ticket.executionEpoch,'execution_start_stale_epoch');
      const issued=(await c.query('SELECT * FROM lr_gold_execution_command_issuance WHERE command_id=$1 FOR UPDATE',[ticket.commandId])).rows[0];
      ensure(issued?.account_id===accountId&&issued.device_id===deviceId&&issued.connection_id===connectionId&&
        epochString(issued.epoch)===ticket.executionEpoch&&issued.job_id===ticket.jobId&&
        issued.payload_sha256===ticket.payloadSha256,'execution_start_unissued_command');
      const prior=(await c.query('SELECT command_id FROM lr_gold_execution_effect_starts WHERE command_id=$1 FOR UPDATE',[ticket.commandId])).rows[0];
      ensure(!prior,'execution_start_already_authorized');
      await c.query('INSERT INTO lr_gold_execution_effect_starts(command_id,device_id,epoch) VALUES($1,$2,$3)',
        [ticket.commandId,deviceId,ticket.executionEpoch]);
      return {authorized:true,epoch:ticket.executionEpoch,commandId:ticket.commandId};
    });
  }
  async recordInventory({accountId,deviceId,connectionId,statement,devicePublicKey}={}){
    validScope({accountId,deviceId,connectionId});
    return this.locked(deviceId,async c=>{
      await this.assertConnection(c,{deviceId,connectionId});
      const row=(await c.query('SELECT * FROM lr_gold_device_execution_epochs WHERE device_id=$1 FOR UPDATE',[deviceId])).rows[0];
      ensure(row?.account_id===accountId&&row.connection_id===connectionId,'execution_inventory_stale_connection');
      const verified=verifyReconnectInventory(statement,{publicKey:devicePublicKey,accountId,deviceId,
        challenge:row.challenge,minEpoch:epochString(row.epoch),now:this.now()});
      ensure(verified.proof.executionEpoch===epochString(row.epoch),'execution_inventory_stale_epoch');
      const proof=verified.proof;
      ensure(/^[0-9a-f]{32}$/.test(String(proof.snapshotId||''))&&
        Number.isSafeInteger(proof.pageIndex)&&Number.isSafeInteger(proof.pageCount)&&
        proof.pageCount>=1&&proof.pageCount<=64&&proof.pageIndex>=0&&proof.pageIndex<proof.pageCount&&
        Number.isSafeInteger(proof.totalItems)&&proof.totalItems>=0&&proof.totalItems<=8192,
        'execution_inventory_page_invalid');
      await c.query(`INSERT INTO lr_gold_device_execution_inventory_pages
        (device_id,epoch,snapshot_id,page_index,page_count,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)
        ON CONFLICT DO NOTHING`,[deviceId,proof.executionEpoch,proof.snapshotId,
        proof.pageIndex,proof.pageCount,JSON.stringify(proof)]);
      const pages=(await c.query(`SELECT page_index,page_count,payload
        FROM lr_gold_device_execution_inventory_pages
        WHERE device_id=$1 AND epoch=$2 AND snapshot_id=$3 ORDER BY page_index FOR UPDATE`,
        [deviceId,proof.executionEpoch,proof.snapshotId])).rows;
      ensure(pages.every(p=>p.page_count===proof.pageCount&&
        p.payload.pageCount===proof.pageCount&&p.payload.totalItems===proof.totalItems&&
        p.payload.challenge===proof.challenge&&p.payload.complete===proof.complete),
        'execution_inventory_manifest_mismatch');
      const accepted=pages.find(p=>p.page_index===proof.pageIndex);
      ensure(accepted&&canonicalJson(accepted.payload)===canonicalJson(proof),'execution_inventory_page_conflict');
      if(pages.length<proof.pageCount)return {verified:true,ready:false,pagesReceived:pages.length,
        pageCount:proof.pageCount,unresolvedFencesUntouched:true};
      const all=pages.flatMap(p=>p.payload.processes||[]);
      ensure(all.length===proof.totalItems&&new Set(all.map(p=>p.jobId)).size===all.length,
        'execution_inventory_incomplete_or_duplicate');
      const digest=crypto.createHash('sha256').update(canonicalJson(pages.map(p=>p.payload))).digest('hex');
      await c.query('UPDATE lr_gold_device_execution_epochs SET inventory_at=clock_timestamp(),inventory_sha256=$2 WHERE device_id=$1',[deviceId,digest]);
      // Complete pagination does not certify that legacy OS work never ran.
      // No no-PID fence is released without independent durable evidence.
      return {verified:true,ready:true,complete:proof.complete,items:all.length,digest,
        unresolvedFencesUntouched:true};
    });
  }
}
export function verifyExecutionGrant(statement,{accountId,deviceId,instanceId,publicKey,minimumEpoch='1'}={}){
  const grant=statement?.grant;
  validScope(grant);
  ensure(grant.accountId===accountId&&grant.deviceId===deviceId&&grant.instanceId===instanceId&&
    i64.test(grant.executionEpoch)&&BigInt(grant.executionEpoch)>=BigInt(minimumEpoch)&&
    /^[a-f0-9]{48}$/.test(grant.challenge),'execution_grant_invalid');
  ensure(crypto.verify(null,Buffer.from(executionGrantMessage(grant)),publicKey,Buffer.from(String(statement.signature||''),'base64url')),'execution_grant_signature_invalid');
  return grant;
}
export function verifyExecutionCommand(command,{grant,accountId,deviceId,publicKey}={}){
  const a=command?.executionAuthorization,t=a?.ticket;
  ensure(t?.version===1&&t.accountId===accountId&&t.deviceId===deviceId&&
    grant?.accountId===accountId&&grant?.deviceId===deviceId&&
    grant?.connectionId===t.connectionId&&grant?.executionEpoch===t.executionEpoch&&
    t.commandId===command.commandId&&t.jobId===command.jobId&&
    t.payloadSha256===devicePayloadSha256(command.payload||{}),'execution_command_old_epoch_or_mismatch');
  ensure(crypto.verify(null,Buffer.from(executionTicketMessage(t)),publicKey,Buffer.from(String(a.signature||''),'base64url')),'execution_command_signature_invalid');
  return t;
}
