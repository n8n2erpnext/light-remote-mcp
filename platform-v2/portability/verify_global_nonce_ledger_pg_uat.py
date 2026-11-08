#!/usr/bin/env python3
"""Disposable SQL-only PostgreSQL global nonce ledger rehearsal.

NO HTTP service, no B-code, no real clients, no real grants. No deployment.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import re,sys,tempfile
import rehearse_cold_move_uat as u

ROOT=Path(__file__).resolve().parents[1]
SCHEMA=(ROOT/'portability/uat_global_nonce_ledger.sql').read_bytes()
ACCOUNT='uat_owner_account'
DEVICE='uat_owned_device'
OTHER='uat_other_device'
PRODUCER='uat_fake_producer'
KEY='a'*64
PROOF='b'*64
NONCE_A='a'*32
NONCE_B='b'*32
NONCE_C='c'*32
NONCE_D='d'*32

def need(cond,label):
 if not cond:raise AssertionError('global_replay_pg_'+label)

def invoke(pg,request,nonce,epoch=1,producer=PRODUCER,key=KEY,
           account=ACCOUNT,device=DEVICE,proof=PROOF,
           at='clock_timestamp()'):
 args=[producer,account,device,key,nonce,request,proof]
 for val in args:
  need(re.fullmatch(r'[a-zA-Z0-9_]+',val) is not None,'unsafe_test_fixture')
 q=','.join("'"+val+"'" for val in args)
 return sql(pg,'SELECT lr_uat_record_global_nonce('+q+
              ','+str(epoch)+','+at+')').splitlines()[-1]

def sql(pg,statement):
 # PostgreSQL TERSE error messages preserve the actual constraint name,
 # instead of truncating it away in the shared UAT helper's stderr cap.
 return u.docker('exec','-i',pg,'psql','-X',
       '-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse',
       '-U',u.USER,'-d',u.DB,'-At','-c',statement).decode().strip()

def denied(fn,needle):
 try:fn()
 except RuntimeError as ex:
  need(needle in str(ex),'incorrect_denial_'+needle)
  return
 raise AssertionError('expected_denial_'+needle)

def main():
 if sys.argv[1:]!=['--confirm-synthetic-only']:
  raise SystemExit('Refusing without --confirm-synthetic-only')
 need(re.fullmatch(r'lr-uat-move-[0-9a-f]{10}',u.BASE) is not None,
      'invalid_ephemeral_base')
 project=u.BASE+'-src'
 started=False
 with tempfile.TemporaryDirectory(prefix='lr_rc50_global_nonce_pg_',dir=Path.home()) as tmp:
  pg_env,redis_conf=u.prepare_configs(Path(tmp)/'src','src')
  env=u.environment(pg_env,redis_conf)
  try:
   u.compose(project,env,'up','-d','--pull','never','postgres')
   started=True
   pg=u.cid(project,env,'postgres')
   u.healthy(pg);u.check_isolation(pg)
   u.migrations(pg)
   u.docker('exec','-i',pg,'psql','-X','-v','ON_ERROR_STOP=1',
       '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',data=SCHEMA)
   print('LEDGER PASS 01 disposable private PG17, migrations and no-public-grant schema')
   sql(pg,"""INSERT INTO lr_uat_replay_authority(account_id,device_id)
      VALUES('uat_owner_account','uat_owned_device'),
            ('uat_owner_account','uat_other_device');
     INSERT INTO lr_uat_replay_producer(
       producer_id,account_id,device_id,key_sha256,state)
      VALUES('uat_fake_producer','uat_owner_account',
       'uat_owned_device',repeat('a',64),'active');""")
   need(invoke(pg,'uat_req_a',NONCE_A)=='1','first_record')
   need(sql(pg,"SELECT count(*) FROM lr_uat_global_nonce_ledger")=='1',
        'first_count')
   print('LEDGER PASS 02 first nonce persisted with generation one')
   denied(lambda:invoke(pg,'uat_req_b',NONCE_A),
          'duplicate key value violates unique constraint')
   denied(lambda:invoke(pg,'uat_req_a',NONCE_B),
          'duplicate key value violates unique constraint')
   need(sql(pg,"SELECT claim_generation FROM lr_uat_replay_authority WHERE device_id='uat_owned_device'")=='1',
        'failure_advanced_generation')
   print('LEDGER PASS 03 duplicate nonce or request rejected, epoch revision rolled back')
   for name,call,err in [
     ('wrong_producer',lambda:invoke(pg,'uat_req_wrong',NONCE_B,producer='uat_unknown'),
      'uat_global_nonce_missing_scope'),
     ('wrong_scope',lambda:invoke(pg,'uat_req_wrong2',NONCE_B,device=OTHER),
      'uat_global_nonce_missing_scope'),
     ('forged_key',lambda:invoke(pg,'uat_req_wrong3',NONCE_B,key='c'*64),
      'uat_global_nonce_epoch_or_producer_denied'),
     ('stale_epoch',lambda:invoke(pg,'uat_req_wrong4',NONCE_B,epoch=99),
      'uat_global_nonce_epoch_or_producer_denied'),
     ('bad_nonce',lambda:invoke(pg,'uat_req_wrong5','f'*31),
      'uat_global_nonce_shape_invalid'),
     ('expired_timestamp',lambda:invoke(pg,'uat_req_wrong6',NONCE_B,
         at="clock_timestamp()-interval '2 minutes'"),
      'uat_global_nonce_window_invalid')
   ]:denied(call,err)
   print('LEDGER PASS 04 producer, tenant/device, key, epoch, nonce shape and TTL enforced')
   sql(pg,"UPDATE lr_uat_replay_producer SET state='revoked' WHERE producer_id='uat_fake_producer'")
   denied(lambda:invoke(pg,'uat_req_revoked',NONCE_B),
          'uat_global_nonce_epoch_or_producer_denied')
   sql(pg,"UPDATE lr_uat_replay_producer SET state='active' WHERE producer_id='uat_fake_producer'")
   sql(pg,"UPDATE lr_uat_replay_authority SET fenced=TRUE WHERE device_id='uat_owned_device'")
   denied(lambda:invoke(pg,'uat_req_fenced',NONCE_B),
          'uat_global_nonce_epoch_or_producer_denied')
   sql(pg,"UPDATE lr_uat_replay_authority SET fenced=FALSE WHERE device_id='uat_owned_device'")
   print('LEDGER PASS 05 revoked producer and fenced authority rejected')
   # Rollback the WHOLE transaction after a nonce claim; no phantom consumed
   # nonce or generation bump, same nonce may later commit successfully.
   sql(pg,"BEGIN; SELECT lr_uat_record_global_nonce("+
      "'uat_fake_producer','uat_owner_account','uat_owned_device',"+
      "repeat('a',64),'"+NONCE_B+"','uat_req_rollback',"+
      "repeat('b',64),1,clock_timestamp()); ROLLBACK;")
   need(sql(pg,"SELECT count(*) FROM lr_uat_global_nonce_ledger")=='1',
        'transaction_rollback_left_nonce')
   need(invoke(pg,'uat_req_rollback',NONCE_B)=='2',
        'rolled_back_nonce_never_reusable')
   print('LEDGER PASS 06 transaction rollback leaves no replay nonce or generation')
   sql(pg,"UPDATE lr_uat_replay_authority SET writer_epoch=2 WHERE device_id='uat_owned_device'")
   denied(lambda:invoke(pg,'uat_req_stale',NONCE_C,epoch=1),
          'uat_global_nonce_epoch_or_producer_denied')
   need(invoke(pg,'uat_req_new_epoch',NONCE_C,epoch=2)=='3',
        'new_epoch_not_authoritative')
   print('LEDGER PASS 07 old writer epoch fenced after bump, new epoch wins')
   # Two real PostgreSQL sessions contend for the SAME producer/nonce.
   with ThreadPoolExecutor(max_workers=2) as pool:
    futures=[pool.submit(invoke,pg,'uat_req_race_'+str(n),NONCE_D,2)
       for n in (1,2)]
    outcomes=[]
    for future in futures:
     try:outcomes.append(future.result())
     except RuntimeError as ex:outcomes.append(str(ex))
   need(outcomes.count('4')==1,'concurrent_double_nonce_win')
   need(any('duplicate key value violates unique constraint' in x
        for x in outcomes),'no_unique_violation_loser')
   need(sql(pg,"SELECT claim_generation FROM lr_uat_replay_authority WHERE device_id='uat_owned_device'")=='4',
        'race_generation_over_advanced')
   need(sql(pg,"SELECT count(*) FROM lr_uat_global_nonce_ledger")=='4',
        'race_extra_ledger_row')
   print('LEDGER PASS 08 two real PostgreSQL sessions race: exactly one nonce and generation winner')
   sql(pg,"CREATE ROLE lr_uat_global_nonce_observer NOLOGIN NOINHERIT")
   denied(lambda:sql(pg,"SET ROLE lr_uat_global_nonce_observer; SELECT * FROM lr_uat_global_nonce_ledger"),
          'permission denied')
   denied(lambda:sql(pg,"SET ROLE lr_uat_global_nonce_observer; SELECT lr_uat_record_global_nonce("+
         "'uat_fake_producer','uat_owner_account','uat_owned_device',"+
         "repeat('a',64),'"+('e'*32)+"','uat_req_untrusted',"+
         "repeat('b',64),2,clock_timestamp())"),
          'permission denied')
   print('LEDGER PASS 09 no PUBLIC table SELECT or function EXECUTE')
   print('RC50_PG_GLOBAL_NONCE_LEDGER_SYNTHETIC_UAT_PASS production=false issuer_wiring=false')
  finally:
   if started:
    u.compose(project,env,'down','--volumes','--remove-orphans',timeout=90)
    print('RC50_PG_GLOBAL_NONCE_LEDGER_PRIVATE_COMPOSE_CLEANED')
if __name__=='__main__':
 main()
