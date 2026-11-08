#!/usr/bin/env python3
"""rc50 synthetic issuer provenance transaction; isolated PostgreSQL Compose only.
No real Local Wall, key issuance, privileges, account data or production DB.
Run with --confirm-synthetic-only to allocate one temporary Docker project.
"""
from pathlib import Path
import os,sys,re,tempfile
from concurrent.futures import ThreadPoolExecutor
import rehearse_cold_move_uat as u

ROOT=Path(__file__).resolve().parents[1]
SQL=(ROOT/'portability/issuer_origin_uat.sql').read_bytes()
def must(condition,what):
    if not condition:raise AssertionError('issuer_uat_'+what)
def fails(pg,query,reason):
    try:u.sql(pg,query)
    except RuntimeError as exc:
        must(reason in str(exc),'wrong_refusal_'+reason)
        return
    raise AssertionError('issuer_uat_expected_refusal_'+reason)
def verify(pg,device_key_sha256='b'*64):
    must(re.fullmatch(r'[a-f0-9]{64}',device_key_sha256) is not None,'fake_device_sha_invalid')
    prefix='issuerfixture_'+u.BASE.replace('-','_')
    owner=prefix+'_owner'
    member=prefix+'_member'
    device=prefix+'_device'
    conn=prefix+'_conn'
    sess=prefix+'_session'
    req1=prefix+'_request_one'
    grant1=prefix+'_grant_one'
    req2=prefix+'_request_two'
    grant2=prefix+'_grant_two'
    sql=u.sql
    fixture=f"""
BEGIN;
INSERT INTO lr_accounts(account_id,email)
 VALUES('{owner}','owner-{u.BASE}@example.invalid'),
       ('{member}','member-{u.BASE}@example.invalid');
INSERT INTO lr_sessions(session_id,account_id,token_sha256,created_at,expires_at)
 VALUES('{sess}','{owner}',repeat('a',64),
   now()-interval '3 minutes',now()+interval '1 hour');
INSERT INTO lr_devices(device_id,owner_account_id,state)
 VALUES('{device}','{owner}','online');
INSERT INTO lr_device_connections(connection_id,device_id,account_id,plan,
  connected_at,hard_expires_at,reconnect_grace_ms)
 VALUES('{conn}','{device}','{owner}','free',
   now()-interval '3 minutes',now()+interval '3 hours',1800000);
INSERT INTO lr_uat_device_enrolled_key(device_id,public_key_sha256,state)
 VALUES('{device}','{device_key_sha256}','active');
INSERT INTO lr_uat_device_authority_floor(device_id) VALUES('{device}');
INSERT INTO lr_ab_requests(request_id,account_id,device_id,connection_id,
  agent_id,purpose,poll_sha256,state,created_at,expires_at)
 VALUES('{req1}','{owner}','{device}','{conn}',
   '{prefix}_agent','device',repeat('c',64),'pending',
   now()-interval '2 minutes',now()+interval '6 minutes');
INSERT INTO lr_uat_owner_approval_evidence(request_id,owner_account_id,
  owner_session_id,approved_at,opaque_evidence_sha256)
 VALUES('{req1}','{owner}','{sess}',
   now()-interval '30 seconds',repeat('d',64));
COMMIT;"""
    sql(pg,fixture)
    print('PASS 01 isolated grant provenance fixtures seeded, no signing keys')
    fails(pg,f"SELECT lr_uat_issue_direct_owner_grant('{req1}','{grant1}')",
          'uat_request_not_freshly_approved')
    must(sql(pg,"SELECT count(*) FROM lr_uat_lease_signing_outbox")=='0',
         'pending_created_outbox')
    print('PASS 02 pending owner request cannot mint a grant')
    sql(pg,f"UPDATE lr_ab_requests SET state='approved' WHERE request_id='{req1}'")
    sql(pg,f"UPDATE lr_uat_owner_approval_evidence SET owner_account_id='{member}' WHERE request_id='{req1}'")
    fails(pg,f"SELECT lr_uat_issue_direct_owner_grant('{req1}','{grant1}')",
          'uat_owner_device_binding_failed')
    sql(pg,f"UPDATE lr_uat_owner_approval_evidence SET owner_account_id='{owner}' WHERE request_id='{req1}'")
    print('PASS 03 fake approval evidence must match device owner')
    sql(pg,f"UPDATE lr_sessions SET revoked_at=now() WHERE session_id='{sess}'")
    fails(pg,f"SELECT lr_uat_issue_direct_owner_grant('{req1}','{grant1}')",
          'uat_approval_or_connection_expired')
    sql(pg,f"UPDATE lr_sessions SET revoked_at=NULL WHERE session_id='{sess}'")
    print('PASS 04 revoked owner session fails closed')
    sql(pg,f"UPDATE lr_uat_device_enrolled_key SET state='revoked' WHERE device_id='{device}'")
    fails(pg,f"SELECT lr_uat_issue_direct_owner_grant('{req1}','{grant1}')",
          'uat_owner_device_binding_failed')
    sql(pg,f"UPDATE lr_uat_device_enrolled_key SET state='active' WHERE device_id='{device}'")
    print('PASS 05 revoked device enrollment blocks issuance')
    result=sql(pg,f"SELECT lr_uat_issue_direct_owner_grant('{req1}','{grant1}')")
    must(result=='ORIGIN_COMMITTED_SIGNING_PENDING','valid_origin_not_issued')
    summary=sql(pg,f"""SELECT p.generation||':'||p.grant_revision||':'||
        o.status||':'||r.state||':'||(r.consumed_at IS NOT NULL)::text
      FROM lr_uat_grant_provenance p
      JOIN lr_uat_lease_signing_outbox o USING(request_id)
      JOIN lr_ab_requests r USING(request_id)
      WHERE p.request_id='{req1}'""")
    must(summary=='1:1:pending:approved:true','origin_generation_provenance_mismatch')
    print('PASS 06 atomic grant + generation + consumed approval + sign-pending outbox')
    fails(pg,f"SELECT lr_uat_issue_direct_owner_grant('{req1}','{grant1}')",
          'uat_request_not_freshly_approved')
    must(sql(pg,'SELECT count(*) FROM lr_uat_lease_signing_outbox')=='1',
         'duplicate_signing_outbox')
    must(sql(pg,f"SELECT generation::text FROM lr_uat_device_authority_floor WHERE device_id='{device}'")=='1',
         'duplicate_epoch_increment')
    print('PASS 07 replayed request cannot double-mint grants or writer epoch')
    fixture2=f"""
BEGIN;
INSERT INTO lr_ab_requests(request_id,account_id,device_id,connection_id,
  agent_id,purpose,poll_sha256,state,created_at,expires_at)
 VALUES('{req2}','{owner}','{device}','{conn}','{prefix}_agent',
  'device',repeat('e',64),'approved',now()-interval '2 minutes',
  now()+interval '6 minutes');
INSERT INTO lr_uat_owner_approval_evidence(request_id,owner_account_id,
  owner_session_id,approved_at,opaque_evidence_sha256)
 VALUES('{req2}','{owner}','{sess}',now()-interval '25 seconds',repeat('f',64));
COMMIT;"""
    sql(pg,fixture2)
    fails(pg,f"SELECT lr_uat_issue_direct_owner_grant('{req2}','{grant1}')",
          'uat_issuer_duplicate_request_or_grant')
    must(sql(pg,f"SELECT generation::text FROM lr_uat_device_authority_floor WHERE device_id='{device}'")=='1',
         'epoch_incremented_after_rollback')
    print('PASS 08 already-used grant ID rolls transaction back without epoch change')
    must(sql(pg,f"SELECT lr_uat_issue_direct_owner_grant('{req2}','{grant2}')")==
         'ORIGIN_COMMITTED_SIGNING_PENDING','second_valid_origin_not_issued')
    must(sql(pg,f"SELECT generation||':'||grant_revision FROM lr_uat_device_authority_floor WHERE device_id='{device}'")=='2:2',
         'failed_epoch_monotonicity')
    must(sql(pg,"SELECT count(*) FROM lr_uat_lease_signing_outbox")=='2',
         'second_outbox_missing')
    print('PASS 09 new approved request receives monotonic generation/revision')
    must(sql(pg,"SELECT count(*) FROM lr_uat_lease_signing_outbox WHERE status='signed'")=='0',
         'fixture_falsely_asserted_cryptographic_issuance')
    print('PASS 10 issued provenance remains pending until separate signed publisher')
    # Two distinct approved requests for the SAME device are issued on two
    # separate PostgreSQL client connections. The authority-floor UPDATE
    # serializes generation and revision even when both issuers race.
    req3=prefix+'_request_concurrent_a'
    req4=prefix+'_request_concurrent_b'
    grant3=prefix+'_grant_concurrent_a'
    grant4=prefix+'_grant_concurrent_b'
    sql(pg,f"""
BEGIN;
INSERT INTO lr_ab_requests(request_id,account_id,device_id,connection_id,
  agent_id,purpose,poll_sha256,state,created_at,expires_at)
 VALUES('{req3}','{owner}','{device}','{conn}','{prefix}_agent',
  'device',repeat('1',64),'approved',now()-interval '2 minutes',
  now()+interval '6 minutes'),
 ('{req4}','{owner}','{device}','{conn}','{prefix}_agent',
  'device',repeat('2',64),'approved',now()-interval '2 minutes',
  now()+interval '6 minutes');
INSERT INTO lr_uat_owner_approval_evidence(request_id,owner_account_id,
  owner_session_id,approved_at,opaque_evidence_sha256)
 VALUES('{req3}','{owner}','{sess}',now()-interval '25 seconds',repeat('3',64)),
  ('{req4}','{owner}','{sess}',now()-interval '20 seconds',repeat('4',64));
COMMIT;""")
    with ThreadPoolExecutor(max_workers=2) as pool:
        a=pool.submit(sql,pg,f"SELECT lr_uat_issue_direct_owner_grant('{req3}','{grant3}')")
        b=pool.submit(sql,pg,f"SELECT lr_uat_issue_direct_owner_grant('{req4}','{grant4}')")
        must(a.result()=='ORIGIN_COMMITTED_SIGNING_PENDING' and
             b.result()=='ORIGIN_COMMITTED_SIGNING_PENDING',
             'concurrent_origin_mint_rejected')
    floors=sql(pg,f"""SELECT string_agg(generation::text,',' ORDER BY generation)
      FROM lr_uat_grant_provenance WHERE device_id='{device}'""")
    must(floors=='1,2,3,4','concurrent_generation_collision')
    must(sql(pg,f"""SELECT generation||':'||grant_revision
      FROM lr_uat_device_authority_floor WHERE device_id='{device}'""")=='4:4',
      'concurrent_floor_nonmonotonic')
    print('PASS 11 competing issuer connections receive unique generation 3 and 4')
    must(sql(pg,"SELECT count(*) FROM lr_uat_lease_signing_outbox")=='4',
       'concurrent_outbox_count')
    must(sql(pg,"SELECT count(*) FROM lr_uat_lease_signing_outbox WHERE status='signed'")=='0',
       'synthetic_issuer_signed_without_publisher')
    print('PASS 12 concurrency preserves four pending outbox rows; none signed')

