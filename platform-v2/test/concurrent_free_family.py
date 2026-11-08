#!/usr/bin/env python3
"""Synthetic-only UAT: two Free accounts, separate devices, one proof-prelinked family.

Trust boundary: mapping inserted ONLY by fixture DB owner to model an independent
proof-verified enrollment. This code is NOT a user-facing device-family linking API.
"""
from concurrent.futures import ThreadPoolExecutor
import subprocess
import uuid

DB="light_remote_rc50_uat"
CONTAINER="lightremote-rc50-v2-postgres-1"
ROLE="lr_rc50_uat"  # privileged UAT fixture runner only, not app connection
tag="uat_freecon_"+uuid.uuid4().hex[:12]
family=tag+"_family"
accounts=[tag+"_owner_a",tag+"_owner_b"]
devices=[tag+"_device_a",tag+"_device_b"]
jobs=[tag+"_job_a",tag+"_job_b"]

def q(text):return "'"+text.replace("'","''")+"'"
def run(sql):
    return subprocess.run(
      ["docker","exec","-i",CONTAINER,"psql","-X","-v","ON_ERROR_STOP=1",
       "-U",ROLE,"-d",DB,"-At","-c",sql],
      capture_output=True,text=True,timeout=35)
def checked(sql):
    r=run(sql)
    if r.returncode:raise RuntimeError(r.stderr.strip()[:480])
    return r.stdout.strip()

created=False
try:
    assert checked("SELECT current_database()")==DB,"Unexpected target database"
    sql="BEGIN;"
    for i in range(2):
        sql+=f"INSERT INTO lr_accounts(account_id,email,plan) VALUES({q(accounts[i])},{q(accounts[i]+'@example.invalid')},'free');"
        sql+=f"INSERT INTO lr_devices(device_id,owner_account_id) VALUES({q(devices[i])},{q(accounts[i])});"
        sql+=f"INSERT INTO lr_jobs(job_id,owner_account_id,actor_account_id,device_id,operation_id) VALUES({q(jobs[i])},{q(accounts[i])},{q(accounts[i])},{q(devices[i])},{q(tag+'_op_'+str(i))});"
    sql+=f"INSERT INTO lr_free_families(family_id) VALUES({q(family)});"
    for i in range(2):
        sql+=f"INSERT INTO lr_free_family_devices(device_id,family_id) VALUES({q(devices[i])},{q(family)});"
    sql+=f"INSERT INTO lr_free_family_monthly(family_id,month_key,tool_calls) VALUES({q(family)},'2026-10',9994);COMMIT;"
    checked(sql);created=True
    def charge(i):
        owner=i%2;event=tag+"_evt_"+str(i)
        result=run("SELECT lr_charge_free_uat("+",".join([
          q(event),q(accounts[owner]),q(devices[owner]),q(jobs[owner]),"'2026-10'","1"])+");")
        return i,event,result.returncode,result.stdout.strip(),result.stderr.strip()
    with ThreadPoolExecutor(max_workers=16) as pool:
        replies=list(pool.map(charge,range(16)))
    accepted=[item for item in replies if item[2]==0 and item[3]=="t"]
    rejected=[item for item in replies if item[2]!=0 and "free_device_family_monthly_quota_exceeded" in item[4]]
    unexpected=[item for item in replies if item not in accepted and item not in rejected]
    assert len(accepted)==6 and len(rejected)==10 and not unexpected,(accepted,rejected,unexpected)
    count,actual=checked(f"SELECT (SELECT count(*) FROM lr_usage_events WHERE free_family_id={q(family)})||'|'||(SELECT tool_calls FROM lr_free_family_monthly WHERE family_id={q(family)} AND month_key='2026-10');").split("|")
    assert count=="6" and actual=="10000",(count,actual)
    totals=[int(checked(f"SELECT COALESCE(SUM(tool_calls),0) FROM lr_usage_monthly WHERE owner_account_id={q(account)} AND month_key='2026-10'")) for account in accounts]
    assert sum(totals)==6,totals
    print(f"RC50_FREE_FAMILY_CONCURRENT_PASS: 16 charges / 2 owners -> 6 accepted 10 rejected; owners={totals}; family=10000")
    # Every accepted event is idempotent even after family cap.
    for _,event,_,_,_ in accepted:
        i=int(event.rsplit("_",1)[1]);owner=i%2
        assert checked("SELECT lr_charge_free_uat("+",".join([
          q(event),q(accounts[owner]),q(devices[owner]),q(jobs[owner]),"'2026-10'","1"])+");")=="f"
    print("RC50_FREE_FAMILY_REPLAY_PASS: accepted events replay without double charging")
finally:
    if created:
        statements="BEGIN;"
        statements+=f"DELETE FROM lr_usage_events WHERE free_family_id={q(family)};"
        statements+=f"DELETE FROM lr_usage_monthly WHERE owner_account_id IN ({','.join(map(q,accounts))});"
        statements+=f"DELETE FROM lr_free_family_monthly WHERE family_id={q(family)};"
        statements+=f"DELETE FROM lr_free_family_devices WHERE family_id={q(family)};"
        statements+=f"DELETE FROM lr_jobs WHERE job_id IN ({','.join(map(q,jobs))});"
        statements+=f"DELETE FROM lr_devices WHERE device_id IN ({','.join(map(q,devices))});"
        statements+=f"DELETE FROM lr_free_families WHERE family_id={q(family)};"
        statements+=f"DELETE FROM lr_accounts WHERE account_id IN ({','.join(map(q,accounts))});COMMIT;"
        checked(statements)
        assert checked(f"SELECT COUNT(*) FROM lr_free_families WHERE family_id={q(family)}")=="0"
        assert checked(f"SELECT COUNT(*) FROM lr_accounts WHERE account_id IN ({','.join(map(q,accounts))})")=="0"
        assert checked(f"SELECT COUNT(*) FROM lr_usage_events WHERE event_id LIKE {q(tag+'%')}")=="0"
        print("RC50_FREE_FAMILY_SYNTHETIC_CLEANUP_PASS")
