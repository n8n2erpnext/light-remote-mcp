#!/usr/bin/env python3
"""Isolated fake Ed25519 Wall+channel -> PostgreSQL atomic grant/nonce UAT.
NOT an authenticated real-owner issuer; signed packets verified in Node mock.
Run ONLY with --confirm-synthetic-only; disposable random PG Compose project.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json,os,re,secrets,subprocess,sys,tempfile
import verify_issuer_origin_pg_uat as origin

u=origin.u
ROOT=Path(__file__).resolve().parents[1]
PROOF_SQL=(ROOT/'portability/owner_channel_origin_transaction_uat.sql').read_bytes()
READER_SQL=(ROOT/'portability/owner_channel_origin_reader_acl_uat.sql').read_bytes()
ACL_SQL=(ROOT/'portability/owner_channel_origin_verifier_acl_uat.sql').read_bytes()
INTENTS_SQL=(ROOT/'portability/owner_channel_authenticated_intents_uat.sql').read_bytes()
VERIFY_ONLY=ROOT/'portability/synthetic-owner-channel-verify-only.mjs'
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
def setup_synthetic_scram_login(pg):
 # One ephemeral secret in process RAM and a 0600 file INSIDE the scratch
 # PG container. Never write password to host files or command arguments.
 secret=secrets.token_hex(32)
 u.docker('exec','-i',pg,'psql','-X','-v','ON_ERROR_STOP=1',
   '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',
   data=("ALTER ROLE lr_uat_origin_service_login PASSWORD '"+secret+"';").encode())
 u.docker('exec','-i',pg,'sh','-ec',
   'umask 077; cat > /tmp/lr_rc50_origin_login_secret; chmod 0600 /tmp/lr_rc50_origin_login_secret',
   data=secret.encode())
 must(u.sql(pg,"SELECT (rolpassword LIKE 'SCRAM-SHA-256$%')::text FROM pg_authid WHERE rolname='lr_uat_origin_service_login'")=='true',
      'missing_scram_stored_login_hash')
 return '/tmp/lr_rc50_origin_login_secret'
def setup_synthetic_reader_login(pg):
 # Isolated read-only context identity; different random secret from writer.
 secret=secrets.token_urlsafe(36)
 u.docker('exec','-i',pg,'psql','-X','-v','ON_ERROR_STOP=1',
   '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',
   data=("ALTER ROLE lr_uat_origin_reader_login PASSWORD '"+secret+"';").encode())
 u.docker('exec','-i',pg,'sh','-ec',
   'umask 077; cat > /tmp/lr_rc50_origin_reader_secret; chmod 0600 /tmp/lr_rc50_origin_reader_secret',
   data=secret.encode())
 must(u.sql(pg,"SELECT (rolpassword LIKE 'SCRAM-SHA-256$%')::text FROM pg_authid WHERE rolname='lr_uat_origin_reader_login'")=='true',
      'reader_login_not_scram')
 return '/tmp/lr_rc50_origin_reader_secret'
def authenticated_sql(pg,statement,secret_file,wrong_password=False,reader=False):
 # Uses TCP to PostgreSQL and SCRAM password authentication. The password
 # is never supplied as CLI argv, Docker inspect env, or test stdout.
 allowed=('/tmp/lr_rc50_origin_reader_secret' if reader else
          '/tmp/lr_rc50_origin_login_secret')
 must(secret_file==allowed,'invalid_synthetic_db_secret_location')
 principal=('lr_uat_origin_reader_login' if reader else
            'lr_uat_origin_service_login')
 code=('set -eu; export PGPASSWORD=wrong_test_password' if wrong_password else
   'set -eu; export PGPASSWORD="$(cat '+allowed+')"')
 code+='; host="$(hostname -i | awk \'{print $1}\')"; case "$host" in 127.*|::1|"") exit 91;; esac; exec psql -X -v ON_ERROR_STOP=1 -h "$host" -U '+principal+' -d '+u.DB+' -At -c "$1"'
 return u.docker('exec','-i',pg,'sh','-ec',code,'sh',statement).decode().strip()
def sign_fake_batch(rows):
 env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),
      'HOME':os.environ.get('HOME','/tmp'),'LR_RC50_UAT_ONLY':'1'}
 p=subprocess.run(['node',str(BRIDGE),'--synthetic-envelope-only'],
     input=json.dumps({'batch':rows}),capture_output=True,text=True,
     env=env,timeout=12)
 must(p.returncode==0 and p.stdout.strip(),'fake_signing_chain_refused')
 envelopes=json.loads(p.stdout)
 must(isinstance(envelopes,list) and len(envelopes)==len(rows),
     'incorrect_fake_chain_batch')
 proofs=[]
 for envelope in envelopes:
  must('signedPackets' in envelope,'missing_fake_signed_packets')
  item={k:v for k,v in envelope.items() if k!='signedPackets'}
  proofs.append(item)
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
 return proofs,[x['signedPackets'] for x in envelopes]
def load_trusted_origin(pg,envelope,reader_secret=None):
 # The synthetic harness reads independent PostgreSQL request/session/device/
 # pin state. No key or owner-status value is taken from the signed packet.
 request=envelope['wallApproval']['payload']['requestId']
 nonce=envelope['wallApproval']['payload']['wallDecisionNonceSha256']
 if reader_secret is not None:
  data=authenticated_sql(pg,
       f"SELECT public.lr_uat_get_owner_channel_context({q(request)},{q(nonce)})::text",
       reader_secret,reader=True)
  must(data!='','read_only_origin_context_missing')
  return json.loads(data)
 data=u.sql(pg,f"""SELECT row_to_json(z)::text FROM (
  SELECT r.request_id AS "requestId",
   i.proposed_grant_id AS "grantId",r.account_id AS "accountId",
   r.device_id AS "deviceId",r.agent_id AS "agentId",
   r.connection_id AS "connectionId",i.owner_session_id AS "ownerSessionId",
   ek.public_key_sha256 AS "deviceKeySha256",
   pins.wall_verifier_sha256 AS "wallVerifierSha256",
   pins.channel_verifier_sha256 AS "channelVerifierSha256",
   (extract(epoch FROM r.created_at)*1000)::BIGINT AS "requestCreatedAtMs",
   (extract(epoch FROM r.expires_at)*1000)::BIGINT AS "requestExpiresAtMs",
   r.state AS "requestState",
   (ss.revoked_at IS NULL AND ss.expires_at>now() AND
     ss.account_id=r.account_id) AS "ownerSessionActive",
   (ek.state='active' AND d.owner_account_id=r.account_id) AS "enrollmentActive",
   (c.closed_at IS NULL AND c.hard_expires_at>now() AND
     c.account_id=r.account_id AND c.device_id=r.device_id) AS "connectionActive",
   (pins.state='active') AS "pinsActive",
   (NOT EXISTS(SELECT 1 FROM lr_uat_signed_owner_channel_ledger old
       WHERE old.owner_decision_nonce_sha256={q(nonce)})) AS "nonceUnused"
  FROM lr_ab_requests r
  JOIN lr_uat_origin_verifier_intent i USING(request_id)
  JOIN lr_sessions ss ON ss.session_id=i.owner_session_id
  JOIN lr_devices d ON d.device_id=r.device_id
  JOIN lr_device_connections c ON c.connection_id=r.connection_id
  JOIN lr_uat_device_enrolled_key ek ON ek.device_id=r.device_id
  JOIN lr_uat_trusted_origin_verifier_pins pins ON pins.device_id=r.device_id
  WHERE r.request_id={q(request)}
 ) z""")
 must(data!='','independent_db_verifier_state_missing')
 return json.loads(data)

def public_verify_fake_origin(envelope,trusted):
 # A fresh verifier-only Node process receives ONLY public SPKI and signed
 # packets. It neither generates nor receives any signing private key.
 env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),
      'HOME':os.environ.get('HOME','/tmp'),'LR_RC50_UAT_ONLY':'1'}
 p=subprocess.run(['node',str(VERIFY_ONLY),'--synthetic-only'],
   input=json.dumps({'envelope':envelope,'trusted':trusted}),
   capture_output=True,text=True,env=env,timeout=12)
 must(p.returncode==0,'independent_public_verifier_failed_closed')
 return json.loads(p.stdout)

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
 secret_path=None
 reader_secret=None
 def authorized(proof,**overrides):
  query=commit(proof,**overrides)
  return ('SET ROLE lr_uat_origin_verifier; '+query) if hardened_acl else query
 def issue(proof,**overrides):
  query=authorized(proof,**overrides)
  result=(authenticated_sql(pg,query,secret_path) if hardened_acl
    else u.sql(pg,query))
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
  sql(pg,f"""INSERT INTO lr_uat_origin_verifier_intent(
    request_id,proposed_grant_id,owner_session_id)
    VALUES({q(item['requestId'])},{q(item['grantId'])},{q(item['ownerSessionId'])})""")
 for item in ids:
  span=sql(pg,f"""SELECT
    (extract(epoch FROM created_at)*1000)::BIGINT::text||'|'||
    (extract(epoch FROM expires_at)*1000)::BIGINT::text
    FROM lr_ab_requests WHERE request_id={q(item['requestId'])}""")
  created,expires=span.split('|')
  item['requestCreatedAtMs']=int(created)
  item['requestExpiresAtMs']=int(expires)
 proofs,envelopes=sign_fake_batch(ids)
 sql(pg,f"""INSERT INTO lr_uat_trusted_origin_verifier_pins(
   device_id,wall_verifier_sha256,channel_verifier_sha256,state)
 VALUES({q(device)},{q(proofs[0]['wallVerifierSha256'])},
 {q(proofs[0]['channelVerifierSha256'])},'active')""")
 if hardened_acl:
  u.docker('exec','-i',pg,'psql','-X','-v','ON_ERROR_STOP=1',
       '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',data=READER_SQL)
  reader_secret=setup_synthetic_reader_login(pg)
  reader_identity=authenticated_sql(pg,'SELECT current_user,session_user',
                                    reader_secret,reader=True)
  must(reader_identity=='lr_uat_origin_reader_login|lr_uat_origin_reader_login',
       'reader_authentication_not_independent')
  try:authenticated_sql(pg,'SELECT * FROM public.lr_uat_trusted_origin_verifier_pins',
                        reader_secret,reader=True)
  except RuntimeError as e:
   must('permission denied for table' in str(e),'reader_direct_table_denial')
  else:raise AssertionError('reader_direct_trust_pin_read')
  try:authenticated_sql(pg,"UPDATE public.lr_ab_requests SET state='approved'",
                        reader_secret,reader=True)
  except RuntimeError as e:
   must('permission denied for table' in str(e),'reader_direct_mutation_denial')
  else:raise AssertionError('reader_direct_ab_mutation')
  print('READ PASS 01 separate SCRAM context login; no direct table read or mutation')
  try:authenticated_sql(pg,'SELECT current_user',reader_secret,
                        wrong_password=True,reader=True)
  except RuntimeError as e:
   must('password authentication failed' in str(e),
        'reader_wrong_password_not_rejected')
  else:raise AssertionError('reader_wrong_password_accepted')
  try:authenticated_sql(pg,'SET ROLE lr_uat_origin_context_owner; SELECT current_user',
                        reader_secret,reader=True)
  except RuntimeError as e:
   must('permission denied' in str(e),'reader_role_escalation_denial')
  else:raise AssertionError('reader_escalated_to_issuer')
  print('READ PASS 02 password rejection and read-owner escalation denied')
 # Signature-verification process is distinct from fake issuer signer,
 # and trusted owner, key pins and request/grant identifiers come from PG.
 checked=[]
 for proof,envelope in zip(proofs,envelopes):
  trusted=load_trusted_origin(pg,envelope,reader_secret)
  verified=public_verify_fake_origin(envelope,trusted)
  must(verified.get('decision')=='VERIFIED_FAKE_OWNER_CHANNEL_PRECOMMIT',
       'separate_public_verifier_rejected_valid_signed_origin')
  for k in ('requestId','grantId','ownerAccountId','ownerSessionId',
            'deviceId','connectionId','enrolledKeySha256',
            'nonceSha256','wallProofSha256','channelAckSha256',
            'wallVerifierSha256','channelVerifierSha256',
            'requestCreatedAt','requestExpiresAt'):
   must(verified.get(k)==proof.get(k),'separate_public_verifier_digest_mismatch_'+k)
  checked.append(verified)
 proofs=checked
 print('ORIGIN PASS 03 three independently signed Wall/channel proof pairs verified in separate public-key-only process against DB pins')
 tampered=json.loads(json.dumps(envelopes[0]))
 original=tampered['channelAck']['signature']
 tampered['channelAck']['signature']=original[:-2]+('A' if original[-2]!='A' else 'B')+original[-1]
 must(public_verify_fake_origin(tampered,load_trusted_origin(pg,envelopes[0],reader_secret))['decision']=='DENY',
      'forged_channel_signature_accepted')
 trust=load_trusted_origin(pg,envelopes[0],reader_secret)
 must(public_verify_fake_origin(envelopes[0],{**trust,'wallVerifierSha256':'0'*64})['decision']=='DENY',
      'untrusted_wall_key_accepted')
 must(public_verify_fake_origin(envelopes[0],{**trust,'grantId':'uat_grant_forged'})['decision']=='DENY',
      'unbound_grant_intent_accepted')
 print('VERIFY PASS 01 tampered channel, wrong trusted Wall pin and wrong DB grant intent denied')
 if hardened_acl:
  u.docker('exec','-i',pg,'psql','-X','-v','ON_ERROR_STOP=1',
       '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',data=ACL_SQL)
  print('ACL setup: scratch NOLOGIN verifier and SECDEF origin writer')
  try:authenticated_sql(pg,'SET ROLE lr_uat_origin_verifier; SELECT current_user',
                        reader_secret,reader=True)
  except RuntimeError as e:
   must('permission denied' in str(e),'reader_writer_role_escalation_denial')
  else:raise AssertionError('reader_escalated_to_issuer_role')
  print('READ PASS 03 separate context reader cannot SET ROLE origin writer')
  secret_path=setup_synthetic_scram_login(pg)
  assert 'scram-sha-256' in sql(pg,"SELECT setting FROM pg_settings WHERE name='password_encryption'")
  print('AUTH PASS 01 isolated SCRAM verifier login created with ephemeral password')
  try:authenticated_sql(pg,'SELECT session_user',secret_path,wrong_password=True)
  except RuntimeError as e:
   must('password authentication failed' in str(e),'incorrect_password_rejection')
  else:raise AssertionError('wrong_password_accepted')
  print('AUTH PASS 02 wrong password denied by actual PostgreSQL TCP authentication')
  identity=authenticated_sql(pg,'SELECT current_user,session_user',secret_path)
  must(identity=='lr_uat_origin_service_login|lr_uat_origin_service_login',
       'unauthenticated_or_wrong_login_identity')
  print('AUTH PASS 03 successful SCRAM login has its own unprivileged principal')
  try:authenticated_sql(pg,'SELECT * FROM lr_uat_trusted_origin_verifier_pins',secret_path)
  except RuntimeError as e:
   must('permission denied for table' in str(e),'login_inherited_read')
  else:raise AssertionError('login_direct_trust_pin_read')
  try:authenticated_sql(pg,'SELECT lr_uat_issue_direct_owner_grant(\'x\',\'y\')',secret_path)
  except RuntimeError as e:
   must('permission denied for function' in str(e),'login_inherited_legacy_issuer')
  else:raise AssertionError('login_direct_legacy_issuer')
  print('AUTH PASS 04 login inherits neither trusted-table rights nor legacy issuer')
  identity=authenticated_sql(pg,'SET ROLE lr_uat_origin_verifier; SELECT current_user,session_user',
                             secret_path).splitlines()[-1]
  must(identity=='lr_uat_origin_verifier|lr_uat_origin_service_login',
       'set_role_not_bound_to_login')
  print('AUTH PASS 05 SCRAM-authenticated service can SET ROLE verifier without superuser')
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
  temp_proof=authenticated_sql(pg,"SET ROLE lr_uat_origin_verifier; "+
   "CREATE TEMP TABLE lr_ab_requests(dummy int); "+commit(p),secret_path)
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
  tasks=[pool.submit(authenticated_sql,pg,authorized(p3),secret_path)
    if hardened_acl else pool.submit(sql,pg,authorized(p3)) for _ in range(2)]
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
   for raw in [origin.SQL,PROOF_SQL,INTENTS_SQL]:
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