def main():
    if sys.argv[1:]!=['--confirm-synthetic-only']:
        raise SystemExit('Refusing to run without --confirm-synthetic-only')
    must(u.BASE.startswith('lr-uat-move-') and re.fullmatch(r'lr-uat-move-[0-9a-f]{10}',u.BASE),
         'non_synthetic_project')
    project=u.BASE+'-src'
    started=False
    with tempfile.TemporaryDirectory(prefix='lr_rc50_issuer_pg_',dir=Path.home()) as temp:
        pg_env,redis_conf=u.prepare_configs(Path(temp)/'src','src')
        env=u.environment(pg_env,redis_conf)
        try:
            u.compose(project,env,'up','-d','--pull','never','postgres')
            started=True
            cid=u.cid(project,env,'postgres')
            u.healthy(cid)
            u.check_isolation(cid)
            u.migrations(cid)
            u.docker('exec','-i',cid,'psql','-X','-v','ON_ERROR_STOP=1',
                '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',data=SQL)
            verify(cid)
            print('RC50_ISSUER_ORIGIN_PG_SYNTHETIC_UAT_PASS signing_status=pending production=false')
        finally:
            if started:
                u.compose(project,env,'down','--volumes','--remove-orphans',timeout=90)
                print('RC50_ISSUER_ORIGIN_ISOLATED_PROJECT_CLEANED')

if __name__=='__main__':
    main()
