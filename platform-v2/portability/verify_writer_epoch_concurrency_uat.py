#!/usr/bin/env python3
"""Run bounded PG concurrency UAT in the explicit rc50 isolated Docker project.

Not a migration, not production, not a cross-plane cutover. The test leaves
the private synthetic singleton FENCED, and never touches public tables/roles.
"""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
COMPOSE=ROOT/'compose.yml'
BASE=['docker','compose','-p','lightremote-rc50-v2','-f',str(COMPOSE)]
PSQL=BASE+['exec','-T','postgres','psql','-X','-v','ON_ERROR_STOP=1',
           '-At','-U','lr_rc50_uat','-d','light_remote_rc50_uat']
NS='lr_rc50_epoch_synthetic'
class UatFailure(RuntimeError):pass
def require(cond,why):
    if not cond:raise UatFailure(why)
def run(sql,timeout=20,check=True):
    r=subprocess.run(PSQL+['-c',sql],capture_output=True,text=True,timeout=timeout)
    if check and r.returncode!=0:
        raise UatFailure('uat_psql_failure '+r.stderr.strip()[-250:])
    return r
def scalar(sql):
    return run(sql).stdout.strip().splitlines()[-1]
def preflight():
    require(COMPOSE.is_file() and 'lightremote-rc50-v2' in COMPOSE.read_text(),
            'wrong_compose_project')
    p=subprocess.run(BASE+['ps','--format','json'],capture_output=True,text=True,timeout=15)
    require(p.returncode==0,'uat_compose_ps_failed')
    rows=[json.loads(line) for line in p.stdout.splitlines() if line.strip()]
    pg=[r for r in rows if r.get('Service')=='postgres']
    require(len(pg)==1 and pg[0].get('Project')=='lightremote-rc50-v2'
            and pg[0].get('Health')=='healthy'
            and all(x.get('PublishedPort') in (0,None) for x in pg[0].get('Publishers',[])),
            'uat_compose_not_isolated')
    require(scalar('SELECT current_database()')=='light_remote_rc50_uat',
            'wrong_database')
    require(scalar('SELECT current_user')=='lr_rc50_uat','wrong_role')
    require(scalar(f"SELECT COALESCE(to_regnamespace('{NS}')::text,'ABSENT')")==NS,
            'uat_epoch_schema_missing')
def state():
    rows=scalar(f"SELECT generation||'|'||state||'|'||COALESCE(holder,'') FROM {NS}.writer_authority WHERE id=1").split('|')
    require(len(rows)==3,'bad_epoch_state')
    return int(rows[0]),rows[1],rows[2]
def main():
    preflight()
    gen,status,_=state()
    require(status=='fenced','uat_writer_must_begin_fenced')
    start=lambda h:run(f"SELECT {NS}.start_writer_uat('{h}',{gen},60)",check=False)
    # Two independent docker/psql processes race on the same DB singleton.
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(start,h) for h in ('uat_race_alpha','uat_race_beta')]
        results=[f.result(timeout=30) for f in futures]
    require(sorted([r.returncode for r in results])==[0,1],
            'concurrent_single_writer_not_enforced')
    winner='uat_race_alpha' if results[0].returncode==0 else 'uat_race_beta'
    loser='uat_race_beta' if winner=='uat_race_alpha' else 'uat_race_alpha'
    active,phase,holder=state()
    require(active==gen+1 and phase=='active' and holder==winner,
            'winner_generation_mismatch')
    require(scalar(f"SELECT {NS}.assert_writer_uat('{winner}',{active})")=='t',
            'winner_not_accepted')
    require(scalar(f"SELECT {NS}.assert_writer_uat('{loser}',{active})")=='f',
            'loser_was_accepted')

    # The row-share guard holds until COMMIT; fence must wait for that transaction.
    hold=(f"BEGIN;\nSELECT {NS}.assert_writer_uat('{winner}',{active});\n"
          "SELECT pg_sleep(2.5);\nCOMMIT;\n")
    sleeper=subprocess.Popen(PSQL+['-f','-'],stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        sleeper.stdin.write(hold)
        sleeper.stdin.close()
        require(sleeper.stdout.readline().strip()=='BEGIN','hold_transaction_missing_begin')
        require(sleeper.stdout.readline().strip()=='t','hold_did_not_pass_writer_guard')
        time.sleep(0.2)
        start_time=time.monotonic()
        fenced=int(scalar(f"SELECT {NS}.fence_writer_uat({active})"))
        elapsed=time.monotonic()-start_time
        require(elapsed>=1.15,'fence_did_not_wait_for_admitted_transaction')
        require(sleeper.wait(timeout=8)==0,'holding_transaction_failed')
        require(fenced==active+1,'fence_generation_not_monotonic')
        require(scalar(f"SELECT {NS}.assert_writer_uat('{winner}',{active})")=='f',
                'stale_writer_after_fence')
        # No automatic takeover until an explicit, generation-bound new start.
        nextgen=int(scalar(f"SELECT {NS}.start_writer_uat('{loser}',{fenced},60)"))
        require(nextgen==fenced+1,'new_writer_generation_invalid')
        require(scalar(f"SELECT {NS}.assert_writer_uat('{winner}',{active})")=='f',
                'old_writer_resurrected')
        # Cleanly leave the synthetic authority fenced for next run.
        final=int(scalar(f"SELECT {NS}.fence_writer_uat({nextgen})"))
        g,st,_=state()
        require(g==final and st=='fenced','fixture_not_fenced_on_exit')
        print('RC50_PG_WRITER_EPOCH_CONCURRENCY_PASS '+json.dumps({
            'two_psql_processes':True,'one_winner':True,
            'foreign_writer_rejected':True,
            'fence_waits_on_db_transaction':True,'fence_wait_seconds':round(elapsed,3),
            'old_writer_rejected_after_turnover':True,'final_state':'fenced',
            'production_authorized':False
        },sort_keys=True))
    finally:
        if sleeper.poll() is None:
            sleeper.kill();sleeper.wait(timeout=5)
if __name__=='__main__':
    try:main()
    except (UatFailure,subprocess.TimeoutExpired,ValueError,IndexError) as e:
        print('RC50_PG_WRITER_EPOCH_CONCURRENCY_FAIL '+str(e),file=sys.stderr)
        sys.exit(1)
