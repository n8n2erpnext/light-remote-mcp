#!/usr/bin/env python3
"""Synthetic cold-move rehearsal: two completely separate private Compose stacks.

Migrates only synthetic PostgreSQL and Redis data. Never connects to production
or existing rc50-v2 UAT containers. Zero host-published ports. Creates random
project names, synthetic secrets, and isolated Docker volumes; deletes all on
successful completion / normal failure. Owner-approved UAT test ONLY.

Not proof of live A/B transport, legacy JSON state, DNS/TLS, host kernel,
agents, encryption key/certificate continuity, or zero-downtime migration.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time

ROOT=Path(__file__).resolve().parents[1]
COMPOSE=ROOT/'portability/compose.uat.yml'
MANIFEST=ROOT/'sql/migrations.lock.json'
BASE='lr-uat-move-'+secrets.token_hex(5)
USER='lr_rc50_uat'
DB='light_remote_rc50_uat'
PREFIX='movefixture_'+BASE.replace('-','_')
LIMIT_SECONDS=105

def must(ok,reason):
    if not ok:raise RuntimeError(reason)

def run(cmd,env=None,data=None,timeout=120):
    proc=subprocess.run(cmd,input=data,capture_output=True,env=env,timeout=timeout)
    if proc.returncode:
        # Do not echo secret environment or command args on failure.
        raise RuntimeError('test_command_failed:'+cmd[0]+':'+
                           proc.stderr.decode('utf8','replace')[-450:])
    return proc.stdout

def environment(envfile,redisconf):
    # No deployment/production env vars forwarded to the Compose project.
    return {'PATH':os.environ.get('PATH','/usr/bin:/bin'),
      'HOME':os.environ.get('HOME','/tmp'),
      'LR_PORTABLE_PG_ENV':str(envfile),
      'LR_PORTABLE_REDIS_CONF':str(redisconf)}

def compose(project,env,*args,timeout=120):
    must(re.fullmatch(r'lr-uat-move-[0-9a-f]{10}-(src|dst)',project),
         'refusing_non_synthetic_compose_project')
    return run(['docker','compose','-f',str(COMPOSE),'-p',project,*args],
               env=env,timeout=timeout).decode().strip()

def cid(project,env,service):
    out=compose(project,env,'ps','-a','-q',service)
    must(bool(out) and '\n' not in out,'missing_or_ambiguous_synthetic_container')
    return out

def docker(*args,data=None,timeout=120):
    return run(['docker',*args],data=data,timeout=timeout)

def healthy(container):
    end=time.monotonic()+LIMIT_SECONDS
    while time.monotonic()<end:
        status=docker('inspect',container,'--format','{{.State.Health.Status}}').decode().strip()
        if status=='healthy':return
        if status=='unhealthy':raise RuntimeError('synthetic_container_unhealthy')
        time.sleep(1)
    raise RuntimeError('synthetic_container_health_timeout')

def sql(container,statement):
    return docker('exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1',
      '-U',USER,'-d',DB,'-At','-c',statement).decode().strip()

def redis(container,command):
    # Credential is generated for scratch stack, read only INSIDE the synthetic
    # Redis container; never appears in stdout or Docker exec argv.
    script=(
      'pass="$(sed -n "s/^requirepass[[:space:]]\\{1,\\}//p" '
      '/usr/local/etc/redis/redis.conf)";'
      'test -n "$pass" || exit 21;'
      'export REDISCLI_AUTH="$pass";'
      'exec redis-cli --raw '+command)
    return docker('exec',container,'sh','-ec',script).decode().strip()

def prepare_configs(directory,label):
    directory.mkdir(mode=0o700)
    password=secrets.token_urlsafe(30)
    pg=directory/'pg.env'
    pg.write_text('POSTGRES_USER='+USER+'\nPOSTGRES_DB='+DB+
       '\nPOSTGRES_PASSWORD='+password+'\n')
    pg.chmod(0o600)
    conf=directory/'redis.conf'
    redis_pass=secrets.token_hex(24)
    conf.write_text('bind 0.0.0.0\nprotected-mode yes\nport 6379\n'+
       'requirepass '+redis_pass+'\ndir /data\nappendonly no\n'+
       'save 60 1\n')
    conf.chmod(0o600)
    return pg,conf

def check_isolation(container):
    info=json.loads(docker('inspect',container).decode())[0]
    ports=info['NetworkSettings']['Ports']
    must(all(not bind for bind in ports.values()),'published_synthetic_host_port')
    networks=info['NetworkSettings']['Networks']
    must(len(networks)==1,'unexpected_synthetic_network_count')
    name=next(iter(networks))
    config=json.loads(docker('network','inspect',name).decode())[0]
    must(config.get('Internal') is True,'synthetic_network_not_internal')

def migrations(container):
    manifest=json.loads(MANIFEST.read_text())
    must(manifest['target']=='synthetic UAT only' and
         len(manifest['migrations'])==13,'unexpected_migration_source')
    for item in manifest['migrations']:
        script=ROOT/'sql'/item['file']
        must(hashlib.sha256(script.read_bytes()).hexdigest()==item['sha256'],
             'migration_source_checksum_changed')
        docker('exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1',
          '-U',USER,'-d',DB,'-f','/dev/stdin',data=script.read_bytes())
    must(sql(container,'SELECT count(*) FROM lr_schema_migrations')=='13',
         'fresh_migrations_incomplete')
    return manifest

def seed(container):
    # All owner/device/grant/session IDs are invented for this isolated test.
    script=f"""
