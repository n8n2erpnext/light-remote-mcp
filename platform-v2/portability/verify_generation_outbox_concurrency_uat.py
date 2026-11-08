#!/usr/bin/env python3
"""Two-process synthetic command claim UAT on isolated rc50 PG only.

No command execution. Does not touch public tables, production or migrations.
This test intentionally writes then deletes a single uniquely named FAKE command
and returns the private UAT authority to FENCED.
"""
import concurrent.futures
import json
from pathlib import Path
import re
import subprocess
import sys
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[1]
COMPOSE=ROOT/'compose.yml'
BASE=['docker','compose','-p','lightremote-rc50-v2','-f',str(COMPOSE)]
PSQL=BASE+['exec','-T','postgres','psql','-X','-v','ON_ERROR_STOP=1','-At',
           '-U','lr_rc50_uat','-d','light_remote_rc50_uat']
SCHEMA='lr_rc50_epoch_synthetic'
class UatFailure(RuntimeError):pass
def require(ok,why):
    if not ok:raise UatFailure(why)
def sql(command,check=True):
    result=subprocess.run(PSQL+['-c',command],text=True,capture_output=True,timeout=22)
    if check and result.returncode:
        raise UatFailure('uat_sql_error:'+result.stderr.strip()[-180:])
    return result
def scalar(command):
    lines=sql(command).stdout.strip().splitlines()
    require(bool(lines),'missing_psql_result')
    return lines[-1].strip()
def preflight():
    require(COMPOSE.is_file() and 'name: lightremote-rc50-v2' in COMPOSE.read_text(),
            'wrong_compose')
    scan=subprocess.run(BASE+['ps','--format','json'],capture_output=True,text=True,timeout=15)
    require(scan.returncode==0,'compose_inspect_failed')
    matches=[json.loads(row) for row in scan.stdout.splitlines() if row.strip()]
    pg=[row for row in matches if row.get('Service')=='postgres']
    require(len(pg)==1 and pg[0].get('Project')=='lightremote-rc50-v2'
      and pg[0].get('Health')=='healthy'
      and all(v.get('PublishedPort') in (0,None) for v in pg[0].get('Publishers',[])),
      'postgres_unsafe_or_not_isolated')
    require(scalar('SELECT current_database()')=='light_remote_rc50_uat','wrong_db')
    require(scalar('SELECT current_user')=='lr_rc50_uat','wrong_db_role')
    require(scalar(f"SELECT state FROM {SCHEMA}.writer_authority WHERE id=1")=='fenced',
            'writer_not_fenced_at_entry')
    require(scalar(f"SELECT COALESCE(to_regclass('{SCHEMA}.command_outbox')::text,'ABSENT')")==
            SCHEMA+'.command_outbox','synthetic_outbox_missing')

def main():
    preflight()
    suffix=uuid4().hex[:14]
    cmd='uat_cmd_race_'+suffix
    holder='uat_race_writer'
    a='uat_consumer_a_'+suffix
    b='uat_consumer_b_'+suffix
    tag_a='uat_tag_race_a_'+suffix
    tag_b='uat_tag_race_b_'+suffix
    generation=None
    try:
        current=int(scalar(f'SELECT generation FROM {SCHEMA}.writer_authority WHERE id=1'))
        generation=int(scalar(f"SELECT {SCHEMA}.start_writer_uat('{holder}',{current},60)"))
        require(generation==current+1,'generation_not_monotonic')
        require(scalar(f"SELECT {SCHEMA}.enqueue_command_uat("
                f"'{holder}',{generation},'{cmd}','fake_fleet',"
                f"""'{{"test":"generation_only"}}'::jsonb)""")=='queued',
                'fake_enqueue_failed')
        def claim(consumer,tag):
            return sql(f"SELECT out_command_id FROM {SCHEMA}.claim_command_uat("
                       f"'{holder}',{generation},'{consumer}','{tag}',60)",check=False)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(claim,a,tag_a),pool.submit(claim,b,tag_b)]
            results=[f.result(timeout=27) for f in futures]
        require(all(x.returncode==0 for x in results),'concurrent_claim_sql_error')
        accepted=[i for i,x in enumerate(results) if x.stdout.strip()==cmd]
        require(len(accepted)==1,'concurrent_claim_not_single_delivery')
        winner=a if accepted[0]==0 else b
        tag=tag_a if accepted[0]==0 else tag_b
        require(scalar(f"SELECT {SCHEMA}.ack_command_uat("
          f"'{holder}',{generation},'{cmd}','{winner}','{tag}')")=='t',
          'ack_denied_for_winner')
        require(scalar(f"SELECT {SCHEMA}.ack_command_uat("
          f"'{holder}',{generation},'{cmd}','{winner}','{tag}')")=='f',
          'duplicate_ack_accepted')
        print('RC50_GENERATION_OUTBOX_CONCURRENCY_PASS '+json.dumps({
          'two_independent_psql_claims':True,'unique_claim_winner':True,
          'duplicate_ack_denied':True,'fake_command_only':True,
          'cross_plane_cutover_proven':False},sort_keys=True))
    finally:
        # Clean up ONLY our uniquely named synthetic command ID; never public tables.
        if re.fullmatch(r'uat_cmd_race_[a-f0-9]{14}',cmd):
            sql(f"DELETE FROM {SCHEMA}.command_outbox WHERE command_id='{cmd}'",check=False)
        if generation is not None:
            current_state=scalar(f"SELECT generation||'|'||state FROM {SCHEMA}.writer_authority WHERE id=1")
            if current_state==str(generation)+'|active':
                sql(f'SELECT {SCHEMA}.fence_writer_uat({generation})')
        require(scalar(f"SELECT state FROM {SCHEMA}.writer_authority WHERE id=1")=='fenced',
                'uat_authority_not_fenced_on_exit')
if __name__=='__main__':
    try:main()
    except (UatFailure,subprocess.TimeoutExpired,ValueError,IndexError) as e:
        print('RC50_GENERATION_OUTBOX_CONCURRENCY_FAIL '+str(e),file=sys.stderr)
        sys.exit(1)
