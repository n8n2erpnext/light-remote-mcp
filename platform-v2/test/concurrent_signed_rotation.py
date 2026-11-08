#!/usr/bin/env python3
"""Synthetic UAT PostgreSQL rotation race. Server-side crypto verification is
tested in Node.js separately; this script tests DB one-time/family fencing only.
Never loads production records or connects via live application credentials.
"""
from concurrent.futures import ThreadPoolExecutor
import subprocess, uuid

DB="light_remote_rc50_uat"
C="lightremote-rc50-v2-postgres-1"
ROLE="lr_rc50_uat" # UAT schema/fixture-only owner, not an app account
tag="uat_rotrace_"+uuid.uuid4().hex[:12]
owner=tag+"_owner"; old=tag+"_old";new=tag+"_new";fam=tag+"_family"
challenges=[tag+"_challenge_0",tag+"_challenge_1"]
def q(s):return "'"+s.replace("'","''")+"'"
def query(sql):
 return subprocess.run(["docker","exec","-i",C,"psql","-X","-v","ON_ERROR_STOP=1",
   "-U",ROLE,"-d",DB,"-At","-c",sql],capture_output=True,text=True,timeout=30)
def checked(sql):
 r=query(sql)
 if r.returncode:raise RuntimeError(r.stderr.strip()[:450])
 return r.stdout.strip()

made=False
try:
 assert checked("SELECT current_database()")==DB
 sql="BEGIN;"
 sql+=f"INSERT INTO lr_accounts(account_id,email,plan) VALUES({q(owner)},{q(owner+'@example.invalid')},'free');"
 sql+=f"INSERT INTO lr_devices(device_id,owner_account_id) VALUES({q(old)},{q(owner)}),({q(new)},{q(owner)});"
 sql+=f"INSERT INTO lr_device_identity_keys_uat(device_id,public_spki_base64,public_key_sha256) VALUES({q(old)},repeat('a',70),repeat('a',64)),({q(new)},repeat('b',70),repeat('b',64));"
 sql+=f"INSERT INTO lr_free_families(family_id) VALUES({q(fam)});"
 sql+=f"INSERT INTO lr_free_family_devices(device_id,family_id) VALUES({q(old)},{q(fam)});"
 for i,challenge in enumerate(challenges):
  sql+=f"INSERT INTO lr_free_rotation_challenges(challenge_id,old_device_id,new_device_id,old_owner_account_id,new_owner_account_id,source_family_id,old_key_sha256,new_key_sha256,nonce_sha256,expires_at) VALUES({q(challenge)},{q(old)},{q(new)},{q(owner)},{q(owner)},{q(fam)},repeat('a',64),repeat('b',64),repeat({q(str(i+1))},64),now()+interval '2 minutes');"
 sql+="COMMIT;"
 checked(sql);made=True
 def finalize(i):
  r=query(f"SELECT lr_finalize_free_rotation_uat({q(challenges[i])},repeat({q(str(i+1))},64),repeat('a',64),repeat('b',64));")
  return i,r.returncode,r.stdout.strip(),r.stderr.strip()
 with ThreadPoolExecutor(max_workers=2) as pool:
  attempts=list(pool.map(finalize,range(2)))
 winners=[x for x in attempts if x[1]==0 and x[2]=='t']
 blocked=[x for x in attempts if x[1]!=0 and 'rotation_target_already_family_bound' in x[3]]
 assert len(winners)==1 and len(blocked)==1,attempts
 assert checked(f"SELECT count(*) FROM lr_free_family_devices WHERE device_id={q(new)}")=="1"
 assert checked(f"SELECT count(*) FROM lr_free_rotation_audit WHERE challenge_id IN ({','.join(map(q,challenges))})")=="1"
 print("RC50_ROTATION_CONCURRENT_DB_PASS: 2 parallel claims -> 1 linked, 1 denied; one audit")
finally:
 if made:
  sql="BEGIN;"
  sql+=f"DELETE FROM lr_free_rotation_audit WHERE challenge_id IN ({','.join(map(q,challenges))});"
  sql+=f"DELETE FROM lr_free_rotation_challenges WHERE challenge_id IN ({','.join(map(q,challenges))});"
  sql+=f"DELETE FROM lr_free_family_devices WHERE device_id IN ({q(old)},{q(new)});"
  sql+=f"DELETE FROM lr_free_families WHERE family_id={q(fam)};"
  sql+=f"DELETE FROM lr_device_identity_keys_uat WHERE device_id IN ({q(old)},{q(new)});"
  sql+=f"DELETE FROM lr_devices WHERE device_id IN ({q(old)},{q(new)});"
  sql+=f"DELETE FROM lr_accounts WHERE account_id={q(owner)};COMMIT;"
  checked(sql)
  assert checked(f"SELECT count(*) FROM lr_free_rotation_challenges WHERE challenge_id IN ({','.join(map(q,challenges))})")=="0"
  assert checked(f"SELECT count(*) FROM lr_accounts WHERE account_id={q(owner)}")=="0"
  print("RC50_ROTATION_RACE_CLEANUP_PASS")
