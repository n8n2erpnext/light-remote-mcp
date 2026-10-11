#!/usr/bin/env python3
"""Real concurrent SQL-connection contention for rc50-v2 OAuth jti ledger.
Standalone synthetic SQL-fixture test only. No API app role, production OAuth
tokens, client secrets, customer data, or HTTP requests.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import subprocess
import uuid
from datetime import datetime, timedelta, timezone

DB="light_remote_rc50_uat"
CONTAINER="lightremote-rc50-v2-postgres-1"
ROLE="lr_rc50_uat" # isolated SQL fixture administrator, NEVER application runtime
tag="uat_oauthcon_"+uuid.uuid4().hex[:12]
owner=tag+"_owner"
client=tag+"_client"

def q(value):
    return "'"+value.replace("'","''")+"'"

def run(sql):
    return subprocess.run(["docker","exec","-i",CONTAINER,"psql","-X",
       "-v","ON_ERROR_STOP=1","-U",ROLE,"-d",DB,"-At","-c",sql],
       capture_output=True,text=True,timeout=35)

def checked(sql):
    p=run(sql)
    if p.returncode:
        raise RuntimeError(p.stderr.strip()[-500:])
    return p.stdout.strip()

def digest(purpose):
    return hashlib.sha256((tag+"\0"+purpose).encode()).hexdigest()

def request(purpose,expiry,i):
    account="NULL" if purpose=="resume" else q(owner)
    call=("SELECT lr_consume_oauth_once_uat("+",".join([
      q(digest(purpose)),q(purpose),account,q(client),str(expiry)])+");")
    result=run(call)
    return i,result.returncode,result.stdout.strip(),result.stderr.strip()

made=False
try:
    assert checked("SELECT current_database()")==DB,"Refusing to run outside UAT"
    checked(f"INSERT INTO lr_accounts(account_id,email,plan) VALUES({q(owner)},{q(owner+'@example.invalid')},'free');")
    made=True
    now=datetime.now(timezone.utc)
    for purpose,delta in [
      ('authorization_code',90),
      ('refresh',7200),
      ('resume',900)
    ]:
        expiration=int((now+timedelta(seconds=delta)).timestamp())
        with ThreadPoolExecutor(max_workers=16) as workers:
            attempts=list(workers.map(lambda i:request(purpose,expiration,i),range(16)))
        accepted=[x for x in attempts if x[1]==0 and x[2]=="t"]
        duplicate=[x for x in attempts if x[1]==0 and x[2]=="f"]
        unexpected=[x for x in attempts if x not in accepted and x not in duplicate]
        assert len(accepted)==1 and len(duplicate)==15 and not unexpected,attempts
        assert checked(f"SELECT count(*) FROM lr_oauth_one_time WHERE token_sha256={q(digest(purpose))} AND purpose={q(purpose)} AND consumed_at IS NOT NULL")=="1"
        print(f"RC50_OAUTH_{purpose.upper()}_CONCURRENT_PASS: 16 competing connections -> 1 accepted / 15 replay rejected")

    assert checked(f"SELECT count(*) FROM lr_oauth_one_time WHERE client_id={q(client)}")=="3"
    print("RC50_OAUTH_THREE_PURPOSES_ATOMIC_LEDGER_PASS")
finally:
    if made:
        # Only generated test-owned rows, no global TRUNCATE or mass-delete.
        checked("BEGIN;"
           f"DELETE FROM lr_oauth_one_time WHERE client_id={q(client)};"
           f"DELETE FROM lr_accounts WHERE account_id={q(owner)};"
           "COMMIT;")
        assert checked(f"SELECT count(*) FROM lr_oauth_one_time WHERE client_id={q(client)}")=="0"
        assert checked(f"SELECT count(*) FROM lr_accounts WHERE account_id={q(owner)}")=="0"
        print("RC50_OAUTH_SYNTHETIC_CLEANUP_PASS")