BEGIN;
INSERT INTO lr_accounts(account_id,email,plan)
 VALUES('{PREFIX}_owner','owner-{BASE}@example.invalid','free');
INSERT INTO lr_sessions(session_id,account_id,token_sha256,expires_at)
 VALUES('{PREFIX}_session','{PREFIX}_owner',repeat('a',64),now()+interval '3 hours');
INSERT INTO lr_devices(device_id,owner_account_id,state)
 VALUES('{PREFIX}_device','{PREFIX}_owner','offline');
INSERT INTO lr_device_connections(connection_id,device_id,account_id,plan,hard_expires_at,reconnect_grace_ms)
 VALUES('{PREFIX}_conn','{PREFIX}_device','{PREFIX}_owner','free',now()+interval '3 hours',1800000);
INSERT INTO lr_agent_clients(client_session_id,account_id,agent_id,expires_at,default_device_id)
 VALUES('{PREFIX}_client','{PREFIX}_owner','{PREFIX}_agent',now()+interval '3 hours','{PREFIX}_device');
INSERT INTO lr_ab_grants(grant_id,account_id,device_id,connection_id,agent_id,
 purpose,approved_at,last_activity_at,idle_grace_ms,expires_at,absolute_expires_at)
 VALUES('{PREFIX}_grant','{PREFIX}_owner','{PREFIX}_device','{PREFIX}_conn',
 '{PREFIX}_agent','device',now(),now(),1800000,now()+interval '1 hour',now()+interval '2 hours');
INSERT INTO lr_agent_bindings(client_session_id,device_id,grant_id,connection_id)
 VALUES('{PREFIX}_client','{PREFIX}_device','{PREFIX}_grant','{PREFIX}_conn');
INSERT INTO lr_jobs(job_id,owner_account_id,actor_account_id,device_id,operation_id,state)
 VALUES('{PREFIX}_job','{PREFIX}_owner','{PREFIX}_owner','{PREFIX}_device','{PREFIX}_operation','queued');
INSERT INTO lr_free_families(family_id) VALUES('{PREFIX}_family');
INSERT INTO lr_free_family_devices(device_id,family_id)
 VALUES('{PREFIX}_device','{PREFIX}_family');
