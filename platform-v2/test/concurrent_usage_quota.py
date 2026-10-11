#!/usr/bin/env python3
"""Real PostgreSQL UAT concurrent quota test. Uses generated synthetic fixtures ONLY."""
from concurrent.futures import ThreadPoolExecutor
import subprocess,uuid
DB="light_remote_rc50_uat"
C="lightremote-rc50-v2-postgres-1"
role="lr_rc50_uat"   # UAT-only SQL fixture owner, never an app connection
tag="uat_quota_"+uuid.uuid4().hex[:12]
owner=tag+"_owner";device=tag+"_device";job=tag+"_job"
def q(s): return "'"+s.replace("'","''")+"'"
def run(sql):
    return subprocess.run(["docker","exec","-i",C,"psql","-X","-v","ON_ERROR_STOP=1",
        "-U",role,"-d",DB,"-At","-c",sql],capture_output=True,text=True,timeout=35)
def checked(sql):
    r=run(sql)
    if r.returncode:raise RuntimeError(r.stderr.strip()[:450])
    return r.stdout.strip()
created=False
try:
    assert checked("SELECT current_database()")==DB,"refuse non-UAT database"
    checked("BEGIN;"
        f"INSERT INTO lr_accounts(account_id,email,plan) VALUES({q(owner)},{q(owner+'@example.invalid')},'pro');"
        f"INSERT INTO lr_devices(device_id,owner_account_id) VALUES({q(device)},{q(owner)});"
        f"INSERT INTO lr_jobs(job_id,owner_account_id,actor_account_id,device_id,operation_id) VALUES({q(job)},{q(owner)},{q(owner)},{q(device)},{q(tag+'_op')});"
        f"INSERT INTO lr_usage_budgets(owner_account_id,month_key,call_limit) VALUES({q(owner)},'2026-10',6);COMMIT;")
    created=True
    def charge(i):
        event=tag+"_event_"+str(i)
        r=run("SELECT lr_charge_usage_uat("+",".join([
          q(event),q(owner),q(owner),q(device),q(job),"'2026-10'","1"])+") AS charged;")
        return (event,r.returncode,r.stdout.strip(),r.stderr.strip())
    with ThreadPoolExecutor(max_workers=16) as workers:
        replies=list(workers.map(charge,range(16)))
    ok=[row for row in replies if row[1]==0 and row[2]=="t"]
    rejected=[row for row in replies if row[1]!=0 and "monthly_call_quota_exceeded" in row[3]]
    other=[row for row in replies if row not in ok and row not in rejected]
    assert len(ok)==6 and len(rejected)==10 and not other,(ok,rejected,other)
    events,total=checked(f"SELECT (SELECT count(*) FROM lr_usage_events WHERE owner_account_id={q(owner)})::text||'|'||(SELECT tool_calls FROM lr_usage_monthly WHERE owner_account_id={q(owner)} AND month_key='2026-10')::text;").split("|")
    assert events=="6" and total=="6",(events,total)
    print("RC50_USAGE_QUOTA_CONCURRENCY_PASS: 16 simultaneous charges -> 6 accepted, 10 quota rejects, 6 charged")

    # Every accepted event remains idempotent regardless of budget exhaustion.
    for event,*_ in ok:
        assert checked("SELECT lr_charge_usage_uat("+",".join([
          q(event),q(owner),q(owner),q(device),q(job),"'2026-10'","1"])+")")=="f"
    assert checked(f"SELECT tool_calls FROM lr_usage_monthly WHERE owner_account_id={q(owner)} AND month_key='2026-10'")=="6"
    print("RC50_USAGE_EVENT_REPLAY_PASS: all 6 accepted events replay as duplicate, no extra quota")
finally:
    if created:
        checked("BEGIN;"
          f"DELETE FROM lr_usage_events WHERE owner_account_id={q(owner)};"
          f"DELETE FROM lr_usage_monthly WHERE owner_account_id={q(owner)};"
          f"DELETE FROM lr_usage_budgets WHERE owner_account_id={q(owner)};"
          f"DELETE FROM lr_jobs WHERE job_id={q(job)};"
          f"DELETE FROM lr_devices WHERE device_id={q(device)};"
          f"DELETE FROM lr_accounts WHERE account_id={q(owner)};COMMIT;")
        assert checked(f"SELECT COUNT(*) FROM lr_accounts WHERE account_id={q(owner)}")=="0"
        assert checked(f"SELECT COUNT(*) FROM lr_usage_events WHERE owner_account_id={q(owner)}")=="0"
        print("RC50_USAGE_SYNTHETIC_FIXTURE_CLEANUP_PASS")
