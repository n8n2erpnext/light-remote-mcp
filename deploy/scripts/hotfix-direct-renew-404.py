#!/usr/bin/env python3
"""One-file rollback-safe hotfix for authorized light-remote-direct instance."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request
import urllib.error

target=Path('/opt/light-remote-direct/current/plugin-server/device-public.mjs').resolve(strict=True)
old=b"'connect','disconnect','grace','account-auth',"
new=b"'connect','renew','disconnect','grace','account-auth',"
data=target.read_bytes()
if data.count(old)!=1 or data.count(new):
    raise SystemExit('unexpected_source_revision_aborting')
backup_dir=Path('/opt/light-remote-direct/hotfix-backups')
backup_dir.mkdir(mode=0o700,parents=True,exist_ok=True)
backup=backup_dir/('device-public.mjs.before-renew-route-'+time.strftime('%Y%m%dT%H%M%S'))
shutil.copy2(target,backup)
stat=target.stat()
changed=False
def put(b):
    temp=target.with_name(target.name+'.renew404-stage')
    try:
        with open(temp,'wb') as f:
            f.write(b);f.flush();os.fsync(f.fileno())
        os.chmod(temp,stat.st_mode)
        os.chown(temp,stat.st_uid,stat.st_gid)
        os.replace(temp,target)
    finally:
        if temp.exists():temp.unlink()
def run(argv):
    result=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=35)
    if result.returncode:
        raise RuntimeError(f'command_failure:{argv[0]}: {result.stderr[-240:]}')
    return result.stdout.strip()
def probe(path,post=False):
    req=urllib.request.Request('http://127.0.0.1:5495'+path,
         data=b'{}' if post else None,
         headers={'content-type':'application/json'} if post else {},
         method='POST' if post else 'GET')
    try:
        with urllib.request.urlopen(req,timeout=6) as res:return res.status,res.read(512).decode()
    except urllib.error.HTTPError as e:return e.code,e.read(512).decode()
try:
    put(data.replace(old,new));changed=True
    run(['/opt/light-remote-direct/current/runtime/node','--check',str(target)])
    run(['systemctl','restart','light-remote-direct-plugin.service'])
    time.sleep(2)
    h,_=probe('/healthz')
    s,body=probe('/device-channel/renew',post=True)
    if h!=200 or s>=500 or 'device_channel_action_denied' in body:
        raise RuntimeError(f'postdeploy_health_failure:{h},{s},{body[:150]}')
    print(json.dumps({'result':'PASS','backup':str(backup),
      'target':str(target),'before_sha256':hashlib.sha256(data).hexdigest(),
      'after_sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
      'health_http':h,'invalid_renew_http':s,'invalid_renew_error':json.loads(body).get('error')}))
except Exception as exc:
    if changed:
        put(data)
        try:run(['systemctl','restart','light-remote-direct-plugin.service'])
        except Exception as rollback_exc:print('rollback_restart_error:',rollback_exc)
    raise SystemExit(f'hotfix_failed_rolled_back:{exc}')
