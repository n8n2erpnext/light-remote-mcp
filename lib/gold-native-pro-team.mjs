/**
 * Native PostgreSQL Pro Team adapter. Preserves existing ProTeamRegistry APIs.
 * No JSON/JSONB whole-team snapshots; atomic SQL transaction per state change.
 */
const num=v=>v==null?null:Number(v);
export class GoldNativeProTeam {
 constructor({pool}){if(!pool?.connect||!pool?.query)throw Error('gold_team_postgres_required');this.pool=pool}
 static async open({pool}){
  const store=new GoldNativeProTeam({pool});
  const [teams,members,devices,grants,invites,reads,events]=await Promise.all([
   pool.query('SELECT team_id,owner_account_id,created_at FROM lr_teams'),
   pool.query('SELECT team_id,account_id FROM lr_team_members WHERE state=$1',['active']),
   pool.query('SELECT team_id,device_id FROM lr_gold_team_shared_devices'),
   pool.query('SELECT * FROM lr_gold_team_entitlements'),
   pool.query('SELECT * FROM lr_gold_team_invite_codes'),
   pool.query('SELECT * FROM lr_gold_team_notification_reads'),
   pool.query('SELECT owner_account_id,member_email,issued_ms FROM lr_gold_team_email_invite_events ORDER BY issued_ms')
  ]);
  const teamRows=teams.rows.map(r=>[r.owner_account_id,{
   ownerAccountId:r.owner_account_id,
   members:members.rows.filter(m=>m.team_id===r.team_id).map(m=>m.account_id),
   devices:devices.rows.filter(d=>d.team_id===r.team_id).map(d=>d.device_id),
   createdAt:new Date(r.created_at).getTime()
  }]);
  const grantRows=grants.rows.map(r=>[r.owner_account_id,{
   ownerAccountId:r.owner_account_id,validUntil:num(r.valid_until_ms),
   monthlyMemberCallBudget:r.monthly_member_call_budget,source:r.source
  }]);
  const inviteRows=invites.rows.map(r=>[r.code_sha256,{
   hash:r.code_sha256,ownerAccountId:r.owner_account_id,
   ...(r.member_account_id?{memberAccountId:r.member_account_id}:{}),
   ...(r.member_email?{memberEmail:r.member_email}:{}),
   ...(r.cipher?{cipher:r.cipher}:{}),
   expiresAt:num(r.expires_ms)
  }]);
  const readRows=reads.rows.map(r=>[
   r.account_id+':'+r.code_sha256,
   {accountId:r.account_id,hash:r.code_sha256,readAt:num(r.read_ms)}
  ]);
  return {store,data:{
   schemaVersion:1,teams:teamRows,invites:inviteRows,
   teamGrants:grantRows,notificationReads:readRows,
   emailInviteEvents:events.rows.map(r=>({ownerAccountId:r.owner_account_id,memberEmail:r.member_email,issuedAt:num(r.issued_ms)}))
  }};
 }
 async write(payload){
  const teams=new Map(payload.teams||[]),invites=new Map(payload.invites||[]),
    grants=new Map(payload.teamGrants||[]),reads=new Map(payload.notificationReads||[]),
    events=Array.isArray(payload.emailInviteEvents)?payload.emailInviteEvents:[];
  const client=await this.pool.connect();let begun=false;
  try{
   await client.query('BEGIN');begun=true;
   // Gold has exactly one leased writer. Replace dependent collections inside a
   // single transaction, then upsert team owners and membership.
   const owners=[...teams.keys()];
   for(const row of teams.values()){
    const owner=String(row.ownerAccountId);
    await client.query(`INSERT INTO lr_teams(team_id,owner_account_id,seat_cap,created_at)
      VALUES($1,$2,5,$3) ON CONFLICT(team_id) DO UPDATE SET owner_account_id=EXCLUDED.owner_account_id`,
      [owner,owner,new Date(row.createdAt)]);
   }
   await client.query('DELETE FROM lr_gold_team_shared_devices');
   await client.query('DELETE FROM lr_team_members');
   for(const team of teams.values()){
    for(const member of team.members||[])await client.query(
     'INSERT INTO lr_team_members(team_id,account_id,state) VALUES($1,$2,$3)',
     [team.ownerAccountId,member,'active']);
    for(const did of team.devices||[])await client.query(
     'INSERT INTO lr_gold_team_shared_devices(team_id,device_id) VALUES($1,$2)',
     [team.ownerAccountId,did]);
   }
   await client.query('DELETE FROM lr_gold_team_invite_codes');
   for(const invitation of invites.values()){
    await client.query(`INSERT INTO lr_gold_team_invite_codes
     (code_sha256,owner_account_id,member_account_id,member_email,cipher,expires_ms)
     VALUES($1,$2,$3,$4,$5,$6)`,
     [invitation.hash,invitation.ownerAccountId,invitation.memberAccountId??null,
      invitation.memberEmail??null,invitation.cipher??null,invitation.expiresAt]);
   }
   await client.query('DELETE FROM lr_gold_team_notification_reads');
   for(const row of reads.values())await client.query(
    'INSERT INTO lr_gold_team_notification_reads(account_id,code_sha256,read_ms) VALUES($1,$2,$3)',
    [row.accountId,row.hash,row.readAt]);
   await client.query('DELETE FROM lr_gold_team_entitlements');
   for(const g of grants.values())await client.query(
    'INSERT INTO lr_gold_team_entitlements(owner_account_id,valid_until_ms,monthly_member_call_budget,source) VALUES($1,$2,$3,$4)',
    [g.ownerAccountId,g.validUntil,g.monthlyMemberCallBudget,g.source]);
   await client.query('DELETE FROM lr_gold_team_email_invite_events');
   for(const e of events)await client.query(
    'INSERT INTO lr_gold_team_email_invite_events(owner_account_id,member_email,issued_ms) VALUES($1,$2,$3)',
    [e.ownerAccountId,e.memberEmail,e.issuedAt]);
   if(owners.length)await client.query('DELETE FROM lr_teams WHERE NOT(team_id=ANY($1::text[]))',[owners]);
   else await client.query('DELETE FROM lr_teams');
   await client.query('COMMIT');begun=false;
  }catch(error){if(begun)await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 }
}
