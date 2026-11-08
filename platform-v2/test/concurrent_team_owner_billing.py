#!/usr/bin/env python3
"""Isolated UAT: concurrent owner-billed Team budget using synthetic identities.

This tests DB consistency only. It cannot prove real OAuth identity, signed
Local Wall A/B authorization or device OS fencing.
"""
from concurrent.futures import ThreadPoolExecutor
import subprocess
import uuid

DB="light_remote_rc50_uat"
C="lightremote-rc50-v2-postgres-1"
ROLE="lr_rc50_uat"  # UAT SQL fixture owner; NOT an application DB role.
tag="uat_teamcon_"+uuid.uuid4().hex[:12]
owner=tag+"_owner"; member=tag+"_member"
team=tag+"_team"; device=tag+"_device"; connection=tag+"_conn"
client=tag+"_client"; grant=tag+"_grant"; job=tag+"_job"; entitlement=tag+"_ent"

def q(s):return "'"+s.replace("'","''")+"'"
def run(sql):
    return subprocess.run(["docker","exec","-i",C,"psql","-X","-v","ON_ERROR_STOP=1",
          "-U",ROLE,"-d",DB,"-At","-c",sql],capture_output=True,text=True,timeout=40)
def checked(sql):
    r=run(sql)
    if r.returncode:raise RuntimeError(r.stderr.strip()[:450])
    return r.stdout.strip()
created=False
try:
    assert checked("SELECT current_database()")==DB,"Not an isolated UAT database"
    stmts="BEGIN;"
    stmts+=f"INSERT INTO lr_accounts(account_id,email,plan) VALUES({q(owner)},{q(owner+'@example.invalid')},'pro'),({q(member)},{q(member+'@example.invalid')},'free');"
    stmts+=f"INSERT INTO lr_devices(device_id,owner_account_id,state) VALUES({q(device)},{q(owner)},'online');"
    stmts+=f"INSERT INTO lr_teams(team_id,owner_account_id,seat_cap) VALUES({q(team)},{q(owner)},5);"
    stmts+=f"INSERT INTO lr_team_members(team_id,account_id,state) VALUES({q(team)},{q(member)},'active');"
    stmts+=f"INSERT INTO lr_entitlements(entitlement_id,owner_account_id,kind,source,valid_until) VALUES({q(entitlement)},{q(owner)},'pro_team','uat-fixture',now()+interval '2 hours');"
    stmts+=f"INSERT INTO lr_device_connections(connection_id,device_id,account_id,plan,hard_expires_at,reconnect_grace_ms) VALUES({q(connection)},{q(device)},{q(owner)},'pro',now()+interval '2 hours',1800000);"
    stmts+=f"INSERT INTO lr_agent_clients(client_session_id,account_id,agent_id,expires_at) VALUES({q(client)},{q(member)},{q(tag+'_agent')},now()+interval '2 hours');"
    stmts+=f"INSERT INTO lr_ab_grants(grant_id,account_id,device_id,connection_id,agent_id,purpose,approved_at,last_activity_at,idle_grace_ms,expires_at,absolute_expires_at) VALUES({q(grant)},{q(member)},{q(device)},{q(connection)},{q(tag+'_agent')},'team-member',now(),now(),1800000,now()+interval '1 hour',now()+interval '2 hours');"
    stmts+=f"INSERT INTO lr_jobs(job_id,owner_account_id,actor_account_id,device_id,operation_id) VALUES({q(job)},{q(owner)},{q(member)},{q(device)},{q(tag+'_op')});"
    stmts+=f"INSERT INTO lr_team_member_budgets(owner_account_id,month_key,call_limit) VALUES({q(owner)},'2026-10',3);COMMIT;"
    checked(stmts);created=True
    def charge(i):
        event=tag+"_evt_"+str(i)
        values=[event,owner,member,device,job,client,grant]
        sql="SELECT lr_charge_team_member_uat("+",".join(map(q,values))+",'2026-10',1);"
        r=run(sql)
        return event,r.returncode,r.stdout.strip(),r.stderr.strip()
    with ThreadPoolExecutor(max_workers=8) as executor:
        replies=list(executor.map(charge,range(8)))
    accepted=[r for r in replies if r[1]==0 and r[2]=="t"]
    rejected=[r for r in replies if r[1]!=0 and "team_member_monthly_budget_exceeded" in r[3]]
    unexpected=[r for r in replies if r not in accepted and r not in rejected]
    assert len(accepted)==3 and len(rejected)==5 and not unexpected,(accepted,rejected,unexpected)
    owner_total,member_total,entries=checked(
      f"SELECT (SELECT tool_calls FROM lr_usage_monthly WHERE owner_account_id={q(owner)} AND month_key='2026-10')::text||'|'||"
      f"(SELECT tool_calls FROM lr_team_member_monthly WHERE owner_account_id={q(owner)} AND month_key='2026-10')::text||'|'||"
      f"(SELECT count(*) FROM lr_usage_events WHERE owner_account_id={q(owner)} AND actor_account_id={q(member)});").split("|")
    assert (owner_total,member_total,entries)==("3","3","3")
    print("RC50_TEAM_OWNER_CONCURRENT_PASS: 8 member calls -> 3 accepted, 5 denied, owner charged 3")
    for event,_,_,_ in accepted:
        r=checked("SELECT lr_charge_team_member_uat("+",".join(map(q,[event,owner,member,device,job,client,grant]))+",'2026-10',1);")
        assert r=="f"
    print("RC50_TEAM_OWNER_REPLAY_PASS: 3 accepted events replay without increment")
finally:
    if created:
        stmts="BEGIN;"
        stmts+=f"DELETE FROM lr_usage_events WHERE owner_account_id={q(owner)};"
        stmts+=f"DELETE FROM lr_usage_monthly WHERE owner_account_id={q(owner)};"
        stmts+=f"DELETE FROM lr_team_member_monthly WHERE owner_account_id={q(owner)};"
        stmts+=f"DELETE FROM lr_team_member_budgets WHERE owner_account_id={q(owner)};"
        stmts+=f"DELETE FROM lr_jobs WHERE job_id={q(job)};"
        stmts+=f"DELETE FROM lr_ab_grants WHERE grant_id={q(grant)};"
        stmts+=f"DELETE FROM lr_agent_clients WHERE client_session_id={q(client)};"
        stmts+=f"DELETE FROM lr_device_connections WHERE connection_id={q(connection)};"
        stmts+=f"DELETE FROM lr_entitlements WHERE entitlement_id={q(entitlement)};"
        stmts+=f"DELETE FROM lr_team_members WHERE team_id={q(team)};"
        stmts+=f"DELETE FROM lr_teams WHERE team_id={q(team)};"
        stmts+=f"DELETE FROM lr_devices WHERE device_id={q(device)};"
        stmts+=f"DELETE FROM lr_accounts WHERE account_id IN ({q(owner)},{q(member)});COMMIT;"
        checked(stmts)
        assert checked(f"SELECT count(*) FROM lr_accounts WHERE account_id IN ({q(owner)},{q(member)})")=="0"
        assert checked(f"SELECT count(*) FROM lr_usage_events WHERE event_id LIKE {q(tag+'%')}")=="0"
        print("RC50_TEAM_OWNER_SYNTHETIC_CLEANUP_PASS")
