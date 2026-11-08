#!/usr/bin/env python3
"""UAT ONLY: real concurrent PostgreSQL seat requests with synthetic, disposable IDs.

Never reads/loads production JSON, PostgreSQL, OAuth, ERPNext or billing records.
The fixture has a unique uat_parallel_ prefix and is deleted in a finally block.
"""
from concurrent.futures import ThreadPoolExecutor
import subprocess
import uuid
import time

CONTAINER="lightremote-rc50-v2-postgres-1"
DB="light_remote_rc50_uat"
OWNER_ROLE="lr_rc50_uat"  # DATABASE OWNER role ONLY for isolated fixture test; not app credentials
SUFFIX=uuid.uuid4().hex[:12]
PREFIX=f"uat_parallel_{SUFFIX}"
OWNER=f"{PREFIX}_owner"
TEAM=f"{PREFIX}_team"
MEMBERS=[f"{PREFIX}_member_{i}" for i in range(8)]


def run(sql):
    result=subprocess.run(
        ["docker","exec","-i",CONTAINER,"psql","-X","-v","ON_ERROR_STOP=1",
         "-U",OWNER_ROLE,"-d",DB,"-At","-c",sql],
        capture_output=True,text=True,timeout=25)
    return result


def query(sql):
    result=run(sql)
    if result.returncode!=0:
        raise RuntimeError(result.stderr.strip()[:350])
    return result.stdout.strip()

def quote(text):
    return "'"+text.replace("'","''")+"'"

values=",".join(f"({quote(id)},{quote(id+'@example.invalid')},'free')" for id in [OWNER]+MEMBERS)
provisioned=False
try:
    if query("SELECT current_database()") != DB:
        raise RuntimeError("Fail closed: unexpected PostgreSQL target")
    query("BEGIN; INSERT INTO lr_accounts(account_id,email,plan) VALUES "+values+";"
          f"INSERT INTO lr_teams(team_id,owner_account_id,seat_cap) VALUES({quote(TEAM)},{quote(OWNER)},5); COMMIT;")
    provisioned=True
    def join(member):
        started=time.monotonic()
        result=run(f"INSERT INTO lr_team_members(team_id,account_id) VALUES({quote(TEAM)},{quote(member)});")
        return member,result.returncode,result.stderr,(time.monotonic()-started)
    with ThreadPoolExecutor(max_workers=8) as workers:
        result=list(workers.map(join,MEMBERS))
    succeeded=[x for x in result if x[1]==0]
    denied=[x for x in result if x[1]!=0 and "team_seat_capacity_exceeded" in x[2]]
    unexpected=[x for x in result if x not in succeeded and x not in denied]
    count=int(query(f"SELECT count(*) FROM lr_team_members WHERE team_id={quote(TEAM)} AND state='active'"))
    assert len(succeeded)==4,(len(succeeded),result)
    assert len(denied)==4,(len(denied),result)
    assert count==4, count
    assert not unexpected,unexpected
    print(f"RC50_TEAM_CONCURRENT_GUARD_PASS: 8 concurrent joins -> {len(succeeded)} accepted, {len(denied)} denied; owner+4 total")
finally:
    # Exact generated IDs only, never DELETE a table or a non-test account.
    if provisioned:
        cleanup=run(f"BEGIN; DELETE FROM lr_teams WHERE team_id={quote(TEAM)};"
            "DELETE FROM lr_accounts WHERE account_id IN ("+
            ",".join(quote(x) for x in [OWNER]+MEMBERS)+"); COMMIT;")
        if cleanup.returncode!=0:
            raise RuntimeError("Synthetic fixture cleanup FAILED: "+cleanup.stderr.strip()[:350])
        remaining=int(query("SELECT count(*) FROM lr_accounts WHERE account_id IN ("+
                       ",".join(quote(x) for x in [OWNER]+MEMBERS)+")"))
        assert remaining==0,"Synthetic account cleanup incomplete"
        print("RC50_CONCURRENCY_FIXTURE_CLEANUP_PASS: no synthetic accounts retained")
