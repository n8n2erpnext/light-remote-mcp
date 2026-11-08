#!/usr/bin/env python3
"""rc50 synthetic-only PG receipt+nonce+grant transaction UAT.

Prerequisites are the existing disposable PG17 Compose fixture and two
read-only, synthetic-only SQL schemas. This does NOT invoke the previously
blocked persistent HTTP Docker verifier runner.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json,os,re,sys,tempfile
import verify_global_nonce_ledger_pg_uat as g
u=g.u
ROOT=Path(__file__).resolve().parents[1]
SCHEMA=(ROOT/'portability/uat_signed_receipt_issuer_transaction.sql').read_bytes()
SCRIPT=ROOT/'portability/synthetic-signed-receipt-stage-fixture.mjs'
ACCOUNT='uat_receipt_account';DEVICE='uat_receipt_device'
PRODUCER='uat_receipt_producer';VERIFIER='uat_fake_receipt_signer'
AGENT='uat_receipt_agent';CONN='uat_receipt_connection';SESSION='uat_receipt_session'
KEY='a'*64
def q(x):
 if isinstance(x,int):return str(x)
 if not isinstance(x,str) or len(x)>256:raise ValueError('unsafe_fixture_value')
 return "'"+x.replace("'","''")+"'"
def must(ok,what):
 if not ok:raise AssertionError('receipt_pg_'+what)
def sql(pg,statement):return g.sql(pg,statement)
def denied(fn,fragment):
 try:fn()
 except RuntimeError as e:
  must(fragment in str(e),'expected_denial_'+fragment)
  return
 raise AssertionError('unexpected_accept_'+fragment)
def role(pg,name,statement):
 must(name in ('lr_uat_receipt_stage_role','lr_uat_receipt_issuer_role',
               'lr_uat_receipt_untrusted_role'),'unlisted_role')
 return sql(pg,'SET ROLE '+name+'; '+statement)
def make(request_id,grant_id,generation,epoch=1):
 inp={'requestId':request_id,'grantId':grant_id,
  'accountId':ACCOUNT,'deviceId':DEVICE,'producerId':PRODUCER,
  'agentId':AGENT,'connectionId':CONN,'sessionId':SESSION,
  'writerEpoch':epoch,'generation':generation}
 result=json.loads(u.run(['node',str(SCRIPT),'--synthetic-only'],
   env={**os.environ,'LR_RC50_UAT_ONLY':'1'},
   data=json.dumps(inp).encode(),timeout=12).decode())
 must(result['originWasCryptographicallyVerified'] is True,
  'node_fake_proof_not_verified')
 must(result['productionIssuerAuthorized'] is False,'real_authority_leak')
 return result
def stage(pg,v,req_override=None):
 req=req_override or v['requestId']
 # Scratch PG admin only seeds the independently trusted request and key pin.
 # In real architecture this data must come from authenticated owner state.
 sql(pg,f"""INSERT INTO lr_uat_receipt_request(
  request_id,grant_id,account_id,device_id,owner_session_sha256,
  enrolled_key_sha256,wall_proof_sha256,channel_ack_sha256)
  VALUES({q(req)},{q(v['grantId'])},{q(ACCOUNT)},{q(DEVICE)},
   {q(v['ownerSessionSha256'])},{q(v['enrolledKeySha256'])},
   {q(v['wallProofSha256'])},{q(v['channelAckSha256'])})
  ON CONFLICT(request_id) DO NOTHING;
 INSERT INTO lr_uat_receipt_verifier_pin(
  verifier_id,key_epoch,public_key_sha256,state)
 VALUES({q(v['verifierId'])},{q(v['keyEpoch'])},
        {q(v['publicKeySha256'])},'active')
 ON CONFLICT(verifier_id) DO UPDATE
 SET key_epoch=EXCLUDED.key_epoch,
     public_key_sha256=EXCLUDED.public_key_sha256,state='active';""")
 # Only the fake verifier role may stage verified Ed25519 receipt fields.
 values=[
  'receiptId','receiptSha256','verifierId','keyEpoch','publicKeySha256',
  'requestId','grantId','accountId','deviceId','ownerSessionSha256',
  'enrolledKeySha256','wallProofSha256','channelAckSha256','producerId',
  'producerKeySha256','nonceHex','messageSha256','writerEpoch',
  'nextGeneration','signedAt','expiresAt']
 cols=['receipt_id','receipt_sha256','verifier_id','verifier_key_epoch',
  'verifier_key_sha256','request_id','grant_id','account_id','device_id',
  'owner_session_sha256','enrolled_key_sha256','wall_proof_sha256',
  'channel_ack_sha256','producer_id','producer_key_sha256','nonce_hex',
  'message_sha256','expected_writer_epoch','expected_generation',
  'signed_at','expires_at']
 assert len(values)==len(cols)
 expr=[q(v[k])+('::timestamptz' if k in ('signedAt','expiresAt') else '')
       for k in values]
 role(pg,'lr_uat_receipt_stage_role',
  'INSERT INTO lr_uat_receipt_verified_stage('+','.join(cols)+') VALUES('+
  ','.join(expr)+')')
def issue(pg,v):
 return role(pg,'lr_uat_receipt_issuer_role',
   'SELECT lr_uat_commit_staged_receipt('+q(v['receiptId'])+')').splitlines()[-1]
def summary(pg):
 return tuple(int(x) for x in sql(pg,
  """SELECT (SELECT count(*) FROM lr_uat_global_nonce_ledger),
   (SELECT count(*) FROM lr_uat_receipt_grant),
   (SELECT count(*) FROM lr_uat_receipt_provenance),
   (SELECT count(*) FROM lr_uat_receipt_outbox),
   (SELECT count(*) FROM lr_uat_receipt_verified_stage WHERE claimed_at IS NOT NULL),
   (SELECT claim_generation FROM lr_uat_replay_authority
      WHERE account_id='uat_receipt_account' AND device_id='uat_receipt_device')""").split('|'))
def main():
 if sys.argv[1:]!=['--confirm-synthetic-only']:
  raise SystemExit('Refusing without --confirm-synthetic-only')
 must(re.fullmatch(r'lr-uat-move-[0-9a-f]{10}',u.BASE) is not None,
      'invalid_random_fixture')
 project=u.BASE+'-src'
 started=False
 with tempfile.TemporaryDirectory(prefix='lr_rc50_signed_receipt_pg_',dir=Path.home()) as tmp:
  pg_env,redis_conf=u.prepare_configs(Path(tmp)/'src','src')
  env=u.environment(pg_env,redis_conf)
  try:
   u.compose(project,env,'up','-d','--pull','never','postgres')
   started=True
   pg=u.cid(project,env,'postgres')
   u.healthy(pg);u.check_isolation(pg);u.migrations(pg)
   for schema in (g.SCHEMA,SCHEMA):
    u.docker('exec','-i',pg,'psql','-X','-v','ON_ERROR_STOP=1',
     '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',data=schema)
   sql(pg,f"""INSERT INTO lr_uat_replay_authority(account_id,device_id)
      VALUES({q(ACCOUNT)},{q(DEVICE)});
    INSERT INTO lr_uat_replay_producer(
      producer_id,account_id,device_id,key_sha256,state)
    VALUES({q(PRODUCER)},{q(ACCOUNT)},{q(DEVICE)},{q(KEY)},'active');
    CREATE ROLE lr_uat_receipt_untrusted_role NOLOGIN NOINHERIT;""")
   print('RECEIPT_TX PASS 01 isolated PG17/migrations; private issuer/stage roles')
   v=make('uat_request_receipt_one','uat_grant_receipt_one',1)
   stage(pg,v)
   denied(lambda:role(pg,'lr_uat_receipt_stage_role',
      'SELECT lr_uat_commit_staged_receipt('+q(v['receiptId'])+')'),
      'permission denied')
   denied(lambda:role(pg,'lr_uat_receipt_issuer_role',
      'INSERT INTO lr_uat_receipt_verified_stage(receipt_id) VALUES('+q('f'*32)+')'),
      'permission denied')
   denied(lambda:role(pg,'lr_uat_receipt_untrusted_role',
      'SELECT lr_uat_commit_staged_receipt('+q(v['receiptId'])+')'),
      'permission denied')
   print('RECEIPT_TX PASS 02 verifier stage/issuer/untrusted roles isolated')
   must(issue(pg,v)=='1','first_grant_generation')
   must(summary(pg)==(1,1,1,1,1,1),'all_five_tables_not_atomic')
   print('RECEIPT_TX PASS 03 ONE transaction receipt/nonce/grant/provenance/outbox')
   denied(lambda:issue(pg,v),'uat_receipt_owner_or_request_revoked')
   must(summary(pg)==(1,1,1,1,1,1),'replay_changed_state')
   print('RECEIPT_TX PASS 04 duplicate signed receipt cannot grant twice')
   w=make('uat_request_receipt_rollback','uat_grant_receipt_rollback',2)
   stage(pg,w)
   initial=summary(pg)
   # Controlled crash-equivalent: client COMMIT never happens.
   sql(pg,"BEGIN; SET ROLE lr_uat_receipt_issuer_role; SELECT lr_uat_commit_staged_receipt("+
    q(w['receiptId'])+"); ROLLBACK;")
   must(summary(pg)==initial,'rollback_left_partial_effect')
   must(issue(pg,w)=='2','rollback_cannot_retry')
   must(summary(pg)==(2,2,2,2,2,2),'rollback_retry_partial')
   print('RECEIPT_TX PASS 05 rollback BEFORE COMMIT leaves no partial state')
   r=make('uat_request_receipt_revoked','uat_grant_receipt_revoked',3)
   stage(pg,r)
   sql(pg,"UPDATE lr_uat_receipt_verifier_pin SET state='revoked'")
   denied(lambda:issue(pg,r),'uat_receipt_verifier_key_revoked')
   must(summary(pg)==(2,2,2,2,2,2),'revoked_consumed_receipt')
   sql(pg,"UPDATE lr_uat_receipt_verifier_pin SET state='active'")
   must(issue(pg,r)=='3','restored_pinned_verifier_not_valid')
   print('RECEIPT_TX PASS 06 verifier pin revocation stops grant before nonce use')
   e=make('uat_request_receipt_epoch','uat_grant_receipt_epoch',4)
   stage(pg,e)
   sql(pg,"UPDATE lr_uat_replay_authority SET writer_epoch=2 WHERE device_id="+q(DEVICE))
   denied(lambda:issue(pg,e),'uat_global_nonce_epoch_or_producer_denied')
   must(summary(pg)==(3,3,3,3,3,3),'stale_writer_created_state')
   print('RECEIPT_TX PASS 07 stale writer epoch rejects receipt and all writes')
   # Revert test-only epoch to expected value. Does NOT claim real fencing.
   sql(pg,"UPDATE lr_uat_replay_authority SET writer_epoch=1 WHERE device_id="+q(DEVICE))
   with ThreadPoolExecutor(max_workers=2) as pool:
    futures=[pool.submit(issue,pg,e) for _ in (1,2)]
    results=[]
    for f in futures:
     try:results.append(f.result())
     except RuntimeError as ex:results.append(str(ex))
   must(results.count('4')==1,'concurrent_double_issue')
   must(any('uat_receipt_owner_or_request_revoked' in z for z in results),
        'concurrent_loser_wrong_denial')
   must(summary(pg)==(4,4,4,4,4,4),'concurrent_partial_state')
   print('RECEIPT_TX PASS 08 two independent issuer sessions: exactly one COMMIT')
   n=make('uat_request_receipt_nonce','uat_grant_receipt_nonce',5)
   stage(pg,n)
   # Malicious staged duplicate nonce via restricted stage role; no actor may
   # bypass the global ledger UNIQUE constraint even with a different receipt.
   sql(pg,"UPDATE lr_uat_receipt_verified_stage SET nonce_hex="+q(v['nonceHex'])+
    " WHERE receipt_id="+q(n['receiptId']))
   denied(lambda:issue(pg,n),'duplicate key value violates unique constraint')
   must(summary(pg)==(4,4,4,4,4,4),'nonce_reuse_created_grant')
   print('RECEIPT_TX PASS 09 reused global nonce fails atomically')
   late=make('uat_request_receipt_late_fail','uat_grant_receipt_late_fail',5)
   stage(pg,late)
   sql(pg,"ALTER TABLE lr_uat_receipt_outbox ADD CONSTRAINT " +
     "lr_uat_force_late_failure CHECK (grant_id<>"+q(late['grantId'])+")")
   denied(lambda:issue(pg,late),'violates check constraint')
   must(summary(pg)==(4,4,4,4,4,4),'outbox_failure_did_not_rollback_all')
   sql(pg,"ALTER TABLE lr_uat_receipt_outbox DROP CONSTRAINT lr_uat_force_late_failure")
   must(issue(pg,late)=='5','outbox_failure_retry_rejected')
   print('RECEIPT_TX PASS 10 late outbox fault rolls back nonce, grant, provenance and generation')
   revoked=make('uat_request_receipt_owner','uat_grant_receipt_owner',6)
   stage(pg,revoked)
   sql(pg,"UPDATE lr_uat_receipt_request SET owner_session_active=FALSE WHERE request_id="+
       q(revoked['requestId']))
   denied(lambda:issue(pg,revoked),'uat_receipt_owner_or_request_revoked')
   sql(pg,"UPDATE lr_uat_receipt_request SET owner_session_active=TRUE,device_active=FALSE WHERE request_id="+
       q(revoked['requestId']))
   denied(lambda:issue(pg,revoked),'uat_receipt_owner_or_request_revoked')
   must(summary(pg)==(5,5,5,5,5,5),'revocation_created_partial_state')
   sql(pg,"UPDATE lr_uat_receipt_request SET device_active=TRUE WHERE request_id="+
       q(revoked['requestId']))
   must(issue(pg,revoked)=='6','revocation_restored_receipt_rejected')
   print('RECEIPT_TX PASS 11 owner session and device revocation deny entire transaction')
   pin=make('uat_request_receipt_pin_epoch','uat_grant_receipt_pin_epoch',7)
   stage(pg,pin)
   sql(pg,"UPDATE lr_uat_receipt_verifier_pin SET key_epoch=4 WHERE verifier_id="+
       q(pin['verifierId']))
   denied(lambda:issue(pg,pin),'uat_receipt_verifier_key_revoked')
   sql(pg,"UPDATE lr_uat_receipt_verifier_pin SET key_epoch=3 WHERE verifier_id="+
       q(pin['verifierId']))
   sql(pg,"UPDATE lr_uat_receipt_verified_stage SET expires_at=clock_timestamp()-interval '1 second' WHERE receipt_id="+
       q(pin['receiptId']))
   denied(lambda:issue(pg,pin),'uat_receipt_expired')
   must(summary(pg)==(6,6,6,6,6,6),'expired_or_rotated_receipt_created_state')
   print('RECEIPT_TX PASS 12 rotated verifier key epoch or expired receipt cannot commit')
   print('RC50_SIGNED_RECEIPT_ISSUER_SYNTHETIC_PG_UAT_PASS production=false')
  finally:
   if started:
    u.compose(project,env,'down','--volumes','--remove-orphans',timeout=90)
    print('RC50_SIGNED_RECEIPT_PRIVATE_COMPOSE_CLEANED')
if __name__=='__main__':main()
