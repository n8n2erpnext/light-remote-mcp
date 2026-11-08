#!/usr/bin/env python3
"""Private end-to-end fake device Ed25519 ACK -> single PostgreSQL ACK TX.
Only --confirm-synthetic-only; NO production device, owner data or services.
"""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

import verify_issuer_publisher_pg_uat as publisher

u=publisher.u
origin=publisher.origin
ROOT=Path(__file__).resolve().parents[1]
SQL=(ROOT/'portability/device_signed_ack_uat.sql').read_bytes()
ACL_SQL=(ROOT/'portability/device_ack_verifier_acl_uat.sql').read_bytes()
CLI=ROOT/'portability/synthetic-device-ack-fixture-cli.mjs'

def must(ok,reason):
    if not ok:raise AssertionError('signed_device_ack_uat_'+reason)
def fails(cid,sql,reason):
    try:u.sql(cid,sql)
    except RuntimeError as exc:
        must(reason in str(exc),'wrong_refusal_'+reason)
        return
    raise AssertionError('expected_denial_'+reason)
def q(s):
    return publisher.q(s)

class EphemeralDevice:
    def __enter__(self):
        env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),
          'HOME':os.environ.get('HOME','/tmp'),'LR_RC50_UAT_ONLY':'1'}
        self.proc=subprocess.Popen(['node',str(CLI),'--synthetic-only'],
           stdin=subprocess.PIPE,stdout=subprocess.PIPE,
           stderr=subprocess.DEVNULL,text=True,bufsize=1,env=env)
        self.identity=self.ask({'action':'public'})
        must('privateKey' not in self.identity,'private_key_exposed')
        must(re.fullmatch(r'[a-f0-9]{64}',self.identity['deviceKeySha256']),
          'fake_public_fingerprint_invalid')
        return self
    def ask(self,req):
        self.proc.stdin.write(json.dumps(req,separators=(',',':'))+'\n')
        self.proc.stdin.flush()
        response=self.proc.stdout.readline()
        must(response!='','fake_device_process_closed')
        return json.loads(response)
    def __exit__(self,*args):
        try:self.proc.stdin.close()
        except Exception:pass
        try:self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:self.proc.kill()

def context(cid,request_id):
    # Read FULL trust reference independently from private scratch PostgreSQL,
    # not from an untrusted client ACK. SPKI is public; never read a private key.
    r=u.sql(cid,f"""SELECT row_to_json(z) FROM (
      SELECT o.request_id AS "requestId",o.grant_id AS "grantId",
       p.device_id AS "deviceId",p.public_key_sha256 AS "deviceKeySha256",
       pin.public_key_sha256 AS "issuerKeySha256",
       o.signed_digest_sha256 AS "signedLeaseDigest",
       p.generation AS "generation",p.grant_revision AS "grantRevision",
       o.claim_seq AS "claimSeq",c.nonce_sha256 AS "nonceSha256",
       (extract(epoch FROM c.expires_at)*1000)::BIGINT AS "challengeExpiresAtMs",
       (ek.state='active' AND ek.public_key_sha256=p.public_key_sha256)
         AS "enrollmentActive",
       (g.closed_at IS NULL AND g.expires_at>now()
         AND g.absolute_expires_at>now()) AS "grantActive",
       (pin.enabled AND pin.public_key_sha256=o.issuer_public_key_sha256)
         AS "issuerPinActive",
       (c.consumed_at IS NULL) AS "nonceUnused",
       f.generation AS "floorGeneration",
       f.grant_revision AS "floorGrantRevision",
       ek.public_key_spki_b64url AS "devicePublicSpki",
       pin.public_key_spki_b64url AS "issuerPublicSpki"
      FROM lr_uat_device_ack_challenge c
      JOIN lr_uat_lease_signing_outbox o USING(request_id)
      JOIN lr_uat_grant_provenance p USING(request_id)
      JOIN lr_uat_device_authority_floor f ON f.device_id=p.device_id
      JOIN lr_uat_device_enrolled_key ek ON ek.device_id=p.device_id
      JOIN lr_uat_issuer_pin pin ON pin.issuer_id='synthetic_only'
      JOIN lr_ab_grants g ON g.grant_id=o.grant_id
      WHERE c.request_id={q(request_id)}
    ) z""")
    return json.loads(r)
