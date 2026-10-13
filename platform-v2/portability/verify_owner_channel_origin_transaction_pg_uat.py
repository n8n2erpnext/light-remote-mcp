#!/usr/bin/env python3
"""Isolated fake Ed25519 Wall+channel -> PostgreSQL atomic grant/nonce UAT.
NOT an authenticated real-owner issuer; signed packets verified in Node mock.
Run ONLY with --confirm-synthetic-only; disposable random PG Compose project.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json,os,re,subprocess,sys,tempfile
import verify_issuer_origin_pg_uat as origin

u=origin.u
ROOT=Path(__file__).resolve().parents[1]
PROOF_SQL=(ROOT/'portability/owner_channel_origin_transaction_uat.sql').read_bytes()
ACL_SQL=(ROOT/'portability/owner_channel_origin_verifier_acl_uat.sql').read_bytes()
BRIDGE=ROOT/'portability/synthetic-owner-channel-db-proof.mjs'
def must(ok,why):
 if not ok:raise AssertionError('owner_channel_pg_'+why)
def q(value):
 txt=str(value)
 must(re.fullmatch(r'[A-Za-z0-9_.:@+\-T]+',txt) is not None,'unsafe_fixture_sql_value')
 return "'"+txt+"'"
def fails(pg,statement,reason):
 try:u.sql(pg,statement)
 except RuntimeError as e:
  must(reason in str(e),'wrong_denial_'+reason)
  return
 raise AssertionError('expected_denial_'+reason)
def sign_fake_batch(rows):
 env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),
      'HOME':os.environ.get('HOME','/tmp'),'LR_RC50_UAT_ONLY':'1'}
 p=subprocess.run(['node',str(BRIDGE),'--synthetic-only'],
     input=json.dumps({'batch':rows}),capture_output=True,text=True,
     env=env,timeout=12)
 must(p.returncode==0 and p.stdout.strip(),'fake_signing_chain_refused')
 proofs=json.loads(p.stdout)
 must(isinstance(proofs,list) and len(proofs)==len(rows),
     'incorrect_fake_chain_batch')
 for item in proofs:
  must(item['productionIssuerAuthorized'] is False and
       item['physicalExecutionAuthorized'] is False and
       all(re.fullmatch(r'[a-f0-9]{64}',item[x]) for x in
           ('wallVerifierSha256','channelVerifierSha256','nonceSha256',
            'wallProofSha256','channelAckSha256')),
       'invalid_fake_attestation')
 must(len({x['nonceSha256'] for x in proofs})==len(proofs),
      'duplicate_generated_nonce')
 must(len({x['wallVerifierSha256'] for x in proofs})==1 and
      len({x['channelVerifierSha256'] for x in proofs})==1,
      'unexpected_signer_key_rotation')
 return proofs
def commit(proof,**overrides):
 p={**proof,**overrides}
 return f"""SELECT lr_uat_commit_owner_channel_origin(
 {q(p['requestId'])},{q(p['grantId'])},
 {q(p['ownerSessionId'])},{q(p['ownerAccountId'])},
 {q(p['deviceId'])},{q(p['connectionId'])},
 {q(p['agentId'])},{q(p['enrolledKeySha256'])},
 {q(p['wallVerifierSha256'])},{q(p['channelVerifierSha256'])},
 {q(p['nonceSha256'])},{q(p['wallProofSha256'])},
 {q(p['channelAckSha256'])},
 {q(p['requestCreatedAt'])}::timestamptz,
 {q(p['requestExpiresAt'])}::timestamptz,
 {q(p['approvedAt'])}::timestamptz,
 {q(p['channelApprovedAt'])}::timestamptz)"""
def verify(pg,hardened_acl=False):
 def authorized(proof,**overrides):
  query=commit(proof,**overrides)
  return ('SET ROLE lr_uat_origin_verifier; '+query) if hardened_acl else query
 def issue(proof,**overrides):
  result=u.sql(pg,authorized(proof,**overrides))
  return result.splitlines()[-1]
 prefix='uat_wall_'+u.BASE.replace('-','_')
 owner=prefix+'_owner';member=prefix+'_member'
 device=prefix+'_device';conn=prefix+'_conn'
 sess=prefix+'_session';agent=prefix+'_agent'
 ids=[]
 for i in ('one','two','race'):
  ids.append({
    'requestId':prefix+'_req_'+i,'grantId':prefix+'_grant_'+i,
    'accountId':owner,'deviceId':device,'connectionId':conn,
    'agentId':agent,'ownerSessionId':sess,'deviceKeySha256':'a'*64
  })
 sql=u.sql
 sql(pg,f"""
 BEGIN;
 INSERT INTO lr_accounts(account_id,email)
 VALUES({q(owner)},{q('owner-'+u.BASE+'@example.invalid')}),
       ({q(member)},{q('member-'+u.BASE+'@example.invalid')});
 INSERT INTO lr_sessions(session_id,account_id,token_sha256,created_at,expires_at)
 VALUES({q(sess)},{q(owner)},repeat('a',64),
 now()-interval '3 minutes',now()+interval '1 hour');
 INSERT INTO lr_devices(device_id,owner_account_id,state)
 VALUES({q(device)},{q(owner)},'online');
 INSERT INTO lr_device_connections(
 connection_id,device_id,account_id,plan,connected_at,hard_expires_at,
 reconnect_grace_ms)
 VALUES({q(conn)},{q(device)},{q(owner)},'free',
 now()-interval '3 minutes',now()+interval '3 hours',1800000);
 INSERT INTO lr_uat_device_enrolled_key(device_id,public_key_sha256,state)
 VALUES({q(device)},repeat('a',64),'active');
 INSERT INTO lr_uat_device_authority_floor(device_id) VALUES({q(device)});
 INSERT INTO lr_ab_requests(request_id,account_id,device_id,connection_id,
 agent_id,purpose,poll_sha256,state,created_at,expires_at)
 VALUES
 ({q(ids[0]['requestId'])},{q(owner)},{q(device)},{q(conn)},
  {q(agent)},'device',repeat('1',64),'pending',
  date_trunc('milliseconds',now())-interval '1 minute',
  date_trunc('milliseconds',now())+interval '5 minutes'),
 ({q(ids[1]['requestId'])},{q(owner)},{q(device)},{q(conn)},
  {q(agent)},'device',repeat('2',64),'pending',
  date_trunc('milliseconds',now())-interval '1 minute',
  date_trunc('milliseconds',now())+interval '5 minutes'),
 ({q(ids[2]['requestId'])},{q(owner)},{q(device)},{q(conn)},
  {q(agent)},'device',repeat('3',64),'pending',
  date_trunc('milliseconds',now())-interval '1 minute',
  date_trunc('milliseconds',now())+interval '5 minutes');
 COMMIT;""")
 print('ORIGIN PASS 01 three pending requests seeded from database ownership/session')
 fails(pg,f"SELECT lr_uat_issue_direct_owner_grant({q(ids[0]['requestId'])},{q(ids[0]['grantId'])})",
       'uat_no_verified_approval_chain')
 print('ORIGIN PASS 02 raw pending request cannot call legacy issuer without evidence')
 for item in ids:
  span=sql(pg,f"""SELECT
    (extract(epoch FROM created_at)*1000)::BIGINT::text||'|'||
    (extract(epoch FROM expires_at)*1000)::BIGINT::text
    FROM lr_ab_requests WHERE request_id={q(item['requestId'])}""")
  created,expires=span.split('|')
  item['requestCreatedAtMs']=int(created)
  item['requestExpiresAtMs']=int(expires)
 proofs=sign_fake_batch(ids)
 sql(pg,f"""INSERT INTO lr_uat_trusted_origin_verifier_pins(
   device_id,wall_verifier_sha256,channel_verifier_sha256,state)
 VALUES({q(device)},{q(proofs[0]['wallVerifierSha256'])},
 {q(proofs[0]['channelVerifierSha256'])},'active')""")
 print('ORIGIN PASS 03 three independently Ed25519-verified synthetic Wall/channel packet pairs; pinned keys match')
 if hardened_acl:
  u.docker('exec','-i',pg,'psql','-X','-v','ON_ERROR_STOP=1',
       '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',data=ACL_SQL)
  print('ACL setup: scratch NOLOGIN verifier and SECDEF origin writer')
  privilege=sql(pg,"""SELECT
     has_function_privilege('lr_uat_origin_verifier',
      p.oid,'EXECUTE')::text
    FROM pg_proc p WHERE p.proname='lr_uat_commit_owner_channel_origin'""")
  must(privilege=='true','verifier_wrapper_exec_absent')
  privilege=sql(pg,"""SELECT
    has_function_privilege('lr_uat_origin_untrusted',
      p.oid,'EXECUTE')::text
    FROM pg_proc p WHERE p.proname='lr_uat_commit_owner_channel_origin'""")
  must(privilege=='false','untrusted_wrapper_exposed')
  privilege=sql(pg,"""SELECT
    has_function_privilege('lr_uat_origin_verifier',
      'public.lr_uat_issue_direct_owner_grant(text,text)',
      'EXECUTE')::text""")
  must(privilege=='false','legacy_issuer_exec_exposed')
  for role in ('lr_uat_origin_function_owner','lr_uat_origin_verifier',
               'lr_uat_origin_untrusted'):
   must(sql(pg,f"SELECT rolcanlogin::text FROM pg_roles WHERE rolname='{role}'")
       =='false','unexpected_login_role')
  print('ACL PASS 01 NOLOGIN principals: only verifier may execute protected origin wrapper')
  fails(pg,"SET ROLE lr_uat_origin_verifier; SELECT lr_uat_issue_direct_owner_grant('x','y')",
        'permission denied for function')
  fails(pg,"SET ROLE lr_uat_origin_untrusted; SELECT lr_uat_issue_direct_owner_grant('x','y')",
        'permission denied for function')
  fails(pg,"SET ROLE lr_uat_origin_verifier; SELECT * FROM lr_uat_trusted_origin_verifier_pins",
        'permission denied for table')
  fails(pg,"SET ROLE lr_uat_origin_verifier; UPDATE lr_uat_trusted_origin_verifier_pins SET state='revoked'",
        'permission denied for table')
  print('ACL PASS 02 legacy issuer and trusted-pins table cannot be accessed directly')
  fails(pg,"SET ROLE lr_uat_origin_untrusted; "+commit(proofs[0]),
        'permission denied for function')
  fails(pg,"SET ROLE lr_uat_origin_verifier; UPDATE lr_uat_device_authority_floor SET generation=90",
        'permission denied for table')
  fails(pg,"SET ROLE lr_uat_origin_untrusted; CREATE TABLE public.lr_uat_bad_actor(dummy int)",
        'permission denied for schema')
  print('ACL PASS 03 untrusted cannot invoke origin or create schema objects; verifier cannot move epoch')
 p=proofs[0]
 fails(pg,authorized(p,ownerAccountId=member),
       'uat_owner_channel_identity_or_key_mismatch')
 fails(pg,authorized(p,channelVerifierSha256='e'*64),
       'uat_owner_channel_identity_or_key_mismatch')
 fails(pg,authorized(p,deviceId=prefix+'_device_wrong'),
       'uat_owner_channel_identity_or_key_mismatch')
 must(sql(pg,'SELECT count(*) FROM lr_uat_signed_owner_channel_ledger')=='0',
      'unauthorized_evidence_persisted')
 print('ORIGIN PASS 04 wrong owner, device or channel key cannot create evidence')
 sql(pg,f"UPDATE lr_sessions SET revoked_at=now() WHERE session_id={q(sess)}")
 fails(pg,authorized(p),'uat_owner_channel_time_or_session_invalid')
 sql(pg,f"UPDATE lr_sessions SET revoked_at=NULL WHERE session_id={q(sess)}")
 sql(pg,f"UPDATE lr_uat_device_enrolled_key SET state='revoked' WHERE device_id={q(device)}")
 fails(pg,authorized(p),'uat_owner_channel_identity_or_key_mismatch')
 sql(pg,f"UPDATE lr_uat_device_enrolled_key SET state='active' WHERE device_id={q(device)}")
 print('ORIGIN PASS 05 revoked owner session or device enrollment blocks grant')
 sql(pg,f"UPDATE lr_uat_trusted_origin_verifier_pins SET state='revoked' WHERE device_id={q(device)}")
 fails(pg,authorized(p),'uat_owner_channel_identity_or_key_mismatch')
 sql(pg,f"UPDATE lr_uat_trusted_origin_verifier_pins SET state='active' WHERE device_id={q(device)}")
 print('ORIGIN PASS 06 revoked Wall/channel verifier trust anchor blocks grant')
 # Separate signed channel may not occur after Wall owner consent.
 fails(pg,authorized(p,channelApprovedAt='2999-01-01T00:00:00Z'),
       'uat_owner_channel_time_or_session_invalid')
 must(sql(pg,'SELECT count(*) FROM lr_uat_lease_signing_outbox')=='0',
      'bad_temporal_proof_granted')
 print('ORIGIN PASS 07 reversed approval time ordering fails without outbox')
 fails(pg,authorized(p,requestExpiresAt='2035-01-01T00:00:00Z'),
       'uat_owner_channel_request_window_not_bound')
 must(sql(pg,'SELECT count(*) FROM lr_uat_signed_owner_channel_ledger')=='0',
      'changed_signed_request_window_accepted')
 print('ORIGIN PASS 08 request signed creation/expiry must match stored A/B request')
 if hardened_acl:
  # A verifier with TEMP privilege must not shadow unqualified table names
  # inside the protected function. public precedes pg_temp.
  temp_proof=sql(pg,"SET ROLE lr_uat_origin_verifier; "+
   "CREATE TEMP TABLE lr_ab_requests(dummy int); "+commit(p))
  must(temp_proof.splitlines()[-1]=='SYNTHETIC_OWNER_CHANNEL_ATOMIC_GRANT_PENDING_SIGNING',
       'temp_table_shadowed_protected_origin')
  print('ACL PASS 04 pg_temp table shadow cannot intercept protected grant transaction')
 else:
  must(issue(p)=='SYNTHETIC_OWNER_CHANNEL_ATOMIC_GRANT_PENDING_SIGNING',
       'valid_chain_not_issued')
 summary=sql(pg,f"""SELECT req.state||':'||(req.consumed_at IS NOT NULL)::text||
 ':'||p.generation||':'||p.grant_revision||':'||o.status||':'||
 (ledger.owner_decision_nonce_sha256={q(p['nonceSha256'])})::text
 FROM lr_ab_requests req
 JOIN lr_uat_grant_provenance p USING(request_id)
 JOIN lr_uat_lease_signing_outbox o USING(request_id)
 JOIN lr_uat_signed_owner_channel_ledger ledger USING(request_id)
 WHERE req.request_id={q(p['requestId'])}""")
 must(summary=='approved:true:1:1:pending:true','atomic_grant_provenance_missing')
 print('ORIGIN PASS 09 one transaction consumes request and nonce, grants gen1, and emits pending signing outbox')
 fails(pg,authorized(p),'uat_owner_channel_request_not_pending')
 must(sql(pg,'SELECT count(*) FROM lr_uat_signed_owner_channel_ledger')=='1',
      'replayed_ledger')
 print('ORIGIN PASS 10 exact signed approval replay cannot grant twice')
 p2=proofs[1]
 fails(pg,authorized(p2,nonceSha256=p['nonceSha256']),
       'uat_owner_channel_nonce_replayed')
 must(sql(pg,f"""SELECT state FROM lr_ab_requests WHERE request_id={q(p2['requestId'])}""")=='pending',
      'nonce_collision_modified_request')
 print('ORIGIN PASS 11 same decision nonce used for second request rolls back')
 fails(pg,authorized(p2,grantId=p['grantId']),
       'lr_uat_commit_owner_channel_origin')
 must(sql(pg,"SELECT count(*) FROM lr_uat_signed_owner_channel_ledger")=='1',
      'failed_grant_left_nonce_ledger')
 must(sql(pg,f"""SELECT state FROM lr_ab_requests WHERE request_id={q(p2['requestId'])}""")=='pending',
      'failed_grant_consumed_request')
 must(sql(pg,f"""SELECT generation::text FROM lr_uat_device_authority_floor
      WHERE device_id={q(device)}""")=='1','failed_grant_advanced_epoch')
 print('ORIGIN PASS 12 failed reused grant ID rolls back nonce, proof, request and epoch')
 must(issue(p2)=='SYNTHETIC_OWNER_CHANNEL_ATOMIC_GRANT_PENDING_SIGNING',
      'second_independent_nonce_cannot_issue')
 print('ORIGIN PASS 13 second approved proof gets fresh generation 2')
 p3=proofs[2]
 with ThreadPoolExecutor(max_workers=2) as pool:
  tasks=[pool.submit(sql,pg,authorized(p3)) for _ in range(2)]
  outcomes=[]
  for future in tasks:
   try:outcomes.append(future.result().splitlines()[-1])
   except RuntimeError as ex:outcomes.append(str(ex))
 must(sum(x=='SYNTHETIC_OWNER_CHANNEL_ATOMIC_GRANT_PENDING_SIGNING'
       for x in outcomes)==1,'race_double_minted_grant')
 must(any('uat_owner_channel_request_not_pending' in x for x in outcomes),
      'race_wrong_denial')
 print('ORIGIN PASS 14 concurrent issuer replay of same Wall/channel evidence has one winner')
 must(sql(pg,"SELECT count(*) FROM lr_uat_signed_owner_channel_ledger")=='3',
      'concurrent_duplicate_ledger')
 must(sql(pg,"SELECT count(*) FROM lr_uat_lease_signing_outbox")=='3',
      'concurrent_duplicate_outbox')
 must(sql(pg,f"""SELECT generation||':'||grant_revision FROM
 lr_uat_device_authority_floor WHERE device_id={q(device)}""")=='3:3',
      'concurrent_issuer_epoch_not_serialized')
 must(sql(pg,"SELECT count(*) FROM lr_uat_lease_signing_outbox WHERE status='signed'")=='0',
      'untrusted_owner_proof_signed_real_lease')
 print('ORIGIN PASS 15 exactly three one-time evidences, ordered generations, all pending signing')
 if hardened_acl:
  sql(pg,"""REVOKE EXECUTE ON FUNCTION public.lr_uat_commit_owner_channel_origin(
   text,text,text,text,text,text,text,text,text,text,text,text,text,
   timestamptz,timestamptz,timestamptz,timestamptz)
   FROM lr_uat_origin_verifier""")
  fails(pg,authorized(p),'permission denied for function')
  print('ACL PASS 05 REVOKE EXECUTE blocks new verifier connections')
  sql(pg,"""GRANT EXECUTE ON FUNCTION public.lr_uat_commit_owner_channel_origin(
   text,text,text,text,text,text,text,text,text,text,text,text,text,
   timestamptz,timestamptz,timestamptz,timestamptz)
   TO lr_uat_origin_verifier""")
  fails(pg,authorized(p),'uat_owner_channel_request_not_pending')
  must(sql(pg,"SELECT count(*) FROM lr_uat_signed_owner_channel_ledger")=='3',
       'regrant_duplicate_evidence')
  print('ACL PASS 06 regrant restores narrow procedure, not replayed grant')

def main():
 if sys.argv[1:]!=['--confirm-synthetic-only']:
  raise SystemExit('Refusing to run without --confirm-synthetic-only')
 must(re.fullmatch(r'lr-uat-move-[0-9a-f]{10}',u.BASE) is not None,
      'project_prefix_not_synthetic')
 project=u.BASE+'-src'
 started=False
 with tempfile.TemporaryDirectory(prefix='lr_rc50_wall_channel_pg_',dir=Path.home()) as temp:
  pg_env,redis_conf=u.prepare_configs(Path(temp)/'src','src')
  env=u.environment(pg_env,redis_conf)
  try:
   u.compose(project,env,'up','-d','--pull','never','postgres')
   started=True
   cid=u.cid(project,env,'postgres')
   u.healthy(cid);u.check_isolation(cid);u.migrations(cid)
   for raw in [origin.SQL,PROOF_SQL]:
    u.docker('exec','-i',cid,'psql','-X','-v','ON_ERROR_STOP=1',
       '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',data=raw)
   verify(cid,hardened_acl=True)
   print('RC50_OWNER_CHANNEL_ATOMIC_ORIGIN_SYNTHETIC_UAT_PASS production=false')
  finally:
   if started:
    u.compose(project,env,'down','--volumes','--remove-orphans',timeout=90)
    print('RC50_OWNER_CHANNEL_ATOMIC_ORIGIN_PRIVATE_COMPOSE_CLEANED')
if __name__=='__main__':
 main()
