/**
 * rc50 synthetic UAT only. PostgreSQL-backed authoritative identity/challenge
 * store, NOT an account-facing service and not connected to production.
 * Requires a dedicated verifier role with strictly scoped DB privileges.
 * No role is provisioned by this module.
 */
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const HASH=/^[0-9a-f]{64}$/;
function check(ok,code){if(!ok)throw new Error(code);}
export class PgRotationStoreUat{
  #ready=false;
  constructor({pool,allowUat=false}={}){
    check(allowUat===true,'rotation_pg_uat_only');
    check(typeof pool?.query==='function','rotation_pg_pool_required');
    this.pool=pool;
  }
  async verifyTarget(){
    this.#ready=false;
    const {rows}=await this.pool.query(
      "SELECT current_database() AS database,current_user AS role,"+
      "(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser");
    const row=rows?.[0];
    check(row?.database==='light_remote_rc50_uat'&&
      row?.role==='lr_rc50_rotation_verifier'&&row?.superuser===false,
      'rotation_unapproved_db_identity');
    this.#ready=true;
    return row;
  }
  #requireReady(){check(this.#ready,'rotation_pg_not_initialized');}
  async getIdentity(deviceId){
    this.#requireReady();
    check(ID.test(String(deviceId||'')),'invalid_rotation_device');
    const {rows}=await this.pool.query(
      `SELECT d.device_id AS "deviceId",d.owner_account_id AS "ownerAccountId",
          d.state,k.public_spki_base64 AS "publicKeySpki",
          f.family_id AS "familyId"
         FROM lr_devices d JOIN lr_device_identity_keys_uat k ON k.device_id=d.device_id
         LEFT JOIN lr_free_family_devices f ON f.device_id=d.device_id
         WHERE d.device_id=$1`,[deviceId]);
    return rows?.[0]||null;
  }
  async insertChallenge(c){
    this.#requireReady();
    for(const id of [c.challengeId,c.oldDeviceId,c.newDeviceId,
      c.oldOwnerAccountId,c.newOwnerAccountId,c.sourceFamilyId])check(ID.test(String(id||'')),'invalid_rotation_record');
    for(const key of [c.oldKeySha256,c.newKeySha256,c.nonceSha256])
      check(HASH.test(String(key||'')),'invalid_rotation_hash');
    check(Number.isSafeInteger(c.issuedAtMs)&&Number.isSafeInteger(c.expiresAtMs)
      &&c.expiresAtMs>c.issuedAtMs&&c.expiresAtMs-c.issuedAtMs<=300000,
      'invalid_rotation_ttl');
    await this.pool.query(`INSERT INTO lr_free_rotation_challenges(
      challenge_id,old_device_id,new_device_id,old_owner_account_id,new_owner_account_id,
      source_family_id,old_key_sha256,new_key_sha256,nonce_sha256,issued_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10::double precision/1000),
        to_timestamp($11::double precision/1000))`,
      [c.challengeId,c.oldDeviceId,c.newDeviceId,c.oldOwnerAccountId,c.newOwnerAccountId,
       c.sourceFamilyId,c.oldKeySha256,c.newKeySha256,c.nonceSha256,c.issuedAtMs,c.expiresAtMs]);
  }
  async getChallenge(challengeId){
    this.#requireReady();
    check(ID.test(String(challengeId||'')),'invalid_rotation_challenge');
    const {rows}=await this.pool.query(`SELECT
      challenge_id AS "challengeId",old_device_id AS "oldDeviceId",
      new_device_id AS "newDeviceId",old_owner_account_id AS "oldOwnerAccountId",
      new_owner_account_id AS "newOwnerAccountId",source_family_id AS "sourceFamilyId",
      old_key_sha256 AS "oldKeySha256",
      new_key_sha256 AS "newKeySha256",nonce_sha256 AS "nonceSha256",
      (extract(epoch from issued_at)*1000)::bigint AS "issuedAtMs",
      (extract(epoch from expires_at)*1000)::bigint AS "expiresAtMs",
      CASE WHEN consumed_at IS NULL THEN NULL ELSE
       (extract(epoch from consumed_at)*1000)::bigint END AS "consumedAtMs"
      FROM lr_free_rotation_challenges WHERE challenge_id=$1`,[challengeId]);
    const row=rows?.[0];if(!row)return null;
    return {...row,issuedAtMs:Number(row.issuedAtMs),expiresAtMs:Number(row.expiresAtMs),
      consumedAtMs:row.consumedAtMs===null?null:Number(row.consumedAtMs)};
  }
  async finalizeChallenge(c){
    this.#requireReady();
    check(ID.test(String(c?.challengeId||'')),'invalid_rotation_challenge');
    for(const key of [c.nonceSha256,c.oldKeySha256,c.newKeySha256])
      check(HASH.test(String(key||'')),'invalid_rotation_hash');
    const {rows}=await this.pool.query(
      'SELECT lr_finalize_free_rotation_uat($1,$2,$3,$4) AS linked',
      [c.challengeId,c.nonceSha256,c.oldKeySha256,c.newKeySha256]);
    check(typeof rows?.[0]?.linked==='boolean','invalid_rotation_db_result');
    return rows[0].linked;
  }
}