def verified(device,ack,lease,ctx):
    # Independent process has only public keys and DB-derived expectations.
    # It NEVER receives the device fixture private key held by device.proc.
    payload={
      'action':'verify','signedAck':ack,'signedLease':lease,
      'issuerPublicSpki':ctx['issuerPublicSpki'],
      'devicePublicSpki':ctx['devicePublicSpki'],
      'expected':{k:v for k,v in ctx.items()
        if k not in ('devicePublicSpki','issuerPublicSpki')}
    }
    env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),
         'HOME':os.environ.get('HOME','/tmp'),'LR_RC50_UAT_ONLY':'1'}
    proc=subprocess.run(['node',str(CLI),'--verify-only'],
         input=json.dumps(payload)+'\n',text=True,capture_output=True,
         env=env,timeout=10)
    must(proc.returncode==0 and proc.stdout.strip(),'independent_verifier_refused')
    return json.loads(proc.stdout.strip())
def commit(cid,proof):
    # SQL role is selected on the SCRATCH local PostgreSQL client connection.
    # Only the trusted public-key verifier pathway is granted this role.
    response=u.sql(cid,f"""SET ROLE lr_uat_ack_verifier;
      SELECT lr_uat_commit_signed_device_ack(
     {q(proof['requestId'])},{q(proof['grantId'])},
     {q(proof['signedLeaseDigest'])},{q(proof['deviceKeySha256'])},
     {q(proof['issuerKeySha256'])},{q(proof['nonceSha256'])},
     {int(proof['generation'])},{int(proof['grantRevision'])},
     {int(proof['claimSeq'])},{q(proof['ackSignature'])},
     {q(proof['ackPacketSha256'])})""")
    return response.splitlines()[-1]
