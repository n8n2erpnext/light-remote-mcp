/** Gold native Enrollment state on typed PostgreSQL columns. */
const N=v=>v==null?null:Number(v);
const PENDING_FIELDS=[
 ['enrollment_id','enrollmentId'],['state','state'],['created_ms','createdAt'],
 ['expires_ms','expiresAt'],['poll_token_sha256','pollTokenHash'],['code_salt','codeSalt'],
 ['code_sha256','codeHash'],['public_key_sha256','publicKeySha256'],
 ['public_identity_key','publicIdentityKey'],['requested_capabilities','requestedCapabilities'],
 ['requested_policy','requestedPolicy'],['display_name','displayName'],['platform','platform'],
 ['architecture','architecture'],['agent_version','agentVersion'],
 ['fingerprint_summary','fingerprintSummary'],['source_hash','sourceHash'],
 ['approved_ms','approvedAt'],['device_id','deviceId'],['account_id','accountId'],
 ['certificate_id','certificateId'],['expired_ms','expiredAt'],['replaced_ms','replacedAt']
];
const BINDING_FIELDS=[
 ['device_id','deviceId'],['account_id','accountId'],
 ['public_key_sha256','publicKeySha256'],['public_identity_key','publicIdentityKey'],
 ['grantable_capabilities','grantableCapabilities'],['approved_capabilities','approvedCapabilities'],
 ['policy_profile','policyProfile'],['policy_revision','policyRevision'],
 ['policy_updated_ms','policyUpdatedAt'],['display_name','displayName'],
 ['platform','platform'],['architecture','architecture'],
 ['agent_version','agentVersion'],['fingerprint_summary','fingerprintSummary'],
 ['certificate_id','certificateId'],['issued_ms','issuedAt'],
 ['not_after_ms','notAfter'],['certificate_signature','certificateSignature'],
 ['revoked_ms','revokedAt'],['revoke_reason','revokeReason']
];
const SQL=(table,fields,pk)=>`INSERT INTO ${table}(${fields.map(x=>x[0]).join(',')})
 VALUES(${fields.map((_,i)=>'$'+(i+1)).join(',')})
 ON CONFLICT(${pk}) DO UPDATE SET ${fields.filter(x=>x[0]!==pk).map(x=>x[0]+'=EXCLUDED.'+x[0]).join(',')}`;
function decoded(r,fields){
 const obj={};
 for(const [col,key] of fields){
  const val=r[col];
  obj[key]=col.endsWith('_ms')&&val!=null?N(val):val;
 }
 return obj;
}
const values=(row,fields)=>fields.map(([,k])=>row[k]??null);
function restoredCertificate(b){
 b.certificate={
  version:1,certificateId:b.certificateId,deviceId:b.deviceId,
  accountId:b.accountId,publicKeySha256:b.publicKeySha256,
  publicIdentityKey:b.publicIdentityKey,
  approvedCapabilities:[...(b.approvedCapabilities||[])],
  policyProfile:b.policyProfile,issuedAt:b.issuedAt,notAfter:b.notAfter
 };
 return b;
}
export class GoldNativeEnrollment {
 constructor({pool}){if(!pool?.connect||!pool?.query)throw Error('gold_enrollment_pg_required');this.pool=pool}
 static async open({pool}){
  const store=new GoldNativeEnrollment({pool});
  const [pending,bindings]=await Promise.all([
   pool.query('SELECT * FROM lr_gold_enrollment_pending'),
   pool.query('SELECT * FROM lr_gold_enrollment_bindings')
  ]);
  return {store,data:{
   schemaVersion:1,
   pending:pending.rows.map(r=>[r.enrollment_id,decoded(r,PENDING_FIELDS)]),
   bindings:bindings.rows.map(r=>[r.device_id,restoredCertificate(decoded(r,BINDING_FIELDS))])
  }};
 }
 async write({pending=[],bindings=[]}={}){
  const client=await this.pool.connect();let begun=false;
  try{
   await client.query('BEGIN');begun=true;
   for(const [,r]of pending)await client.query(
    SQL('lr_gold_enrollment_pending',PENDING_FIELDS,'enrollment_id'),
    values(r,PENDING_FIELDS));
   for(const [,r]of bindings)await client.query(
    SQL('lr_gold_enrollment_bindings',BINDING_FIELDS,'device_id'),
    values(r,BINDING_FIELDS));
   await client.query('DELETE FROM lr_gold_enrollment_pending WHERE NOT(enrollment_id=ANY($1::text[]))',[pending.map(x=>x[0])]);
   await client.query('DELETE FROM lr_gold_enrollment_bindings WHERE NOT(device_id=ANY($1::text[]))',[bindings.map(x=>x[0])]);
   await client.query('COMMIT');begun=false;
  }catch(error){if(begun)await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 }
}
