/** Canonical SQL License Keys. Existing LicenseKeyRegistry keeps its APIs. */
const n=v=>v==null?null:Number(v);
export class GoldNativeLicense{
 constructor({pool}){if(!pool?.connect||!pool?.query)throw Error('gold_license_postgres_required');this.pool=pool}
 static async open({pool}){
  const store=new GoldNativeLicense({pool});
  const [keys,redemptions]=await Promise.all([
   pool.query('SELECT * FROM lr_gold_license_keys ORDER BY issued_ms DESC'),
   pool.query('SELECT license_id,account_id,redeemed_ms FROM lr_gold_license_redemptions')
  ]);
  return {store,rows:keys.rows.map(r=>[r.license_id,{
   licenseId:r.license_id,keyHash:r.key_sha256,last4:r.last4,plan:r.plan,
   durationMs:n(r.duration_ms),maxRedemptions:r.max_redemptions,
   issuedAt:n(r.issued_ms),expiresAt:n(r.expires_ms),revokedAt:n(r.revoked_ms),
   revokeReason:r.revoke_reason,label:r.label,
   redemptions:redemptions.rows.filter(x=>x.license_id===r.license_id).map(x=>({
    accountId:x.account_id,redeemedAt:n(x.redeemed_ms)
   }))
  }])};
 }
 async write(rows){
  const client=await this.pool.connect();let begun=false;
  try{
   await client.query('BEGIN');begun=true;
   for(const row of rows.values()){
    await client.query(`INSERT INTO lr_gold_license_keys
     (license_id,key_sha256,last4,plan,duration_ms,max_redemptions,issued_ms,expires_ms,revoked_ms,revoke_reason,label)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT(license_id) DO UPDATE SET
     key_sha256=EXCLUDED.key_sha256,last4=EXCLUDED.last4,plan=EXCLUDED.plan,
     duration_ms=EXCLUDED.duration_ms,max_redemptions=EXCLUDED.max_redemptions,
     issued_ms=EXCLUDED.issued_ms,expires_ms=EXCLUDED.expires_ms,revoked_ms=EXCLUDED.revoked_ms,
     revoke_reason=EXCLUDED.revoke_reason,label=EXCLUDED.label`,
     [row.licenseId,row.keyHash,row.last4,row.plan,row.durationMs,row.maxRedemptions,
      row.issuedAt,row.expiresAt??null,row.revokedAt??null,row.revokeReason??null,row.label||'']);
   }
   const ids=[...rows.keys()];
   if(ids.length)await client.query('DELETE FROM lr_gold_license_keys WHERE NOT(license_id=ANY($1::text[]))',[ids]);
   else await client.query('DELETE FROM lr_gold_license_keys');
   await client.query('DELETE FROM lr_gold_license_redemptions');
   for(const row of rows.values())for(const redeemed of row.redemptions||[]){
    await client.query('INSERT INTO lr_gold_license_redemptions(license_id,account_id,redeemed_ms) VALUES($1,$2,$3)',
     [row.licenseId,redeemed.accountId,redeemed.redeemedAt]);
   }
   await client.query('COMMIT');begun=false;
  }catch(error){if(begun)await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 }
}
