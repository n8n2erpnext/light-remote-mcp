// P2-I1: device Short ID and bounded discovery substrate.
// This module is NOT on a live route until A/B V2 authorization is integrated.
import crypto from 'node:crypto';
export const SHORT_ID_ALPHABET='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SHORT_ID_RE=/^[0-9A-HJKMNP-TV-Z]{6}$/;
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(value);
function freshShortId(randomInt=crypto.randomInt){
 let id='';
 for(let i=0;i<6;i++)id+=SHORT_ID_ALPHABET[randomInt(SHORT_ID_ALPHABET.length)];
 return id;
}

/** Idempotent across concurrent Operators; SQL UNIQUE device_id and short_id
 * enforce a single stable mapping; tombstoned Short IDs are never recycled. */
export async function ensureGoldDeviceShortId(pool,{deviceId,randomInt=crypto.randomInt}={}){
 if(!pool?.query||!validId(deviceId))throw Error('gold_short_id_device_invalid');
 for(let attempt=0;attempt<24;attempt++){
  const existing=await pool.query(
   'SELECT short_id FROM lr_gold_device_short_ids WHERE device_id=$1',[deviceId]);
  if(existing.rows?.length)return existing.rows[0].short_id;
  const candidate=freshShortId(randomInt);
  const inserted=await pool.query(`INSERT INTO lr_gold_device_short_ids(short_id,device_id)
   SELECT $1,d.device_id FROM lr_devices d
   WHERE d.device_id=$2 AND d.state<>'revoked'
   ON CONFLICT DO NOTHING RETURNING short_id`,[candidate,deviceId]);
  if(inserted.rows?.length)return inserted.rows[0].short_id;
  // A concurrent transaction may have allocated the same device, or a
  // candidate may already be reserved. Distinguish on next read, fail closed.
  const known=await pool.query('SELECT 1 FROM lr_devices WHERE device_id=$1 AND state<>\'revoked\'',[deviceId]);
  if(!known.rows?.length)throw Error('gold_short_id_device_unavailable');
 }
 throw Error('gold_short_id_collision_retry_exhausted');
}

/** Allocate stable IDs for active historical devices, in bounded chunks. */
export async function backfillGoldDeviceShortIds(pool,{batchSize=100,maxDevices=10000}={}){
 if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>500||
   !Number.isSafeInteger(maxDevices)||maxDevices<1||maxDevices>100000)
   throw Error('gold_short_id_batch_invalid');
 let created=0;
 while(created<maxDevices){
  const limit=Math.min(batchSize,maxDevices-created);
  const pending=await pool.query(`SELECT d.device_id FROM lr_devices d
   LEFT JOIN lr_gold_device_short_ids sid ON sid.device_id=d.device_id
   WHERE sid.short_id IS NULL AND d.state<>'revoked'
   ORDER BY d.device_id LIMIT $1`,[limit]);
  if(!pending.rows?.length)break;
  let assigned=0;
  for(const item of pending.rows){
   await ensureGoldDeviceShortId(pool,{deviceId:item.device_id});
   assigned++;created++;
  }
  if(assigned<limit)break;
 }
 return {created,moreMayRemain:created>=maxDevices};
}

/** Only caller-verified permitted device rows may enter this resolver.
 * An account-wide or fleet-wide raw DeviceRegistry.list() is NOT authorized. */
export function resolvePermittedDeviceTarget({permittedDevices,query,limit=5}={}){
 if(!Array.isArray(permittedDevices)||!Number.isInteger(limit)||limit<1||limit>5)
  throw Error('gold_target_scope_invalid');
 const raw=String(query||'').trim();
 if(!raw||raw.length>120||/[\u0000-\u001f\u007f]/.test(raw))
  throw Error('gold_target_query_invalid');
 const q=raw.toLocaleLowerCase('en-US');
 const ranked=[];
 const seen=new Set();
 for(const row of permittedDevices){
  if(!row||!validId(row.deviceId)||seen.has(row.deviceId))continue;
  seen.add(row.deviceId);
  const sid=String(row.shortId||'');
  const name=String(row.displayName||'');
  const node=String(row.nodeId||'');
  const platform=String(row.platform||'');
  const fields=[sid,name,node,platform].map(x=>x.toLocaleLowerCase('en-US'));
  const exact=fields.slice(0,3).some(x=>x===q);
  const partial=fields.some(x=>x.includes(q));
  if(!exact&&!partial)continue;
  // Include only safe, explicit metadata, not public key/capabilities.
  ranked.push({deviceId:row.deviceId,shortId:SHORT_ID_RE.test(sid)?sid:null,
   displayName:name.slice(0,120),platform:platform.slice(0,40),
   online:row.state==='online',rank:exact?0:1});
 }
 ranked.sort((a,b)=>a.rank-b.rank||a.displayName.localeCompare(b.displayName)||
  a.deviceId.localeCompare(b.deviceId));
 const matches=ranked.slice(0,limit).map(({rank,...d})=>d);
 return {status:ranked.length===0?'not_found':ranked.length===1?'single':'ambiguous',
  total:ranked.length,matches};
}

/** Read only owner-visible devices. Guest visible devices require separate,
 * authenticated Pro Share policy adapter; never widen this SQL for guessing. */
export async function listOwnerShortIdDevices(pool,{accountId,limit=500}={}){
 if(!pool?.query||!validId(accountId)||!Number.isInteger(limit)||limit<1||limit>500)
  throw Error('gold_target_owner_scope_invalid');
 const result=await pool.query(`SELECT d.device_id,d.node_id,d.display_name,
   d.platform,d.state,s.short_id
   FROM lr_devices d INNER JOIN lr_gold_device_short_ids s ON s.device_id=d.device_id
   WHERE d.owner_account_id=$1 AND d.state<>'revoked'
   ORDER BY d.device_id LIMIT $2`,[accountId,limit]);
 return (result.rows||[]).map(r=>({deviceId:r.device_id,nodeId:r.node_id,
  displayName:r.display_name,platform:r.platform,state:r.state,shortId:r.short_id}));
}