SELECT lr_charge_free_uat('{PREFIX}_event1','{PREFIX}_owner',
 '{PREFIX}_device','{PREFIX}_job','2026-10',1);
SELECT lr_charge_free_uat('{PREFIX}_event2','{PREFIX}_owner',
 '{PREFIX}_device','{PREFIX}_job','2026-10',1);
SELECT lr_consume_oauth_once_uat(repeat('b',64),'refresh',
 '{PREFIX}_owner','{PREFIX}_oauth_client',
 (extract(epoch FROM clock_timestamp()+interval '2 hours'))::bigint);
COMMIT;
"""
    docker('exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1',
      '-U',USER,'-d',DB,'-f','/dev/stdin',data=script.encode())

def fingerprint(container):
    # Canonical fixture-only invariant snapshot (not a whole-DB digest).
    items=[
      ('account_id','lr_accounts','account_id'),
      ('session_id','lr_sessions','session_id'),
      ('device_id','lr_devices','device_id'),
      ('connection_id','lr_device_connections','connection_id'),
      ('grant_id','lr_ab_grants','grant_id'),
      ('client_session_id','lr_agent_clients','client_session_id'),
      ('job_id','lr_jobs','job_id'),
      ('event_id','lr_usage_events','event_id')
    ]
    snap={}
    for label,table,column in items:
        snap[label]=sql(container,f"SELECT {column} FROM {table} WHERE {column} LIKE '{PREFIX}%'")
    snap['bindings']=sql(container,
      f"SELECT count(*) FROM lr_agent_bindings WHERE client_session_id='{PREFIX}_client'")
    snap['family_calls']=sql(container,
      f"SELECT tool_calls FROM lr_free_family_monthly WHERE family_id='{PREFIX}_family' AND month_key='2026-10'")
    snap['account_calls']=sql(container,
      f"SELECT tool_calls FROM lr_usage_monthly WHERE owner_account_id='{PREFIX}_owner' AND month_key='2026-10'")
    snap['consumed_token']=sql(container,
      "SELECT count(*) FROM lr_oauth_one_time WHERE token_sha256=repeat('b',64) AND consumed_at IS NOT NULL")
    snap['versions']=sql(container,'SELECT count(*) FROM lr_schema_migrations')
    must(snap['family_calls']=='2' and snap['account_calls']=='2' and
         snap['consumed_token']=='1' and snap['versions']=='13' and
         snap['bindings']=='1' and
         all(snap[name] for name,*_ in items),'migration_snapshot_not_valid')
    return snap

def main():
    # Explicit owner-controlled UAT execution gate. Never call this accidentally
    # during a service deploy, import, upgrade or production migration.
    must(sys.argv[1:]==['--confirm-synthetic-only'],
         'explicit_synthetic_rehearsal_confirmation_required')
    projects=[]
    with tempfile.TemporaryDirectory(prefix='lr_rc50_cold_move_synthetic_') as temp:
      folder=Path(temp)
      src_pg,src_rc=prepare_configs(folder/'src','src')
      dst_pg,dst_rc=prepare_configs(folder/'dst','dst')
      env_src=environment(src_pg,src_rc);env_dst=environment(dst_pg,dst_rc)
      src=BASE+'-src';dst=BASE+'-dst'
      try:
        # Two independent Compose projects, unrelated volumes and distinct
        # synthetic credentials. Source stack will be stopped after dump.
        projects.append((src,env_src))
        compose(src,env_src,'up','-d','--pull','never')
        pg_src=cid(src,env_src,'postgres');rd_src=cid(src,env_src,'redis')
        healthy(pg_src);healthy(rd_src)
        check_isolation(pg_src);check_isolation(rd_src)
        migrations(pg_src)
        seed(pg_src)
        first=fingerprint(pg_src)
        key='lr:rc50:uat:move:'+BASE
        must(redis(rd_src,'SET '+key+' 7 EX 1200')=='OK','redis_seed_failed')
        # A consistent **planned write freeze**, not hot database migration.
        dump=docker('exec','-i',pg_src,'pg_dump','-U',USER,'-d',DB,'-Fc',
          '--no-owner','--no-acl')
        must(dump.startswith(b'PGDMP'),'invalid_pg_dump')
        must(redis(rd_src,'SAVE')=='OK','redis_snapshot_failed')
        snapshot=folder/'redis-synthetic-dump.rdb'
        docker('cp',rd_src+':/data/dump.rdb',str(snapshot))
        must(snapshot.stat().st_size>50,'redis_dump_missing')
        compose(src,env_src,'stop')
        print('RC50_COLD_MOVE_SOURCE_FREEZE_PASS')
        # Prepare entirely separate target stack; Postgres restore into its
        # empty DB, Redis RDB copied to a not-yet-started target container.
        projects.append((dst,env_dst))
        compose(dst,env_dst,'up','-d','--pull','never','postgres')
        pg_dst=cid(dst,env_dst,'postgres')
        healthy(pg_dst);check_isolation(pg_dst)
        docker('exec','-i',pg_dst,'pg_restore','-U',USER,'-d',DB,
          '--no-owner','--no-acl','--exit-on-error',data=dump)
        must(fingerprint(pg_dst)==first,'cross_compose_db_identity_drift')
        compose(dst,env_dst,'create','redis')
        rd_dst=cid(dst,env_dst,'redis')
        docker('cp',str(snapshot),rd_dst+':/data/dump.rdb')
        compose(dst,env_dst,'up','-d','--pull','never','redis')
        healthy(rd_dst);check_isolation(rd_dst)
        must(redis(rd_dst,'GET '+key)=='7','cross_compose_redis_state_lost')
        ttl=int(redis(rd_dst,'TTL '+key))
        must(ttl>0 and ttl<=1200,'cross_compose_redis_ttl_invalid')
        print('RC50_COLD_MOVE_CROSS_COMPOSE_RESTORE_PASS: 13 migrations, synthetic identity/grants/sessions/usage/OAuth replay and Redis TTL preserved')
        # Behavioral continuation on destination without cloning real jobs.
        must(sql(pg_dst,f"SELECT lr_charge_free_uat('{PREFIX}_event1','{PREFIX}_owner',"
          f"'{PREFIX}_device','{PREFIX}_job','2026-10',1)")=='f',
          'restored_usage_replay_double_charge')
        must(sql(pg_dst,f"SELECT lr_charge_free_uat('{PREFIX}_event3','{PREFIX}_owner',"
          f"'{PREFIX}_device','{PREFIX}_job','2026-10',1)")=='t',
          'new_usage_charge_failed')
        must(sql(pg_dst,'SELECT lr_consume_oauth_once_uat('+
          f"repeat('b',64),'refresh','{PREFIX}_owner','{PREFIX}_oauth_client',"+
          "(extract(epoch FROM clock_timestamp()+interval '2 hours'))::bigint)")=='f',
          'restored_refresh_replay_accepted')
        must(redis(rd_dst,'INCR '+key)=='8','restored_redis_counter_failed')
        print('RC50_COLD_MOVE_CONTINUITY_PASS: idempotent usage, OAuth replay and Redis counter continue on destination')
      finally:
        for project,env in reversed(projects):
          # Only random short-lived lr-uat-move-* synthetic projects.
          compose(project,env,'down','--volumes','--remove-orphans',timeout=90)
        if projects:
          print('RC50_COLD_MOVE_SYNTHETIC_STACKS_CLEANED')

if __name__=='__main__':
    try:main()
    except (RuntimeError,subprocess.TimeoutExpired,ValueError,AssertionError) as error:
      print('RC50_COLD_MOVE_UAT_FAIL: '+str(error),file=sys.stderr)
      sys.exit(1)