def verify(cid,device):
    origin.verify(cid,device_key_sha256=device.identity['deviceKeySha256'])
    u.docker('exec','-i',cid,'psql','-X','-v','ON_ERROR_STOP=1',
      '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',data=publisher.SQL)
    u.docker('exec','-i',cid,'psql','-X','-v','ON_ERROR_STOP=1',
      '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',data=SQL)
    u.docker('exec','-i',cid,'psql','-X','-v','ON_ERROR_STOP=1',
      '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',data=ACL_SQL)
    print('ACK PASS 01 isolated DB origin, publisher, signed ACK and restricted ACL applied')
    perms=u.sql(cid,"""SELECT
      has_function_privilege('lr_uat_ack_verifier',
       'public.lr_uat_commit_signed_device_ack(text,text,text,text,text,text,bigint,bigint,bigint,text,text)','EXECUTE')::text
      ||':'||
      has_function_privilege('lr_uat_ack_untrusted',
       'public.lr_uat_commit_signed_device_ack(text,text,text,text,text,text,bigint,bigint,bigint,text,text)','EXECUTE')::text
      ||':'||
      has_function_privilege('lr_uat_ack_verifier',
       'public.lr_uat_ack_signed_lease(text,text,text,text,text)','EXECUTE')::text
      ||':'||
      has_table_privilege('lr_uat_ack_verifier',
       'public.lr_uat_device_ack_challenge','UPDATE')::text""")
    must(perms=='true:false:false:false','incorrect_restricted_function_acl')
    print('ACL PASS 01 verifier can call only signed-ACK wrapper; raw ACK and writes denied')
    for role in ['lr_uat_ack_untrusted','lr_uat_ack_verifier']:
      fails(cid,f"SET ROLE {role}; SELECT count(*) FROM lr_uat_device_enrolled_key",
       'permission denied for table')
      fails(cid,f"SET ROLE {role}; SELECT lr_uat_ack_signed_lease('x','y','z','w','v')",
       'permission denied for function')
    print('ACL PASS 02 neither verifier nor untrusted can read enrollment or call unsigned ACK')
    fails(cid,"SET ROLE lr_uat_ack_untrusted; SELECT lr_uat_issue_direct_owner_grant('x','y')",
      'permission denied for function')
    fails(cid,"SET ROLE lr_uat_ack_verifier; UPDATE lr_uat_device_ack_challenge SET consumed_at=now()",
      'permission denied for table')
    print('ACL PASS 03 direct grant mint and direct challenge update denied')
    for actor in ['lr_uat_ack_untrusted','lr_uat_ack_verifier']:
      must(u.sql(cid,f"SELECT rolcanlogin::text FROM pg_roles WHERE rolname='{actor}'")=='false',
       'test_principal_unexpected_login')
    must(u.sql(cid,"SELECT rolcanlogin::text FROM pg_roles WHERE rolname='lr_uat_ack_function_owner'")=='false',
         'privileged_function_owner_can_login')
    fails(cid,"""SET ROLE lr_uat_ack_untrusted;
      SELECT lr_uat_commit_signed_device_ack(
      'uat_request_invalid','uat_grant_invalid',
      repeat('a',64),repeat('b',64),repeat('c',64),repeat('d',64),
      1,1,1,repeat('A',86),repeat('f',64))""",
      'permission denied for function')
    print('ACL PASS 04 NOLOGIN roles and client direct signed-ACK invocation denied')
    row=publisher.claim(cid,'uat_worker_device','uat_claim_device_1234567890')
    must(row and row['out_generation']==4,'wrong_latest_generation')
    signed=publisher.sign(row)
    must(signed['packet']['payload']['deviceKeySha256']==device.identity['deviceKeySha256'],
      'signed_for_wrong_fake_device')
    u.sql(cid,f"""INSERT INTO lr_uat_issuer_pin(
       issuer_id,public_key_sha256,public_key_spki_b64url)
       VALUES('synthetic_only',{q(signed['issuerFingerprint'])},
       {q(signed['issuerPublicSpki'])})""")
    u.sql(cid,f"""UPDATE lr_uat_device_enrolled_key SET
       public_key_spki_b64url={q(device.identity['devicePublicSpki'])}
       WHERE device_id={q(row['out_device_id'])}""")
    must(publisher.finalize(cid,row,'uat_claim_device_1234567890',signed)==
      'SYNTHETIC_SIGNATURE_COMMITTED_PENDING_ACK','signed_lease_not_persisted')
    print('ACK PASS 02 enrolled fake device pin and issuer SPKI match signed lease')
    nonce=hashlib.sha256(os.urandom(32)).hexdigest()
    expiry=u.sql(cid,f"""SELECT lr_uat_issue_device_ack_challenge(
       {q(row['out_request_id'])},{q(row['out_grant_id'])},{q(nonce)})""")
    must(expiry.isdigit(),'challenge_not_issued')
    print('ACK PASS 03 server-side challenge issued only for current signed lease')
    db=context(cid,row['out_request_id'])
    must(db['devicePublicSpki']==device.identity['devicePublicSpki'] and
         db['issuerPublicSpki']==signed['issuerPublicSpki'] and
         db['nonceSha256']==nonce,'context_not_from_db')
    ack=device.ask({'action':'sign',
       'signedLease':signed['packet'],'issuerPublicSpki':db['issuerPublicSpki'],
       'challenge':{'nonceSha256':nonce,'expiresAtMs':int(expiry)}})
    must(ack.get('physicalExecutionAuthorized') is False and 'signedAck' in ack,
        'device_no_fake_proof')
    proof=verified(device,ack['signedAck'],signed['packet'],db)
    must(proof.get('decision')=='VERIFIED_FAKE_DEVICE_ACK' and
         proof.get('productionAckAuthorized') is False,'fake_ack_signature_not_verified')
    print('ACK PASS 04 ephemeral enrolled Ed25519 device signs, separate public verifier accepts')
    wrong={**ack['signedAck'],'payload':{
      **ack['signedAck']['payload'],'generation':99}}
    result=verified(device,wrong,signed['packet'],db)
    must(result['reason']=='DEVICE_SIGNATURE_INVALID','tampered_ack_accepted')
    print('ACK PASS 05 tampered generation invalidates real Ed25519 signature')
    other={**db,'nonceSha256':'c'*64}
    result=verified(device,ack['signedAck'],signed['packet'],other)
    must(result['reason']=='ACK_CHALLENGE_MISMATCH','forged_nonce_accepted')
    print('ACK PASS 06 changed independent database nonce cannot validate old ACK')
    u.sql(cid,f"""UPDATE lr_uat_device_enrolled_key SET state='revoked'
      WHERE device_id={q(row['out_device_id'])}""")
    result=verified(device,ack['signedAck'],signed['packet'],
      context(cid,row['out_request_id']))
    must(result['reason']=='ACK_REVOKED_OR_STALE','revoked_device_ack_accepted')
    fails(cid, f"""SELECT lr_uat_commit_signed_device_ack(
      {q(proof['requestId'])},{q(proof['grantId'])},
      {q(proof['signedLeaseDigest'])},{q(proof['deviceKeySha256'])},
      {q(proof['issuerKeySha256'])},{q(proof['nonceSha256'])},
      {proof['generation']},{proof['grantRevision']},{proof['claimSeq']},
      {q(proof['ackSignature'])},{q(proof['ackPacketSha256'])})""",
      'uat_signed_ack_state_fenced_or_unbound')
    u.sql(cid,f"""UPDATE lr_uat_device_enrolled_key SET state='active'
       WHERE device_id={q(row['out_device_id'])}""")
    print('ACK PASS 07 revoked enrolled fake device blocked both verifier and PG ACK')
    u.sql(cid,f"""UPDATE lr_uat_device_authority_floor
      SET generation=generation+1 WHERE device_id={q(row['out_device_id'])}""")
    result=verified(device,ack['signedAck'],signed['packet'],
      context(cid,row['out_request_id']))
    must(result['reason']=='ACK_REVOKED_OR_STALE','stale_generation_ack_accepted')
    fails(cid,f"""SELECT lr_uat_commit_signed_device_ack(
      {q(proof['requestId'])},{q(proof['grantId'])},
      {q(proof['signedLeaseDigest'])},{q(proof['deviceKeySha256'])},
      {q(proof['issuerKeySha256'])},{q(proof['nonceSha256'])},
      {proof['generation']},{proof['grantRevision']},{proof['claimSeq']},
      {q(proof['ackSignature'])},{q(proof['ackPacketSha256'])})""",
      'uat_signed_ack_state_fenced_or_unbound')
    u.sql(cid,f"""UPDATE lr_uat_device_authority_floor
      SET generation=generation-1 WHERE device_id={q(row['out_device_id'])}""")
    print('ACK PASS 08 newer device writer generation fences stale signed device ACK')
    must(commit(cid,proof)=='SIGNED_DEVICE_ACK_RECEIPT_COMMITTED_SYNTHETIC_ONLY',
      'atomic_signed_device_ack_missing')
    must(u.sql(cid,"SELECT count(*) FROM lr_uat_signed_device_ack_receipt")=='1',
      'missing_signed_proof_receipt')
    must(u.sql(cid,"SELECT count(*) FROM lr_uat_lease_delivery_ack")=='1',
      'missing_legacy_transaction_ack')
    must(u.sql(cid,f"""SELECT consumed_at IS NOT NULL FROM
      lr_uat_device_ack_challenge WHERE request_id={q(row['out_request_id'])}""")=='t',
      'challenge_not_consumed')
    print('ACK PASS 09 verified fake signed ACK, challenge consumption and delivery ACK committed atomically')
    must(commit(cid,proof)=='DEVICE_ACK_SIGNATURE_DUPLICATE_NOOP',
      'same_signature_replay_not_idempotent')
    print('ACK PASS 10 exact signed ACK retransmission idempotent after commit')
    inconsistent={**proof,'ackPacketSha256':'0'*64}
    fails(cid,f"""SELECT lr_uat_commit_signed_device_ack(
      {q(inconsistent['requestId'])},{q(inconsistent['grantId'])},
      {q(inconsistent['signedLeaseDigest'])},{q(inconsistent['deviceKeySha256'])},
      {q(inconsistent['issuerKeySha256'])},{q(inconsistent['nonceSha256'])},
      {inconsistent['generation']},{inconsistent['grantRevision']},
      {inconsistent['claimSeq']},{q(inconsistent['ackSignature'])},
      {q(inconsistent['ackPacketSha256'])})""",
      'uat_device_signed_ack_conflicting_replay')
    print('ACK PASS 11 conflicting fake ACK packet digest cannot overwrite receipt')
    must(u.sql(cid,"SELECT count(*) FROM lr_uat_signed_device_ack_receipt")=='1',
      'duplicate_crypto_ack')
    print('ACK PASS 12 exactly one fake signed proof and one ACK row persisted')
    u.sql(cid,"""REVOKE EXECUTE ON FUNCTION public.lr_uat_commit_signed_device_ack(
      text,text,text,text,text,text,bigint,bigint,bigint,text,text)
      FROM lr_uat_ack_verifier""")
    must(u.sql(cid,"""SELECT has_function_privilege('lr_uat_ack_verifier',
      'public.lr_uat_commit_signed_device_ack(text,text,text,text,text,text,bigint,bigint,bigint,text,text)',
      'EXECUTE')::text""")=='false','revocation_not_effective')
    fails(cid,f"""SET ROLE lr_uat_ack_verifier;
      SELECT lr_uat_commit_signed_device_ack(
      {q(proof['requestId'])},{q(proof['grantId'])},
      {q(proof['signedLeaseDigest'])},{q(proof['deviceKeySha256'])},
      {q(proof['issuerKeySha256'])},{q(proof['nonceSha256'])},
      {proof['generation']},{proof['grantRevision']},{proof['claimSeq']},
      {q(proof['ackSignature'])},{q(proof['ackPacketSha256'])})""",
      'permission denied for function')
    print('ACL PASS 05 verifier EXECUTE revoked and takes effect on a new session')
    u.sql(cid,"""GRANT EXECUTE ON FUNCTION public.lr_uat_commit_signed_device_ack(
      text,text,text,text,text,text,bigint,bigint,bigint,text,text)
      TO lr_uat_ack_verifier""")
    must(commit(cid,proof)=='DEVICE_ACK_SIGNATURE_DUPLICATE_NOOP',
      'restored_verifier_did_not_idempotently_read_receipt')
    print('ACL PASS 06 regrant restores only narrow ACK call, existing receipt unchanged')
    temp_shadow=u.sql(cid,f"""SET ROLE lr_uat_ack_verifier;
      CREATE TEMP TABLE lr_uat_device_ack_challenge(dummy int);
      SELECT lr_uat_commit_signed_device_ack(
      {q(proof['requestId'])},{q(proof['grantId'])},
      {q(proof['signedLeaseDigest'])},{q(proof['deviceKeySha256'])},
      {q(proof['issuerKeySha256'])},{q(proof['nonceSha256'])},
      {proof['generation']},{proof['grantRevision']},{proof['claimSeq']},
      {q(proof['ackSignature'])},{q(proof['ackPacketSha256'])})""")
    must('DEVICE_ACK_SIGNATURE_DUPLICATE_NOOP' in temp_shadow,
      'temp_schema_shadowed_privileged_function_table')
    print('ACL PASS 07 private SECURITY DEFINER path ignores client pg_temp table shadow')

