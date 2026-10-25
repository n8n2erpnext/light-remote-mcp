/*
 * Gold Account-wide Memory Sync policy. This is metadata only; local SQLite
 * remains the ONLY store for actual checkpoints/events/notes and private keys.
 * Account revision protects concurrent edits from different device Walls.
 */
export const MEMORY_DEVICE_SYNC_MODES=Object.freeze(['auto','follow_project','manual']);
const idRE=/^[A-Za-z0-9._:-]{1,160}$/;
const invalid=(s,status=400)=>Object.assign(new Error(s),{status});
const good=(s)=>typeof s==='string'&&idRE.test(s);
export function normalizeMemoryAccountSyncInput(input,accountId,roster){
  if(!good(accountId)||typeof input?.enabled!=='boolean'||
     !Array.isArray(input.devices)||input.devices.length>100)
    throw invalid('memory_account_sync_payload_invalid');
  const owned=new Set(roster.filter(d=>d.accountId===accountId&&d.state!=='revoked')
    .map(x=>x.deviceId));
  const seen=new Set(),entries=[];
  for(const item of input.devices){
    if(!item||!good(item.deviceId)||!owned.has(item.deviceId)||
      seen.has(item.deviceId)||typeof item.selected!=='boolean'||
      !MEMORY_DEVICE_SYNC_MODES.includes(item.mode))
      throw invalid('memory_account_sync_device_invalid',403);
    seen.add(item.deviceId);
    entries.push({deviceId:item.deviceId,selected:item.selected,mode:item.mode});
  }
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)
    throw invalid('memory_account_sync_revision_invalid');
  entries.sort((a,b)=>a.deviceId.localeCompare(b.deviceId));
  return {enabled:input.enabled,expectedRevision:input.expectedRevision,devices:entries};
}
export function memoryModeAllowsScope(mode,{hasVerifiedBinding=false,manualRequested=false}={}){
  if(mode==='auto')return true;
  if(mode==='follow_project')return hasVerifiedBinding===true;
  if(mode==='manual')return manualRequested===true;
  return false;
}
export class GoldMemoryAccountSyncPolicy{
  constructor(pool){if(!pool?.connect||!pool?.query)throw Error('memory_account_sync_pg_required');this.pool=pool;this.schemaReady=null;}
  async ready(){
    if(!this.schemaReady)this.schemaReady=(async()=>{
      await this.pool.query(`CREATE TABLE IF NOT EXISTS lr_gold_memory_sync_accounts(
        account_id TEXT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT FALSE,
        revision BIGINT NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await this.pool.query(`CREATE TABLE IF NOT EXISTS lr_gold_memory_sync_devices(
        account_id TEXT NOT NULL REFERENCES lr_gold_memory_sync_accounts(account_id) ON DELETE CASCADE,
        device_id TEXT NOT NULL,selected BOOLEAN NOT NULL DEFAULT FALSE,
        mode TEXT NOT NULL DEFAULT 'auto' CHECK(mode IN ('auto','follow_project','manual')),
        manual_request_seq BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(account_id,device_id)
      )`);
    })().catch(e=>{this.schemaReady=null;throw e;});
    return this.schemaReady;
  }
  async get(accountId,roster){
    if(!good(accountId))throw invalid('memory_sync_account_invalid',403);
    await this.ready();
    const active=new Set(roster.filter(x=>x.accountId===accountId&&x.state!=='revoked')
      .map(d=>d.deviceId));
    const [state,items]=await Promise.all([
      this.pool.query('SELECT enabled,revision FROM lr_gold_memory_sync_accounts WHERE account_id=$1',[accountId]),
      this.pool.query('SELECT device_id,selected,mode,manual_request_seq FROM lr_gold_memory_sync_devices WHERE account_id=$1',[accountId])
    ]);
    const byId=new Map(items.rows.map(x=>[x.device_id,x]));
    return {enabled:state.rows[0]?.enabled===true,
      revision:Number(state.rows[0]?.revision||0),
      devices:[...active].sort().map(deviceId=>({
        deviceId,selected:byId.get(deviceId)?.selected===true,
        mode:byId.get(deviceId)?.mode||'auto',manualRequestSeq:Number(byId.get(deviceId)?.manual_request_seq||0)
      }))};
  }
  async requestManual(accountId,deviceId,roster){
    if(!good(accountId)||!good(deviceId)||
      !roster.some(d=>d.accountId===accountId&&d.deviceId===deviceId&&d.state!=='revoked'))
      throw invalid('memory_sync_manual_device_invalid',403);
    await this.ready();
    const result=await this.pool.query(`UPDATE lr_gold_memory_sync_devices AS d
      SET manual_request_seq=manual_request_seq+1,updated_at=NOW()
      FROM lr_gold_memory_sync_accounts AS a
      WHERE d.account_id=a.account_id AND d.account_id=$1 AND d.device_id=$2
      AND d.selected=TRUE AND d.mode='manual' AND a.enabled=TRUE
      RETURNING d.manual_request_seq`,[accountId,deviceId]);
    if(!result.rows.length)throw invalid('memory_sync_manual_not_enabled',409);
    return {deviceId,manualRequestSeq:Number(result.rows[0].manual_request_seq)};
  }
  async set(accountId,input,roster){
    const data=normalizeMemoryAccountSyncInput(input,accountId,roster);
    await this.ready();
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('INSERT INTO lr_gold_memory_sync_accounts(account_id) VALUES($1) ON CONFLICT DO NOTHING',[accountId]);
      const lock=await client.query('SELECT revision FROM lr_gold_memory_sync_accounts WHERE account_id=$1 FOR UPDATE',[accountId]);
      if(Number(lock.rows[0]?.revision)!==data.expectedRevision)
        throw invalid('memory_account_sync_revision_conflict',409);
      for(const d of data.devices)await client.query(`INSERT INTO lr_gold_memory_sync_devices
        (account_id,device_id,selected,mode) VALUES($1,$2,$3,$4)
        ON CONFLICT(account_id,device_id) DO UPDATE
        SET selected=excluded.selected,mode=excluded.mode,updated_at=NOW()`,
        [accountId,d.deviceId,d.selected,d.mode]);
      const next=await client.query(`UPDATE lr_gold_memory_sync_accounts
        SET enabled=$2,revision=revision+1,updated_at=NOW()
        WHERE account_id=$1 RETURNING revision`,[accountId,data.enabled]);
      await client.query('COMMIT');
      return {enabled:data.enabled,revision:Number(next.rows[0].revision),devices:data.devices};
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }
}
