#!/usr/bin/env python3
"""Run an exact-commit reconstruction fixture, isolated from every existing runtime.

No host DB/Redis ports, old paths, production DNS, shared volumes or Docker socket
are available to the app. Only resources bearing this invocation's label may stop.
"""
import argparse, datetime, hashlib, json, os, pathlib, re, secrets, shutil, subprocess, sys, time, urllib.parse

SOURCE = pathlib.Path(__file__).resolve().parents[2]
LABEL = 'org.lightremote.unified.fixture'

def run(args, *, data=None, check=True, cwd=SOURCE):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=cwd)
    if check and result.returncode:
        # Credentials are supplied through files/stdin, never embedded in args.
        raise RuntimeError('command failed: '+ ' '.join(map(str,args))+'\n'+result.stdout.decode(errors='replace')[-6000:])
    return result

def write(path, value, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(value if isinstance(value,str) else json.dumps(value,indent=2)+'\n')
    path.chmod(mode)

def docker(*args, **kw): return run(['docker',*map(str,args)], **kw)

def inspect_owned(kind, name, ident):
    result=docker(kind,'inspect',name,check=False)
    if result.returncode: return False
    row=json.loads(result.stdout)[0]
    labels=(row.get('Config',{}).get('Labels') or {}) if kind=='container' else (row.get('Labels') or {})
    if labels.get(LABEL)!=ident: raise RuntimeError('refusing non-owned resource: '+name)
    return True

def stop(state, destroy=False):
    for name in reversed(state['containers']):
        if inspect_owned('container',name,state['id']):docker('rm','-f',name)
    if inspect_owned('network',state['network'],state['id']):docker('network','rm',state['network'])
    if destroy:
        for name in state['volumes']:
            if inspect_owned('volume',name,state['id']):docker('volume','rm',name)

def pki(app, bootstrap, host):
    certs=app/'pki';certs.mkdir(mode=0o700)
    for name in ['public','edge']:
        ca=certs/(name+'-ca.crt');cakey=bootstrap/(name+'-ca.key')
        run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','7','-subj','/CN=Light Remote disposable '+name,'-addext','basicConstraints=critical,CA:TRUE','-keyout',str(cakey),'-out',str(ca)])
        for leaf in ([name] if name=='public' else ['edge-server','edge-client']):
            key=certs/(leaf+'.key');csr=bootstrap/(leaf+'.csr');crt=certs/(leaf+'.crt');ext=bootstrap/(leaf+'.ext')
            client=leaf.endswith('client')
            write(ext,'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage='+('clientAuth' if client else 'serverAuth')+'\nsubjectAltName=DNS:'+host+'\n')
            run(['openssl','req','-new','-newkey','rsa:2048','-nodes','-subj','/CN='+('fixture-edge-client' if client else host),'-keyout',str(key),'-out',str(csr)])
            run(['openssl','x509','-req','-days','7','-in',str(csr),'-CA',str(ca),'-CAkey',str(cakey),'-CAcreateserial','-out',str(crt),'-extfile',str(ext)])
            key.chmod(0o600)
    der=run(['openssl','x509','-in',str(certs/'edge-client.crt'),'-outform','DER']).stdout
    write(certs/'trust.crt',(certs/'public-ca.crt').read_text()+(certs/'edge-ca.crt').read_text())
    return hashlib.sha256(der).hexdigest()

def launch(args):
    if run(['git','status','--porcelain']).stdout.strip():raise RuntimeError('exact clean commit required before DEV build')
    sha=run(['git','rev-parse','HEAD']).stdout.decode().strip()
    if not re.fullmatch('[a-f0-9]{40}',sha):raise RuntimeError('invalid source SHA')
    if shutil.disk_usage(SOURCE).free<4*1024**3:raise RuntimeError('at least 4 GiB free required; no old data will be pruned')
    ident='lru-'+sha[:10]+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%H%M%S')
    base=SOURCE/'.unified'/ident;base.mkdir(parents=True,mode=0o700)
    app=base/'app';bootstrap=base/'bootstrap';app.mkdir(mode=0o700);bootstrap.mkdir(mode=0o700)
    names={x:ident+'-'+x for x in ['pg','redis','app','net','pgdata','redisdata']}
    state={'id':ident,'sourceCommit':sha,'network':names['net'],'containers':[names['pg'],names['redis'],names['app']],'volumes':[names['pgdata'],names['redisdata']],'path':str(base),'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    write(base/'deployment.json',state)
    write(SOURCE/'.unified'/'latest.json',{'path':str(base)})
    try:
        images=json.loads((SOURCE/'deploy/unified/images.lock.json').read_text())
        # Accept the lock's descriptive wrapper but never a mutable Docker tag.
        def image(name):
            value=images.get(name) or images.get('images',{}).get(name)
            if isinstance(value,dict):value=value.get('image') or value.get('digest') or value.get('reference') or value.get('pinned')
            if not value or '@sha256:' not in value:raise RuntimeError('immutable image missing: '+name)
            return value
        archive=run(['git','archive','--format=tar',sha]).stdout
        image_name='light-remote-unified:'+sha
        build=docker('build','--label',LABEL+'='+ident,'--build-arg','NODE_IMAGE='+image('node'),'-t',image_name,'-f','deploy/unified/Dockerfile','-',data=archive)
        write(base/'image-build.log',build.stdout.decode(errors='replace'))
        state['image']=json.loads(docker('image','inspect',image_name).stdout)[0]['Id']
        docker('network','create','--internal','--label',LABEL+'='+ident,names['net'])
        for name in state['volumes']:docker('volume','create','--label',LABEL+'='+ident,name)
        adminpw=secrets.token_hex(32);apppw=secrets.token_hex(32);migratorpw=secrets.token_hex(32);redispw=secrets.token_hex(32)
        write(bootstrap/'postgres-password',adminpw)
        # The Redis image drops to its own UID. The file is readable inside only
        # that container; its host parent remains mode 0700 and is not app-mounted.
        write(bootstrap/'redis.conf','bind 0.0.0.0\nprotected-mode yes\nrequirepass '+redispw+'\nappendonly yes\ndir /data\nmaxmemory 96mb\nmaxmemory-policy noeviction\n',0o644)
        common=['--label',LABEL+'='+ident,'--network',names['net'],'--restart','no','--log-opt','max-size=5m','--log-opt','max-file=2']
        docker('run','-d','--name',names['pg'],*common,'--memory','512m','-e','POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password','-v',str(bootstrap/'postgres-password')+':/run/secrets/postgres-password:ro','-v',names['pgdata']+':/var/lib/postgresql/data',image('postgres'))
        docker('run','-d','--name',names['redis'],*common,'--memory','160m','-v',str(bootstrap/'redis.conf')+':/run/secrets/redis.conf:ro','-v',names['redisdata']+':/data',image('redis'),'redis-server','/run/secrets/redis.conf')
        for _ in range(60):
            if docker('exec',names['pg'],'pg_isready','-U','postgres',check=False).returncode==0:break
            time.sleep(1)
        else:raise RuntimeError('fresh PostgreSQL did not start')
        sql=f"CREATE ROLE lr_gold_app LOGIN PASSWORD '{apppw}';\nCREATE ROLE lr_gold_migrator LOGIN PASSWORD '{migratorpw}';\nCREATE DATABASE light_remote_gold_dev OWNER lr_gold_migrator;\nCOMMENT ON DATABASE light_remote_gold_dev IS 'lr-unified-fixture:{sha}';\n"
        docker('exec','-i',names['pg'],'psql','-v','ON_ERROR_STOP=1','-U','postgres',data=sql.encode())
        write(app/'pg-url',f'postgresql://lr_gold_app:{apppw}@{names["pg"]}:5432/light_remote_gold_dev')
        write(app/'redis-url',f'redis://:{redispw}@{names["redis"]}:6379/0')
        write(bootstrap/'migrator-url',f'postgresql://lr_gold_migrator:{migratorpw}@{names["pg"]}:5432/light_remote_gold_dev')
        endpoint=json.loads((SOURCE/'config/endpoints.json').read_text())
        # The canonical profile is pinned; runtime DNS is private to this network.
        profile=endpoint['profiles'][endpoint['selectedProfile']]
        host=urllib.parse.urlparse(profile['cloudOrigins']['owner']).hostname
        pin=pki(app,bootstrap,host)
        flags={
          'LR_UNIFIED_DISPOSABLE_DEV':'1','LR_UNIFIED_SOURCE_COMMIT':sha,
          'LIGHT_REMOTE_GOLD_INDEPENDENT':'1','LIGHT_REMOTE_GOLD_ROOT':'/state',
          'LR_GOLD_PG_URL_FILE':'/state/pg-url','LR_GOLD_REDIS_URL_FILE':'/state/redis-url','LR_GOLD_INSTANCE_ID':ident,
          'LR_GOLD_AB_KEY_FILE':'/state/ab-key','LR_GOLD_SCHEMA_043_RELEASE_ACCEPT':'1',
          'LR_GOLD_SINGLE_OWNER_AUTHORITY':'1','OPERATOR_ACCOUNT_ID':'unified-dev-owner',
          'OPERATOR_INTEGRATED_HOST':'0','OPERATOR_SOCKET':'/state/run/operator.sock',
          'OPERATOR_STATE_DIR':'/state/operator-state','OPERATOR_LOG_DIR':'/state/operator-logs','OPERATOR_KEY_FILE':'/state/operator.private.json',
          'LIGHT_REMOTE_PLUGIN_ORIGIN':'https://'+host,'LIGHT_REMOTE_PLUGIN_HOST':'127.0.0.1','LIGHT_REMOTE_PLUGIN_PORT':'5495',
          'OPERATOR_AGENT_BASE_URL':'https://'+host,'OPERATOR_AGENT_HUB_URL':'https://'+host,
          'LIGHT_REMOTE_PLUGIN_OAUTH_SECRET_FILE':'/state/plugin-oauth-secret',
          'NODE_EXTRA_CA_CERTS':'/state/pki/trust.crt','HOME':'/state/home',
          'LIGHT_REMOTE_BUILD_PROFILE':'goldabv2-desktop-v4',
          'LR_GOLD_PRODUCT_LINE':'goldabv2','LR_GOLD_AB_V2_ACCOUNT_UI':'1','LR_GOLD_AB_V2_ACCOUNT_APPROVE_UI':'1',
          'LR_GOLD_AB_V2_OWNER_PENDING_HTTP':'1','LR_GOLD_AB_V2_OWNER_APPROVE_HTTP':'1',
          'LR_GOLD_AB_V2_OWNER_ORIGIN':'https://'+host,'LR_GOLD_AB_V2_SEAL_KEY_FILE':'/state/abv2-seal-key',
          'LR_GOLD_AB_V2_HELPER_PROOF_KEY_FILE':'/state/abv2-helper-key',
          'LR_GOLD_AB_V2_DURABLE_GRANT_BRIDGE':'1','LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE':'1',
          'LR_GOLD_AB_V2_HELPER_TARGET_QUERY':'1','LR_GOLD_AB_V2_HELPER_POLL_ATTACH':'1','LR_GOLD_AB_V2_WALL_PENDING_PREVIEW':'1',
          'LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1':'1','LR_GOLD_ABV2_LAB_SIGNED_WALL_B_ONLY':'1',
          'LR_GOLD_AB_V2_WALL_OWNER_CONSENT':'1','LR_GOLD_AB_V2_WALL_SIGNED_APPROVE':'1',
          'LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4':'1','LR_GOLD_ABV2_DESKTOP_TOKEN_V4':'1','LR_GOLD_ABV2_DESKTOP_READ_V4':'1',
          'LR_GOLD_ABV2_DESKTOP_WALL_SSO_V4':'1','LR_GOLD_ABV2_DESKTOP_WALL_SSO_OPERATOR_V4':'1','LR_GOLD_ABV2_DESKTOP_WALL_SSO_ISSUER_V4':'1',
          'LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_EDGE_V4':'1','LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_PORT_V4':'5496',
          'LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_CERT_PATH_V4':'/state/pki/edge-server.crt',
          'LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_KEY_PATH_V4':'/state/pki/edge-server.key',
          'LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_CLIENT_CA_PATH_V4':'/state/pki/edge-ca.crt',
          'LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_CLIENT_SHA256_V4':pin
        }
        write(app/'runtime-env.json',flags)
        for name in ['ab-key','abv2-seal-key','abv2-helper-key']:
            (app/name).write_bytes(secrets.token_bytes(32));(app/name).chmod(0o600)
        write(app/'fixture-credentials.json',{'owner':{'email':'owner@unified.invalid','password':secrets.token_urlsafe(32)},'foreign':{'email':'foreign@unified.invalid','password':secrets.token_urlsafe(32)}})
        uid=str(os.getuid())+':'+str(os.getgid())
        helper=['run','--rm','--label',LABEL+'='+ident,'--network',names['net'],'--user',uid,'--cap-drop','ALL','--security-opt','no-new-privileges','-v',str(app)+':/state','-v',str(bootstrap)+':/bootstrap:ro']
        envfile=base/'helper.env';write(envfile,'\n'.join(k+'='+v for k,v in flags.items())+'\n')
        migrate_env={**flags,'LIGHT_REMOTE_GOLD_ROOT':'/bootstrap','LR_GOLD_MIGRATOR_URL_FILE':'/bootstrap/migrator-url','LR_GOLD_APPLY_MIGRATIONS':'1','LR_GOLD_ABV2_043_MIGRATOR_ACCEPT':'1'}
        write(base/'migration.env','\n'.join(k+'='+v for k,v in migrate_env.items())+'\n')
        for file in ['deploy/scripts/apply-gold-db.mjs','deploy/unified/apply-owner-extension.mjs']:
            result=docker(*helper,'--env-file',str(base/'migration.env'),image_name,'node',file)
            write(base/(pathlib.Path(file).stem+'.log'),result.stdout.decode(errors='replace'))
        docker(*helper,'--env-file',str(envfile),image_name,'node','deploy/scripts/generate-operator-key.mjs','/state/operator-public.json','/state/operator.private.json')
        docker(*helper,'--env-file',str(envfile),image_name,'node','deploy/unified/seed-dev.mjs')
        docker('run','-d','--name',names['app'],*common,'--network-alias',host,'--memory','1536m','--pids-limit','256','--user',uid,'--cap-drop','ALL','--sysctl','net.ipv4.ip_unprivileged_port_start=0','--security-opt','no-new-privileges','--read-only','--tmpfs','/tmp:rw,nosuid,size=64m','-v',str(app)+':/state','--env-file',str(envfile),image_name)
        state['status']='RUNNING';state['versions']=json.loads((SOURCE/'project.manifest.json').read_text());state['origin']='https://'+host
        write(base/'deployment.json',state)
        report=docker('exec',names['app'],'node','deploy/unified/dev-acceptance.mjs')
        write(base/'acceptance.log',report.stdout.decode(errors='replace'))
        # This report contains booleans, status codes and provenance only.
        sanitized=json.loads((app/'integration-report.json').read_text())
        out=SOURCE/'build-output';out.mkdir(exist_ok=True)
        write(out/'integration-report.json',sanitized,0o644)
        print(json.dumps({'candidate':ident,'sourceCommit':sha,'integration':sanitized,'deployment':str(base/'deployment.json')},indent=2))
        if args.command=='test':stop(state,destroy=True)
        return 0
    except BaseException:
        # Preserve private diagnostic state, clean only owned disposable resources.
        for name in state['containers']:
            if inspect_owned('container',name,ident):
                write(base/(name+'.private.log'),docker('logs',name,check=False).stdout.decode(errors='replace'))
        stop(state,destroy=args.command=='test')
        raise

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['test','start','status','stop'])
    args=parser.parse_args()
    if args.command in ['test','start']:return launch(args)
    latest=json.loads((SOURCE/'.unified/latest.json').read_text());base=pathlib.Path(latest['path']).resolve()
    allowed=(SOURCE/'.unified').resolve()
    if base.parent!=allowed:raise RuntimeError('candidate path escaped private root')
    state=json.loads((base/'deployment.json').read_text())
    if args.command=='stop':stop(state)
    else:print(json.dumps({k:v for k,v in state.items() if k not in ['versions']},indent=2))
    return 0

if __name__=='__main__':sys.exit(main())
