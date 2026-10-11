#!/usr/bin/env python3
"""Synthetic-only PostgreSQL contention test. Nothing touches production or live workers."""
from concurrent.futures import ThreadPoolExecutor
import subprocess, uuid

DB="light_remote_rc50_uat"
USER="lr_rc50_uat"  # isolated UAT DDL/test owner; not application credentials
CONTAINER="lightremote-rc50-v2-postgres-1"
prefix="uat_workers_"+uuid.uuid4().hex[:12]
owner=prefix+"_owner"
device=prefix+"_device"
jobs=[prefix+"_job_"+str(n) for n in range(8)]
events=[prefix+"_outbox_"+str(n) for n in range(8)]

def q(s):
    return "'"+s.replace("'","''")+"'"

def call(sql):
    p=subprocess.run(["docker","exec","-i",CONTAINER,"psql","-X","-v","ON_ERROR_STOP=1",
        "-U",USER,"-d",DB,"-At","-c",sql],capture_output=True,text=True,timeout=30)
    return p

def checked(sql):
    p=call(sql)
    if p.returncode: raise RuntimeError(p.stderr.strip()[:500])
    return p.stdout.strip()

provisioned=False
try:
    assert checked("SELECT current_database()")==DB,"refusing unexpected database"
    account=q(owner);dv=q(device)
    checked("BEGIN;"
       f"INSERT INTO lr_accounts(account_id,email,plan) VALUES({account},{q(owner+'@example.invalid')},'pro');"
       f"INSERT INTO lr_devices(device_id,owner_account_id,state) VALUES({dv},{account},'online');"
       +"INSERT INTO lr_worker_slots(device_id,slot_number) VALUES "+",".join(f"({dv},{n})" for n in (1,2,3))+";"
       +"INSERT INTO lr_jobs(job_id,owner_account_id,actor_account_id,device_id,operation_id) VALUES "
       +",".join(f"({q(j)},{account},{account},{dv},{q(prefix+'op'+str(i))})" for i,j in enumerate(jobs))+";"
       +"COMMIT;")
    provisioned=True

    def claim(item):
        i,job=item
        token=format(i+1,"x")*64
        result=call(f"SELECT slot_number,generation FROM lr_claim_worker_slot({dv},{q(job)},{q(token)},120);")
        return (job,result.returncode,result.stdout.strip(),result.stderr.strip())
    with ThreadPoolExecutor(max_workers=8) as executor:
        claims=list(executor.map(claim,enumerate(jobs)))
    failures=[x for x in claims if x[1] or ("ERROR:" in x[3])]
    assert not failures,failures
    winners=[x for x in claims if x[2]]
    losers=[x for x in claims if not x[2]]
    assert len(winners)==3 and len(losers)==5,(winners,losers)
    slots=[x[2].split("|")[0] for x in winners]
    assert len(set(slots))==3,slots
    assert checked(f"SELECT count(*) FROM lr_jobs WHERE device_id={dv} AND state='running'")=="3"
    print("RC50_WORKER_CONCURRENT_SLOTS_PASS: 8 requests -> 3 leased, 5 wait, unique slots")

    checked("BEGIN;INSERT INTO lr_outbox(topic,aggregate_id,payload) VALUES "
       +",".join(f"('uat_test',{q(e)},'{{}}'::jsonb)" for e in events)+";COMMIT;")
    def claim_message(i):
        out=call(f"SELECT outbox_id,lease_generation FROM lr_claim_outbox({q(prefix+'consumer'+str(i))},1,60);")
        return (i,out.returncode,out.stdout.strip(),out.stderr.strip())
    with ThreadPoolExecutor(max_workers=8) as executor:
        messages=list(executor.map(claim_message,range(8)))
    assert all(x[1]==0 and x[2] for x in messages),messages
    ids=[x[2].split("|")[0] for x in messages]
    assert len(set(ids))==8,ids
    print("RC50_OUTBOX_CONCURRENT_CLAIMS_PASS: 8 consumers -> 8 unique claimed messages")
finally:
    if provisioned:
        cleanup=("BEGIN;"
          f"DELETE FROM lr_outbox WHERE aggregate_id IN ({','.join(q(x) for x in events)});"
          f"DELETE FROM lr_worker_slots WHERE device_id={q(device)};"
          f"DELETE FROM lr_jobs WHERE device_id={q(device)};"
          f"DELETE FROM lr_devices WHERE device_id={q(device)};"
          f"DELETE FROM lr_accounts WHERE account_id={q(owner)};COMMIT;")
        checked(cleanup)
        counts=checked(f"SELECT (SELECT count(*) FROM lr_accounts WHERE account_id={q(owner)})"
         f"+(SELECT count(*) FROM lr_jobs WHERE device_id={q(device)})"
         f"+(SELECT count(*) FROM lr_outbox WHERE aggregate_id LIKE {q(prefix+'%')});")
        assert counts=="0","synthetic cleanup left rows"
        print("RC50_WORKER_OUTBOX_SYNTHETIC_CLEANUP_PASS")