def main():
    must(sys.argv[1:]==['--confirm-synthetic-only'],'requires_explicit_fixture_optin')
    must(re.fullmatch(r'lr-uat-move-[0-9a-f]{10}',u.BASE) is not None,
      'unsafe_compose_project')
    proj=u.BASE+'-src'
    started=False
    with EphemeralDevice() as device, tempfile.TemporaryDirectory(
      prefix='lr_rc50_device_ack_',dir=Path.home()) as temp:
      pg_env,redis_conf=u.prepare_configs(Path(temp)/'src','src')
      env=u.environment(pg_env,redis_conf)
      try:
        u.compose(proj,env,'up','-d','--pull','never','postgres')
        started=True
        cid=u.cid(proj,env,'postgres')
        u.healthy(cid)
        u.check_isolation(cid)
        u.migrations(cid)
        u.docker('exec','-i',cid,'psql','-X','-v','ON_ERROR_STOP=1',
           '-U',u.USER,'-d',u.DB,'-f','/dev/stdin',data=origin.SQL)
        verify(cid,device)
        print('RC50_DEVICE_ED25519_ACK_ISOLATED_PG_UAT_PASS production=false')
      finally:
        if started:
          u.compose(proj,env,'down','--volumes','--remove-orphans',timeout=90)
          print('RC50_DEVICE_SIGNED_ACK_PRIVATE_COMPOSE_CLEANED')

if __name__=='__main__':
  main()
