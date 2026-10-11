#!/usr/bin/env python3
"""rc50-v2 UAT-only immutable migration runner.

--plan is read-only. --apply only adds missing versions.
--attest-existing is a one-time explicit declaration that a *legacy synthetic UAT*
database already has matching migration version numbers; it cannot prove that
historical SQL is identical to its original execution. Rehearse from scratch first.

NEVER use this for a live/production DB or with application credentials.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MANIFEST=ROOT/'sql/migrations.lock.json'
CONTAINER='lightremote-rc50-v2-postgres-1'
MIGRATOR='lr_rc50_uat'
PRIMARY='light_remote_rc50_uat'
RESTORE_RE=re.compile(r'^light_remote_rc50_restore_uat_[0-9a-f]{10}_(src|dst)$')
CHECKSUM_TABLE='lr_schema_migration_hashes'
LOCKFILE=Path('/tmp/light-remote-rc50-v2-migrations.lock')

def need(flag,message):
    if not flag:raise RuntimeError(message)
def call(args,stdin=None):
    p=subprocess.run(args,input=stdin,capture_output=True,timeout=90)
    if p.returncode:
        raise RuntimeError('UAT migration command failed: '+p.stderr.decode(errors='replace')[-650:])
    return p.stdout.decode(errors='replace').strip()

def preflight(db):
    need(db==PRIMARY or RESTORE_RE.fullmatch(db),'refusing_database_outside_rc50_uat')
    health=call(['docker','inspect',CONTAINER,'--format',
      '{{.State.Health.Status}}|{{json .NetworkSettings.Ports}}'])
    need(health.startswith('healthy|'),'uat_postgres_not_healthy')
    need('"HostIp"' not in health,'uat_postgres_published_host_port')
    is_internal=call(['docker','network','inspect','lightremote-rc50-v2_private',
      '--format','{{.Internal}}'])
    need(is_internal=='true','uat_network_not_internal')
    identity=sql(db,'SELECT current_database()||\'|\'||current_user;')
    need(identity==db+'|'+MIGRATOR,'unexpected_migrator_database_role')

def sql(db,statement):
    return call(['docker','exec','-i',CONTAINER,'psql','-X','-v','ON_ERROR_STOP=1',
      '-U',MIGRATOR,'-d',db,'-At','-c',statement])

def run_file(db,filename):
    data=filename.read_bytes()
    call(['docker','exec','-i',CONTAINER,'psql','-X','-v','ON_ERROR_STOP=1',
      '-U',MIGRATOR,'-d',db,'-f','/dev/stdin'],stdin=data)

def lock_entries():
    obj=json.loads(MANIFEST.read_text())
    need(obj.get('target')=='synthetic UAT only' and obj.get('format')==1,'invalid_migration_manifest')
    rows=obj['migrations']
    need(len(rows)>0 and [r['version'] for r in rows]==list(range(1,len(rows)+1)),
      'non_contiguous_manifest_versions')
    listed=set()
    for entry in rows:
        version,name,digest=entry['version'],entry['file'],entry['sha256']
        need(name.startswith(f'{version:03d}_') and re.fullmatch(r'[0-9]{3}_[a-z0-9_]+\.sql',name),
          'invalid_migration_filename')
        need(re.fullmatch(r'[0-9a-f]{64}',digest),'invalid_migration_digest')
        filename=ROOT/'sql'/name
        need(filename.is_file() and not filename.is_symlink(),'missing_or_symlinked_migration')
        need(hashlib.sha256(filename.read_bytes()).hexdigest()==digest,
          'migration_source_checksum_mismatch:'+name)
        listed.add(name)
    extra={p.name for p in (ROOT/'sql').glob('[0-9][0-9][0-9]_*.sql')}-listed
    need(not extra,'unlisted_migrations:'+','.join(sorted(extra)))
    return rows

def state(db):
    if sql(db,"SELECT to_regclass('public.lr_schema_migrations') IS NOT NULL;")=='f':
        return [],None
    raw=sql(db,'SELECT version FROM lr_schema_migrations ORDER BY version')
    versions=[int(v) for v in raw.splitlines() if v]
    if sql(db,f"SELECT to_regclass('public.{CHECKSUM_TABLE}') IS NOT NULL;")=='f':
        return versions,None
    raw=sql(db,f'SELECT version::text||\'|\'||sha256 FROM {CHECKSUM_TABLE} ORDER BY version')
    hashes={}
    for line in raw.splitlines():
        if line:
            v,h=line.split('|');hashes[int(v)]=h
    return versions,hashes

def table(db):
    sql(db,f"""CREATE TABLE IF NOT EXISTS {CHECKSUM_TABLE}(
      version INTEGER PRIMARY KEY REFERENCES lr_schema_migrations(version),
      sha256 CHAR(64) NOT NULL CHECK(sha256 ~ '^[0-9a-f]{{64}}$'),
      attested_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""")

def verified(rows,versions,hashes,allow_unattested=False):
    need(versions==list(range(1,len(versions)+1)),'migration_history_has_gap')
    need(all(v<=len(rows) for v in versions),'unknown_applied_migration')
    if not versions:return
    if hashes is None:
        need(allow_unattested,'historical_migrations_require_explicit_attestation')
        return
    need(sorted(hashes)==versions,'migration_checksum_history_incomplete')
    for row in rows[:len(versions)]:
        need(hashes[row['version']]==row['sha256'],
          'applied_migration_checksum_drift:'+row['file'])

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=['plan','apply','verify','attest-existing'])
    parser.add_argument('--db',default=PRIMARY)
    args=parser.parse_args()
    rows=lock_entries()  # fail on source drift before any DB access
    with LOCKFILE.open('a+') as handle:
        fcntl.flock(handle.fileno(),fcntl.LOCK_EX)
        preflight(args.db)
        versions,hashes=state(args.db)
        if args.mode=='plan':
            verified(rows,versions,hashes,allow_unattested=True)
            print(f'PLAN db={args.db} installed={len(versions)} total={len(rows)}')
            if versions and hashes is None:print('UNATTESTED LEGACY UAT: source checksum history was not recorded at original execution')
            for row in rows[len(versions):]:print(f'PENDING {row["version"]:03d} {row["file"]}')
            return
        if args.mode=='attest-existing':
            need(args.db==PRIMARY,'attestation_only_for_legacy_primary_uat')
            need(versions==[r['version'] for r in rows],
              'legacy_attestation_requires_all_known_versions')
            need(hashes is None,'migration_history_already_attested')
            table(args.db)
            for row in rows:
                sql(args.db,f"INSERT INTO {CHECKSUM_TABLE}(version,sha256) VALUES({row['version']},'{row['sha256']}')")
            print(f'ATTESTED_EXISTING_SYNTHETIC_UAT {len(rows)} historical version hashes (NOT historical execution proof)')
            return
        verified(rows,versions,hashes)
        if args.mode=='verify':
            need(len(versions)==len(rows),'pending_migrations_exist')
            print(f'RC50_IMMUTABLE_MIGRATIONS_VERIFY_PASS: {len(versions)} versions, all hashes match')
            return
        need(args.mode=='apply','unknown_runner_mode')
        if not versions:
            # 001 creates lr_schema_migrations; run first, then create hash table.
            pass
        for row in rows[len(versions):]:
            run_file(args.db,ROOT/'sql'/row['file'])
            v=row['version']
            need(sql(args.db,f'SELECT count(*) FROM lr_schema_migrations WHERE version={v}')=='1',
              'migration_did_not_stamp_version:'+str(v))
            table(args.db)
            sql(args.db,f"INSERT INTO {CHECKSUM_TABLE}(version,sha256) VALUES({v},'{row['sha256']}')")
            print(f'APPLIED {v:03d} {row["file"]}')
        final_versions,final_hashes=state(args.db)
        verified(rows,final_versions,final_hashes)
        need(len(final_versions)==len(rows),'migration_apply_incomplete')
        print(f'RC50_IMMUTABLE_MIGRATIONS_APPLY_PASS: {len(final_versions)} versions')

if __name__=='__main__':
    try:main()
    except (RuntimeError,ValueError,subprocess.TimeoutExpired) as ex:
        print('RC50_MIGRATION_GUARD: '+str(ex),file=sys.stderr)
        sys.exit(1)
