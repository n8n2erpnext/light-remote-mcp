/* Durable, normalized account-scope deletion metadata; no Memory content. */
import {checkAccountDeletionEnvelope} from '../device-agent/gold-memory-account-delete.mjs';
const fail=(code,status=400)=>Object.assign(new Error(code),{status});
const validId=s=>typeof s==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(s);
const active=(roster,a)=>roster.filter(d=>d.accountId===a&&d.state!=='revoked').slice(0,100);
export class GoldMemoryAccountDelete {
  constructor(pool){if(!pool?.query||!pool?.connect)throw Error('memory_delete_pg_required');this.pool=pool;this.readyPromise=null;}
  async ready(){
    if(!this.readyPromise)this.readyPromise=this.pool.query("SELECT to_regclass('public.lr_gold_memory_delete_requests') IS NOT NULL AS requests,to_regclass('public.lr_gold_memory_delete_targets') IS NOT NULL AS targets")
      .then(x=>{if(!x.rows[0]?.requests||!x.rows[0]?.targets)throw fail('gold_memory_delete_migration_037_required',503)})
      .catch(e=>{this.readyPromise=null;throw e;});
    return this.readyPromise;
  }
  async begin(accountId,deviceId,envelope,roster,advertisedKey){
    await this.ready();
    const rec=checkAccountDeletionEnvelope(envelope);
    if(!validId(accountId)||!validId(deviceId)||rec.accountId!==accountId||
      rec.homeDeviceId!==deviceId||!active(roster,accountId).some(d=>d.deviceId===deviceId))
      throw fail('memory_account_delete_home_account_binding_denied',403);
    // Online, signed enrollment advertises the active Home Memory public identity.
    if(advertisedKey!==envelope.homeSignPublicKey)
      throw fail('memory_account_delete_enrolled_home_key_unavailable',409);
    const members=active(roster,accountId);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const existing=await client.query('SELECT * FROM lr_gold_memory_delete_requests WHERE account_id=$1 AND scope_id=$2 FOR UPDATE',[accountId,rec.scopeId]);
      if(existing.rows.length)throw fail('memory_account_delete_already_requested',409);
      await client.query('INSERT INTO lr_gold_memory_delete_requests(account_id,scope_id,home_device_id,home_epoch,generation,scope_name,issued_at,home_public_key,home_signature) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [accountId,rec.scopeId,deviceId,rec.homeEpoch,1,rec.scopeName,rec.issuedAt,envelope.homeSignPublicKey,envelope.signature]);
      for(const d of members)await client.query('INSERT INTO lr_gold_memory_delete_targets(account_id,scope_id,device_id) VALUES($1,$2,$3)',[accountId,rec.scopeId,d.deviceId]);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}
    finally{client.release();}
    return this.status(accountId,rec.scopeId);
  }
  async isDeleted(accountId,scopeId){
    await this.ready();
    return (await this.pool.query('SELECT 1 FROM lr_gold_memory_delete_requests WHERE account_id=$1 AND scope_id=$2',[accountId,scopeId])).rows.length>0;
  }
  async pending(accountId,deviceId){
    if(!validId(accountId)||!validId(deviceId))throw fail('memory_account_delete_identity_invalid',403);
    await this.ready();
    const rows=await this.pool.query(
      'SELECT r.scope_id,r.home_device_id,r.home_epoch,r.generation,r.scope_name,r.issued_at,r.home_public_key,r.home_signature FROM lr_gold_memory_delete_requests r JOIN lr_gold_memory_delete_targets t USING(account_id,scope_id) WHERE r.account_id=$1 AND t.device_id=$2 AND t.acknowledged_at IS NULL ORDER BY r.issued_at ASC LIMIT 50',
      [accountId,deviceId]);
    return rows.rows.map(x=>({record:{protocol:'lr-memory-account-delete-v1',accountId,
      scopeId:x.scope_id,homeDeviceId:x.home_device_id,homeEpoch:Number(x.home_epoch),
      generation:Number(x.generation),scopeName:x.scope_name,issuedAt:Number(x.issued_at)},
      homeSignPublicKey:x.home_public_key,signature:x.home_signature}));
  }
  async ack(accountId,deviceId,scopeId){
    if(!validId(accountId)||!validId(deviceId)||typeof scopeId!=='string'||scopeId.length!==36)
      throw fail('memory_account_delete_ack_invalid',400);
    await this.ready();
    const r=await this.pool.query('UPDATE lr_gold_memory_delete_targets SET acknowledged_at=COALESCE(acknowledged_at,NOW()) WHERE account_id=$1 AND device_id=$2 AND scope_id=$3 RETURNING device_id,acknowledged_at',
      [accountId,deviceId,scopeId]);
    if(!r.rows.length)throw fail('memory_account_delete_not_targeted',403);
    return {scopeId,deviceId,acknowledged:true};
  }
  async list(accountId){
    if(!validId(accountId))throw fail('memory_account_delete_identity_invalid',403);
    await this.ready();
    const rows=await this.pool.query(
      'SELECT r.scope_id,r.scope_name,r.issued_at,COUNT(t.device_id)::int AS total,COUNT(t.acknowledged_at)::int AS acknowledged FROM lr_gold_memory_delete_requests r JOIN lr_gold_memory_delete_targets t USING(account_id,scope_id) WHERE r.account_id=$1 GROUP BY r.scope_id,r.scope_name,r.issued_at ORDER BY r.issued_at DESC LIMIT 32',[accountId]);
    return rows.rows.map(x=>({scopeId:x.scope_id,scopeName:x.scope_name,
      state:Number(x.acknowledged)===Number(x.total)?'completed':'pending',
      acknowledged:Number(x.acknowledged),total:Number(x.total),issuedAt:Number(x.issued_at)}));
  }
  async status(accountId,scopeId){
    await this.ready();
    const r=await this.pool.query(
      'SELECT r.home_device_id,r.issued_at,t.device_id,t.acknowledged_at FROM lr_gold_memory_delete_requests r JOIN lr_gold_memory_delete_targets t USING(account_id,scope_id) WHERE r.account_id=$1 AND r.scope_id=$2 ORDER BY t.device_id',
      [accountId,scopeId]);
    if(!r.rows.length)throw fail('memory_account_delete_not_requested',404);
    const targets=r.rows.map(x=>({deviceId:x.device_id,acknowledged:x.acknowledged_at!=null,
      acknowledgedAt:x.acknowledged_at?.toISOString?.()||null}));
    return {scopeId,homeDeviceId:r.rows[0].home_device_id,
      state:targets.every(x=>x.acknowledged)?'completed':'pending',
      acknowledged:targets.filter(x=>x.acknowledged).length,total:targets.length,targets,
      note:'Other backups, exports and snapshots are not erased.'};
  }
}
