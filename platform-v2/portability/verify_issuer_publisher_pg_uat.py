#!/usr/bin/env python3
"""Private PG publisher/ACK transaction UAT + independent ephemeral Node signing.
Only runs with --confirm-synthetic-only; NO real Wall, device, Agent or keys.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime,timedelta,timezone

import verify_issuer_origin_pg_uat as origin
u=origin.u
ROOT=Path(__file__).resolve().parents[1]
SQL=(ROOT/'portability/issuer_publisher_uat.sql').read_bytes()
SIGNER=ROOT/'portability/synthetic-outbox-lease-publisher.mjs'

def must(condition,reason):
    if not condition:raise AssertionError('publisher_pg_uat_'+reason)
def q(value):
    text=str(value)
    must(re.fullmatch(r'[A-Za-z0-9_.:+\-T]+',text) is not None,'invalid_sql_fixture_value')
    return "'"+text+"'"
def fails(cid,sql,why):
    try:u.sql(cid,sql)
    except RuntimeError as e:
        must(why in str(e),'unexpected_refusal_'+why)
        return
    raise AssertionError('expected_refusal_'+why)
def claim(cid,worker,token):
    row=u.sql(cid,f"""SELECT coalesce(
      (SELECT row_to_json(z)::text FROM lr_uat_claim_signing({q(worker)},{q(token)}) z),
      'null')""")
    return json.loads(row)
def sign(claimed):
    env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),
         'HOME':os.environ.get('HOME','/tmp'),'LR_RC50_UAT_ONLY':'1'}
    p=subprocess.run(['node',str(SIGNER),'--synthetic-only'],
         input=json.dumps(claimed),text=True,capture_output=True,
         env=env,timeout=10)
    must(p.returncode==0,'ephemeral_node_signer_refused')
    result=json.loads(p.stdout)
    must(result.get('physicalExecutionAuthorized') is False and
         result.get('productionIssuerAuthorized') is False,
         'inadvertently_authorized_real_action')
    must('privateKey' not in result,'private_key_exposed')
    return result
def finalize(cid,claimed,token,result,**overrides):
    p=result['packet']
    params={
      'request':claimed['out_request_id'],'token':token,
      'seq':claimed['out_claim_seq'],'sig':p['signature'],
      'digest':result['signatureDigest'],'issuer':result['issuerFingerprint'],
      'expires':result['leaseExpiresAt']
    }
    params.update(overrides)
    return u.sql(cid,f"""SELECT lr_uat_finalize_signing(
     {q(params['request'])},{q(params['token'])},{int(params['seq'])},
     {q(params['sig'])},{q(params['digest'])},{q(params['issuer'])},
     {q(params['expires'])}::timestamptz)""")
def ack(cid,claimed,result,nonce=None,**override):
    p={
      'request':claimed['out_request_id'],'grant':claimed['out_grant_id'],
      'digest':result['signatureDigest'],
      'device':claimed['out_device_key_sha256'],
      'nonce':nonce or '6'*64
    }
    p.update(override)
    return u.sql(cid,f"""SELECT lr_uat_ack_signed_lease(
      {q(p['request'])},{q(p['grant'])},{q(p['digest'])},
      {q(p['device'])},{q(p['nonce'])})""")
def verify(cid):
    # Seed exact same synthetic four approved A/B requests from the prior
    # grant origin UAT, including the two competing generation claims.
    origin.verify(cid)
    u.docker('exec','-i',cid,'psql','-X','-v','ON_ERROR_STOP=1',
      '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',data=SQL)
    print('PUB PASS 01 synthetic-only publisher SQL applied after checked 13 migrations')
    pending=u.sql(cid,"SELECT count(*) FROM lr_uat_lease_signing_outbox WHERE status='pending'")
    must(pending=='4','not_four_origin_outboxes')
    w1,t1='uat_worker_alpha','uat_claim_alpha_1234567890'
    w2,t2='uat_worker_beta','uat_claim_beta_1234567890'
    with ThreadPoolExecutor(max_workers=2) as pool:
        a=pool.submit(claim,cid,w1,t1)
        b=pool.submit(claim,cid,w2,t2)
        ra,rb=a.result(),b.result()
    got=[(r,t) for r,t in [(ra,t1),(rb,t2)] if r is not None]
    must(len(got)==1,'two_publishers_claimed_same_generation')
    row,token=got[0]
    must(row['out_generation']==4 and row['out_grant_revision']==4,
       'obsolete_generation_won_claim')
    must(u.sql(cid,"SELECT count(*) FROM lr_uat_lease_signing_outbox WHERE status='canceled'")=='3',
       'old_generations_not_canceled')
    print('PUB PASS 02 two concurrent claimers: exactly one claims latest generation 4')
    must(claim(cid,'uat_worker_other','uat_claim_other_1234567890') is None,
        'active_claim_stolen')
    print('PUB PASS 03 live signing claim cannot be stolen')
    # Claim token, seq and expiry protect against slow signer after lease.
    signed=sign(row)
    must(signed['packet']['payload']['claimSeq']==row['out_claim_seq'],
         'signature_claim_not_bound')
    print('PUB PASS 04 isolated Ed25519 issuer signs only exact claimed generation, no private key output')
    u.sql(cid,f"""INSERT INTO lr_uat_issuer_pin(issuer_id,public_key_sha256)
        VALUES('synthetic_only',{q(signed['issuerFingerprint'])})""")
    fails(cid, f"""SELECT lr_uat_finalize_signing(
      {q(row['out_request_id'])},'uat_claim_fake_1234567890',{row['out_claim_seq']},
      {q(signed['packet']['signature'])},{q(signed['signatureDigest'])},
      {q(signed['issuerFingerprint'])},
      {q(signed['leaseExpiresAt'])}::timestamptz)""",
      'uat_stale_or_duplicate_signing_claim')
    fails(cid, f"""SELECT lr_uat_finalize_signing(
      {q(row['out_request_id'])},{q(token)},{row['out_claim_seq']+1},
      {q(signed['packet']['signature'])},{q(signed['signatureDigest'])},
      {q(signed['issuerFingerprint'])},
      {q(signed['leaseExpiresAt'])}::timestamptz)""",
      'uat_stale_or_duplicate_signing_claim')
    print('PUB PASS 05 wrong token and claim sequence cannot finalize')
    fails(cid,f"""SELECT lr_uat_finalize_signing(
      {q(row['out_request_id'])},{q(token)},{row['out_claim_seq']},
      {q(signed['packet']['signature'])},{q(signed['signatureDigest'])},
      {'%s' % q('0'*64)},{q(signed['leaseExpiresAt'])}::timestamptz)""",
      'uat_issuer_signer_key_not_pinned')
    print('PUB PASS 06 wrong issuer key pin rejected before commit')
    over=datetime.now(timezone.utc)+timedelta(seconds=40)
    fails(cid,f"""SELECT lr_uat_finalize_signing(
      {q(row['out_request_id'])},{q(token)},{row['out_claim_seq']},
      {q(signed['packet']['signature'])},{q(signed['signatureDigest'])},
      {q(signed['issuerFingerprint'])},{q(over.isoformat())}::timestamptz)""",
      'uat_lease_ttl_exceeds_grant')
    print('PUB PASS 07 signing lease beyond 30 seconds rejected')
    # Revoke/claim expiry simulation in this scratch DB; the old signature
    # MUST NOT be publishable and must have an independent sequence fence.
    u.sql(cid,f"""UPDATE lr_uat_lease_signing_outbox
       SET claim_expires_at=now()-interval '1 second'
       WHERE request_id={q(row['out_request_id'])}""")
    fails(cid,f"""SELECT lr_uat_finalize_signing(
      {q(row['out_request_id'])},{q(token)},{row['out_claim_seq']},
      {q(signed['packet']['signature'])},{q(signed['signatureDigest'])},
      {q(signed['issuerFingerprint'])},
      {q(signed['leaseExpiresAt'])}::timestamptz)""",
      'uat_stale_or_duplicate_signing_claim')
    row2=claim(cid,'uat_worker_retry','uat_claim_retry_1234567890')
    must(row2 is not None and row2['out_request_id']==row['out_request_id']
      and row2['out_claim_seq']==row['out_claim_seq']+1,
      'failed_claim_epoch_fence')
    print('PUB PASS 08 expired claim cannot sign; next claimant gets incremented claim sequence')
    signed2=sign(row2)
    # This is a scratch trust bootstrap; real producer cannot overwrite pin.
    u.sql(cid,f"""UPDATE lr_uat_issuer_pin SET public_key_sha256={q(signed2['issuerFingerprint'])}
       WHERE issuer_id='synthetic_only'""")
    must(finalize(cid,row2,'uat_claim_retry_1234567890',signed2)==
      'SYNTHETIC_SIGNATURE_COMMITTED_PENDING_ACK','signed_commit_missing')
    print('PUB PASS 09 short Ed25519 lease digest committed with current claim fence')
    fails(cid,f"""SELECT lr_uat_finalize_signing(
      {q(row2['out_request_id'])},'uat_claim_retry_1234567890',{row2['out_claim_seq']},
      {q(signed2['packet']['signature'])},{q(signed2['signatureDigest'])},
      {q(signed2['issuerFingerprint'])},
      {q(signed2['leaseExpiresAt'])}::timestamptz)""",
      'uat_stale_or_duplicate_signing_claim')
    must(u.sql(cid,"SELECT count(*) FROM lr_uat_lease_signing_outbox WHERE status='signed'")=='1',
       'signing_replay_minted_extra_outbox')
    print('PUB PASS 10 second finalize cannot mutate immutable signed outbox')
    for args in [
      {'grant':'uat_wrong_grant'}, {'digest':'0'*64},{'device':'0'*64}
    ]:
        try:ack(cid,row2,signed2,**args)
        except RuntimeError as exc:
            must('uat_ack_binding_mismatch' in str(exc),'incorrect_ack_refusal')
        else:raise AssertionError('forged_ack_accepted')
    print('PUB PASS 11 wrong grant, signature digest or device fingerprint ACK denied')
    u.sql(cid,f"""UPDATE lr_uat_device_enrolled_key SET state='revoked'
      WHERE device_id={q(row2['out_device_id'])}""")
    try:ack(cid,row2,signed2)
    except RuntimeError as exc:
      must('uat_ack_expired_or_fenced' in str(exc),'revoked_ack_reason')
    else:raise AssertionError('revoked_device_ack_accepted')
    u.sql(cid,f"""UPDATE lr_uat_device_enrolled_key SET state='active'
      WHERE device_id={q(row2['out_device_id'])}""")
    print('PUB PASS 12 revoked enrolled device cannot ACK newly signed lease')
    u.sql(cid,f"""UPDATE lr_uat_device_authority_floor SET generation=generation+1
      WHERE device_id={q(row2['out_device_id'])}""")
    try:ack(cid,row2,signed2)
    except RuntimeError as exc:
      must('uat_ack_expired_or_fenced' in str(exc),'stale_generation_ack_reason')
    else:raise AssertionError('fenced_generation_ack_accepted')
    u.sql(cid,f"""UPDATE lr_uat_device_authority_floor SET generation=generation-1
      WHERE device_id={q(row2['out_device_id'])}""")
    print('PUB PASS 13 ACK with stale global device generation fails closed')
    u.sql(cid,f"""UPDATE lr_ab_grants SET closed_at=now()
      WHERE grant_id={q(row2['out_grant_id'])}""")
    try:ack(cid,row2,signed2)
    except RuntimeError as exc:
      must('uat_ack_expired_or_fenced' in str(exc),'closed_grant_ack_reason')
    else:raise AssertionError('closed_grant_ack_accepted')
    u.sql(cid,f"""UPDATE lr_ab_grants SET closed_at=NULL
      WHERE grant_id={q(row2['out_grant_id'])}""")
    print('PUB PASS 14 closed/revoked grant cannot receive a new ACK')
    must(ack(cid,row2,signed2)=='ACK_INSERTED_SYNTHETIC_ONLY','ack_not_inserted')
    must(ack(cid,row2,signed2)=='ACK_DUPLICATE_NOOP','ack_not_idempotent')
    print('PUB PASS 15 fake ACK commits once and same retransmission is idempotent')
    try:ack(cid,row2,signed2,nonce='7'*64)
    except RuntimeError as exc:
      must('uat_ack_conflicting_replay' in str(exc),'ack_conflict_unexpected')
    else:raise AssertionError('conflicting_ack_inserted')
    print('PUB PASS 16 different nonce for same request refused')
    must(u.sql(cid,"SELECT count(*) FROM lr_uat_lease_delivery_ack")=='1',
       'fake_ack_duplicate_rows')
    must(u.sql(cid,"SELECT count(*) FROM lr_uat_lease_signing_outbox WHERE status='canceled'")=='3',
       'obsolete_signing_rows_restored')
    print('PUB PASS 17 exactly one signed latest-generation ACK and three canceled old outboxes')

def main():
    if sys.argv[1:]!=['--confirm-synthetic-only']:
      raise SystemExit('Refusing to run without --confirm-synthetic-only')
    must(re.fullmatch(r'lr-uat-move-[0-9a-f]{10}',u.BASE) is not None,
      'wrong_compose_fixture_prefix')
    project=u.BASE+'-src'
    started=False
    with tempfile.TemporaryDirectory(prefix='lr_rc50_signing_pg_',dir=Path.home()) as temp:
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
          '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',data=origin.SQL)
        verify(cid)
        print('RC50_ISSUER_PUBLISHER_ACK_SYNTHETIC_UAT_PASS production=false')
      finally:
        if started:
          u.compose(project,env,'down','--volumes','--remove-orphans',timeout=90)
          print('RC50_ISSUER_PUBLISHER_ISOLATED_PROJECT_CLEANED')

if __name__=='__main__':
    main()
