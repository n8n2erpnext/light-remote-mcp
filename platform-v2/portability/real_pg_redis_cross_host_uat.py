#!/usr/bin/env python3
"""RC50 non-production PG17/Redis8 cross-host synthetic dump restore UAT.
Two independently authorized hosts; private offline Compose with isolated
volumes, zero published ports, internal Docker network, no customer data.
Always tears down test containers AND UAT volumes; no writer activation.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import secrets
import socket
import stat
import subprocess
import sys
import zipfile

FILES=("postgres/synthetic.pgdump","redis/synthetic.rdb")
USER="lr_rc50_uat"
DATABASE="light_remote_rc50_uat"
MARKER=".rc50-real-db-synthetic-only"
PROJECT_RE=re.compile(r"lr-rc50db-[0-9a-f]{12}-(src|dst)")
ROOT_RE=re.compile(r"lr_rc50_db_crosshost_[0-9a-f]{12}")


def fail(reason):
    raise ValueError("RC50_REAL_DB_UAT_DENIED:"+reason)


def canonical(v):
    return (json.dumps(v,sort_keys=True,separators=(",",":"))+"\n").encode()


def sha(b):
    return hashlib.sha256(b).hexdigest()


def invoke(cmd, *, data=None, env=None, timeout=120):
    result=subprocess.run(cmd,input=data,capture_output=True,
                          env=env,timeout=timeout)
    if result.returncode:
        # Never include credentials, upstream containers or secrets in errors.
        raise RuntimeError("rc50_synthetic_command_failed:"+str(cmd[0])+":"+
                           str(result.returncode))
    return result.stdout


def root_dir(v):
    p=Path(v).expanduser().absolute()
    if not ROOT_RE.fullmatch(p.name) or p.is_symlink() or p.exists():
        fail("scratch_must_be_fresh_random_and_private")
    if not p.parent.is_dir() or p.parent.is_symlink():
        fail("unsafe_scratch_parent")
    p.mkdir(mode=0o700)
    return p


def secure_write(p,b):
    if p.exists() or p.is_symlink():fail("existing_destination")
    p.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,"wb") as f:
            f.write(b)
            f.flush()
            os.fsync(f.fileno())
    finally:
        d=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(d)
        finally:os.close(d)


def env_and_config(root):
    password=secrets.token_hex(20)
    redis_pw=secrets.token_hex(20)
    pg=root/"pg.env"
    rc=root/"redis.conf"
    secure_write(pg,("POSTGRES_USER="+USER+"\nPOSTGRES_DB="+DATABASE+
                     "\nPOSTGRES_PASSWORD="+password+"\n").encode())
    secure_write(rc,("bind 0.0.0.0\nprotected-mode yes\nport 6379\n"+
                     "dir /data\ndbfilename dump.rdb\nappendonly no\n"+
                     "save 60 1\nrequirepass "+redis_pw+"\n").encode())
    return {"PATH":os.environ.get("PATH","/usr/bin:/bin"),
            "HOME":str(Path.home()),
            "LR_PORTABLE_PG_ENV":str(pg),
            "LR_PORTABLE_REDIS_CONF":str(rc)}


def compose(template,project,env,*cmd):
    if not PROJECT_RE.fullmatch(project):fail("non_uat_compose_project")
    return invoke(["docker","compose","-f",str(template),"-p",project,*cmd],
                  env=env,timeout=150).decode().strip()


def containers(template,project,env):
    ids={}
    for name in ("postgres","redis"):
        ids[name]=compose(template,project,env,"ps","-q",name)
        if not ids[name] or "\n" in ids[name]:fail("missing_uat_container")
        details=json.loads(invoke(["docker","inspect",ids[name]]))[0]
        if any(value for value in details["NetworkSettings"]["Ports"].values()):
            fail("nonprivate_container_ports")
        nets=details["NetworkSettings"]["Networks"]
        if len(nets)!=1 or not json.loads(invoke(
          ["docker","network","inspect",next(iter(nets))]))[0]["Internal"]:
            fail("nonprivate_compose_network")
    return ids


def sql(pg,query):
    return invoke(["docker","exec",pg,"psql","-X","-v","ON_ERROR_STOP=1",
                   "-U",USER,"-d",DATABASE,"-At","-c",query]).decode().strip()


def redis(rd,statement):
    # Password stays inside the synthetic container and never in stdout.
    cmd='p="$(sed -n "s/^requirepass[[:space:]]\\{1,\\}//p" /usr/local/etc/redis/redis.conf)"; test -n "$p" || exit 21; export REDISCLI_AUTH="$p"; exec redis-cli --raw '+statement
    return invoke(["docker","exec",rd,"sh","-ec",cmd]).decode().strip()


def pack(root,pgdump,rdb,fixture):
    blobs=dict(zip(FILES,(pgdump,rdb)))
    manifest={"version":1,"scope":"RC50_REAL_PG_REDIS_SYNTHETIC_ONLY",
              "fixture":fixture,"hostname":socket.gethostname(),
              "architecture":platform.machine(),"authWriterFence":False,
              "cutoverAuthorized":False,
              "files":[{"path":k,"bytes":len(b),"sha256":sha(b)} for k,b in blobs.items()]}
    zip_bytes=io.BytesIO()
    with zipfile.ZipFile(zip_bytes,"w",compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json",canonical(manifest))
        for k,b in blobs.items():z.writestr(k,b)
    secure_write(root/"rc50-real-db-synthetic.zip",zip_bytes.getvalue())
    return manifest,blobs


def verify(archive,*,different_host=True):
    p=Path(archive)
    if not p.is_file() or p.is_symlink() or p.stat().st_size>1024*1024:
        fail("invalid_archive")
    with zipfile.ZipFile(p) as z:
        names=z.namelist()
        if len(names)!=3 or set(names)!={"manifest.json",*FILES}:
            fail("untrusted_archive_members")
        if len(names)!=len(set(names)):fail("duplicate_archive_member")
        for member in z.infolist():
            limit=4096 if member.filename=="manifest.json" else 512*1024
            if member.is_dir() or member.file_size>limit or member.flag_bits & 1:
                fail("unsafe_or_oversized_archive_member")
        m=json.loads(z.read("manifest.json"))
        if set(m)!={"version","scope","fixture","hostname","architecture",
                    "authWriterFence","cutoverAuthorized","files"} or (
                m["version"]!=1 or m["scope"]!="RC50_REAL_PG_REDIS_SYNTHETIC_ONLY" or
                m["authWriterFence"] is not False or
                m["cutoverAuthorized"] is not False or
                not re.fullmatch(r"[0-9a-f]{12}",m["fixture"])):
            fail("unsupported_or_unsafe_manifest")
        if different_host and m["hostname"]==socket.gethostname():
            fail("same_physical_host")
        if [x.get("path") for x in m["files"]]!=list(FILES):
            fail("incomplete_snapshot")
        blobs={}
        for row in m["files"]:
            b=z.read(row["path"])
            if len(b)>512*1024 or len(b)!=row.get("bytes") or sha(b)!=row.get("sha256"):
                fail("bad_snapshot_sha")
            blobs[row["path"]]=b
        if not blobs[FILES[0]].startswith(b"PGDMP"):
            fail("not_real_pg_custom_dump")
        if blobs[FILES[1]][:5]!=b"REDIS":
            fail("not_real_redis_rdb")
    return m,blobs


def run_uat(args):
    root=root_dir(args.root)
    secure_write(root/MARKER,b"rc50-real-pg-redis-synthetic-only-v1\n")
    template=Path(args.compose).absolute()
    if template.is_symlink() or not template.is_file():fail("missing_uat_compose")
    if "compose.uat.yml"!=template.name:fail("wrong_compose_template")
    env=env_and_config(root)
    suffix=root.name.split("_")[-1]
    project="lr-rc50db-"+suffix+"-"+("src" if args.action=="source" else "dst")
    try:
        compose(template,project,env,"up","-d","--wait","--pull","never")
        ids=containers(template,project,env)
        pg,rd=ids["postgres"],ids["redis"]
        if args.action=="source":
            fixture=secrets.token_hex(6)
            sql(pg,"CREATE TABLE rc50_fixture (id text PRIMARY KEY, label text NOT NULL)")
            sql(pg,"INSERT INTO rc50_fixture VALUES ('"+fixture+"','synthetic-owner-revoked-and-paid')")
            if sql(pg,"SELECT label FROM rc50_fixture WHERE id='"+fixture+"'")!="synthetic-owner-revoked-and-paid":
                fail("source_postgres_failed")
            key="lr:rc50:synthetic:"+fixture
            if redis(rd,"SET "+key+" 17")!="OK" or redis(rd,"GET "+key)!="17":
                fail("source_redis_failed")
            pg_dump=invoke(["docker","exec",pg,"pg_dump","-U",USER,"-d",
                            DATABASE,"-Fc","--no-owner","--no-acl"])
            if redis(rd,"SAVE")!="OK":fail("source_redis_save_failed")
            rdb=root/"synthetic.rdb"
            invoke(["docker","cp",rd+":/data/dump.rdb",str(rdb)])
            manifest,_=pack(root,pg_dump,rdb.read_bytes(),fixture)
            result={"source":socket.gethostname(),"arch":platform.machine(),
                    "pgActualDump":True,"redisActualRdb":True,
                    "manifest":manifest,"archive":str(root/"rc50-real-db-synthetic.zip"),
                    "archiveSha256":sha((root/"rc50-real-db-synthetic.zip").read_bytes())}
        else:
            m,blobs=verify(args.archive)
            for name,b in blobs.items():
                secure_write(root/name,b)
            # The target Postgres/Redis is a disposable, never-host-exposed test
            # instance with a random UAT-only secret independent from source.
            invoke(["docker","exec","-i",pg,"pg_restore","-U",USER,"-d",
                    DATABASE,"--no-owner","--no-acl"],data=blobs[FILES[0]])
            fixture=m["fixture"]
            if sql(pg,"SELECT label FROM rc50_fixture WHERE id='"+fixture+"'")!="synthetic-owner-revoked-and-paid":
                fail("target_postgres_mismatch")
            compose(template,project,env,"stop","redis")
            invoke(["docker","cp",str(root/FILES[1]),rd+":/data/dump.rdb"])
            compose(template,project,env,"start","redis")
            if redis(rd,"GET lr:rc50:synthetic:"+fixture)!="17":
                fail("target_redis_mismatch")
            result={"source":m["hostname"],"destination":socket.gethostname(),
                    "sourceArch":m["architecture"],"destArch":platform.machine(),
                    "realPgRestore":True,"realRedisRdbLoad":True,
                    "sourceSha256":sha(Path(args.archive).read_bytes()),
                    "writerWasEverEnabled":False,"cutoverAuthorized":False,
                    "rollback":"UAT stack and volumes deleted in finally",
                    "fixture":fixture}
        return result
    finally:
        # Always remove ONLY this random prefix and its private volumes.
        compose(template,project,env,"down","-v","--remove-orphans")


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("action",choices=["source","restore","verify"])
    ap.add_argument("--root")
    ap.add_argument("--archive")
    ap.add_argument("--compose")
    ap.add_argument("--confirm-synthetic-only",action="store_true")
    args=ap.parse_args()
    if not args.confirm_synthetic_only:fail("explicit_confirm_required")
    if args.action=="verify":
        m,b=verify(args.archive,different_host=False)
        result={"fixture":m["fixture"],"files":len(b),
                "source":m["hostname"],"sha256":sha(Path(args.archive).read_bytes()),
                "cutoverAuthorized":False}
    else:
        if not args.root or not args.compose:fail("root_and_compose_required")
        result=run_uat(args)
    print(json.dumps({"ok":True,**result},sort_keys=True))


if __name__=="__main__":
    try:main()
    except (OSError,ValueError,RuntimeError,zipfile.BadZipFile,
            subprocess.TimeoutExpired,KeyError,TypeError) as e:
        print(json.dumps({"ok":False,"error":str(e)[:180]}),file=sys.stderr)
        sys.exit(1)
