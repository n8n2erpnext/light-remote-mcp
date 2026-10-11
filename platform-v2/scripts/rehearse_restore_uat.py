#!/usr/bin/env python3
"""Temporary synthetic PG backup/restore rehearsal in isolated rc50 UAT container.

Creates TWO uniquely named scratch databases, applies frozen migration manifest,
adds fake Free usage, takes a logical custom-format backup *only of scratch source*,
restores into scratch destination and verifies event-level idempotency plus schema.
Both scratch databases are deleted after checking; persistent UAT DB is untouched.
"""
import json
import secrets
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CONTAINER='lightremote-rc50-v2-postgres-1'
ROLE='lr_rc50_uat'
PRIMARY='light_remote_rc50_uat'
RUNNER=ROOT/'scripts/migrations_uat.py'

def checked(args,input_bytes=None,timeout=120):
    process=subprocess.run(args,input=input_bytes,capture_output=True,timeout=timeout)
    if process.returncode:
        raise RuntimeError('UAT rehearsal failed: '+process.stderr.decode(errors='replace')[-750:])
    return process.stdout

def exec_docker(cmd,input_bytes=None,timeout=120):
    return checked(['docker','exec','-i',CONTAINER,*cmd],input_bytes,timeout)

def sql(db,statement):
    out=exec_docker(['psql','-X','-v','ON_ERROR_STOP=1','-U',ROLE,'-d',db,
      '-At','-c',statement])
    return out.decode().strip()

def create(db):
    exec_docker(['createdb','-U',ROLE,'-T','template0',db])

def delete(db):
    # Both generated names are known locally and must be owned by UAT test owner.
    owner=sql(PRIMARY,"SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='"+db+"'")
    if owner!=ROLE:raise RuntimeError('refusing_non_uat_owned_scratch_drop')
    exec_docker(['dropdb','-U',ROLE,'--if-exists',db])

def require(ok,message):
    if not ok:raise RuntimeError(message)

def main():
    # Prove the exact PG endpoint before any database create/drop/backup action.
    checked([sys.executable,str(RUNNER),'plan','--db',PRIMARY])
    # Verify source has ZERO synthetic/customer data (earlier UAT fixtures cleaned).
    row=sql(PRIMARY,"SELECT (SELECT count(*) FROM lr_accounts)::text||'|'||(SELECT count(*) FROM lr_usage_events)::text")
    require(row=='0|0','persistent_uat_not_empty_aborting_restore_rehearsal')
    suffix=secrets.token_hex(5)
    src='light_remote_rc50_restore_uat_'+suffix+'_src'
    dst='light_remote_rc50_restore_uat_'+suffix+'_dst'
    # The only databases that can be created/dropped here start with fixed
    # generated prefix and match the UAT migrator's strict allowlist.
    manifest_total=len(json.loads((ROOT/'sql/migrations.lock.json').read_text())['migrations'])
    created=[]
    try:
        create(src);created.append(src)
        checked([sys.executable,str(RUNNER),'apply','--db',src],timeout=180)
        checked([sys.executable,str(RUNNER),'verify','--db',src])
        synthetic=(
          "BEGIN;"
          "INSERT INTO lr_accounts(account_id,email,plan) VALUES('restore_owner','restore-owner@example.invalid','free');"
          "INSERT INTO lr_devices(device_id,owner_account_id) VALUES('restore_device','restore_owner');"
          "INSERT INTO lr_free_families(family_id) VALUES('restore_family');"
          "INSERT INTO lr_free_family_devices(device_id,family_id) VALUES('restore_device','restore_family');"
          "SELECT lr_charge_free_uat('restore_event_one','restore_owner','restore_device',NULL,'2026-10',1);"
          "COMMIT;")
        sql(src,synthetic)
        original=sql(src,"SELECT (SELECT count(*) FROM lr_usage_events)::text||'|'||(SELECT tool_calls FROM lr_free_family_monthly WHERE family_id='restore_family' AND month_key='2026-10')::text||'|'||(SELECT count(*) FROM lr_schema_migration_hashes)::text")
        require(original==f'1|1|{manifest_total}','source_fixture_not_consistent')
        backup=exec_docker(['pg_dump','-U',ROLE,'-d',src,'-Fc','--no-owner','--no-acl'],timeout=180)
        require(len(backup)>16000 and backup.startswith(b'PGDMP'),'invalid_custom_format_pg_dump')
        create(dst);created.append(dst)
        exec_docker(['pg_restore','-U',ROLE,'-d',dst,'--no-owner','--no-acl',
                     '--exit-on-error'],backup,timeout=180)
        checked([sys.executable,str(RUNNER),'verify','--db',dst])
        restored=sql(dst,"SELECT (SELECT count(*) FROM lr_usage_events)::text||'|'||(SELECT tool_calls FROM lr_free_family_monthly WHERE family_id='restore_family' AND month_key='2026-10')::text||'|'||(SELECT count(*) FROM lr_schema_migration_hashes)::text")
        require(restored==original,'restored_usage_or_manifest_differs')
        # Same event replays as duplicate; new event increments restored quota.
        duplicate=sql(dst,"SELECT lr_charge_free_uat('restore_event_one','restore_owner','restore_device',NULL,'2026-10',1)")
        require(duplicate=='f','restored_idempotency_failed')
        new=sql(dst,"SELECT lr_charge_free_uat('restore_event_two','restore_owner','restore_device',NULL,'2026-10',1)")
        require(new=='t','restored_quota_not_writable')
        total=sql(dst,"SELECT tool_calls FROM lr_free_family_monthly WHERE family_id='restore_family' AND month_key='2026-10'")
        require(total=='2','restored_quota_not_incremented')
        print(f'RC50_UAT_PG_BACKUP_RESTORE_PASS: manifest={manifest_total}, fixture=1 event, '+str(len(backup))+
              ' backup bytes, replay stable, new event charged; entirely scratch databases')
    finally:
        for name in reversed(created):
            delete(name)
        for name in created:
            require(sql(PRIMARY,"SELECT count(*) FROM pg_database WHERE datname='"+name+"'")=='0',
                'scratch_database_cleanup_failed')
        if created:print('RC50_UAT_SCRATCH_DB_CLEANUP_PASS')

if __name__=='__main__':
    try:main()
    except (RuntimeError,subprocess.TimeoutExpired) as error:
        print('RC50_UAT_BACKUP_RESTORE_FAILED: '+str(error),file=sys.stderr)
        sys.exit(1)
