#!/usr/bin/env python3
"""Run release preparation end to end with synthetic assets and a fake R2."""
import hashlib
import json
import os
import runpy
import subprocess
import tempfile
from pathlib import Path


here = Path(__file__).resolve().parent
assemble = runpy.run_path(str(here / 'assemble-production-release.py'))['assemble']
version = '0.10.1-rc.1'
sha = 'a' * 40
tag = 'v' + version
repo = 'n8n2erpnext/light-remote-mcp'


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(value.encode() if isinstance(value, str) else value)


def hash_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sums(directory):
    return ''.join(f'{hash_file(file)}  {file.name}\n' for file in sorted(directory.iterdir()))


with tempfile.TemporaryDirectory(prefix='light-remote-release-test-') as temp:
    root = Path(temp)
    source = root / 'source'
    write(source / 'VERSION', version)
    profile = 'goldabv2-production'
    endpoint = 'https://light-remote.thaiduy.digital'
    catalog = source / 'config/endpoints.json'
    config = {'selectedProfile': profile, 'profiles': {profile: {'productId': 'goldabv2-desktop-v4',
              'cloudOrigins': dict.fromkeys(('owner', 'operator', 'deviceChannel', 'mcp'), endpoint)}}}
    write(catalog, json.dumps(config))
    write(source / 'client/linux/install.sh', '#!/bin/sh\n')
    write(source / 'plugin-server/downloads-install-linux.sh', '#!/bin/sh\n')
    artifact_root = root / 'artifacts'
    win = artifact_root / f'light-remote-desktop-v4-COMPLETE-windows-x64-{sha}'
    exe = win / 'Light-Remote-MCP-Setup-x64.exe'
    write(exe, 'synthetic setup fixture')
    write(win / 'SHA256SUMS.txt', sums(win))
    write(win / 'BUILD_MANIFEST.json', json.dumps({
        'sourceCommit': sha, 'ciRunId': '42', 'projectVersion': version, 'platform': 'windows-x64',
        'dependencyHashes': {'config/endpoints.json': hash_file(catalog)},
        'artifact': {'name': exe.name, 'bytes': exe.stat().st_size, 'sha256': hash_file(exe)},
    }))
    for arch, deb, pkg in [('x64', 'amd64', 'x86_64'), ('arm64', 'arm64', 'arm64')]:
        for directory, names in [(f'gpt-operator-linux-{arch}-{sha}', [f'light-remote_{version}_{deb}.deb',
                                  f'Light-Remote-MCP-Client-Linux-{arch}-{version}.tar.gz']),
                                 (f'light-remote-macos-{arch}-{sha}', [f'Light-Remote-{version}-{pkg}.pkg',
                                  f'Light-Remote-Client-macOS-{arch}-{version}.tar.gz'])]:
            for name in names:
                write(artifact_root / directory / name, name)
            write(artifact_root / directory / 'SHA256SUMS.txt', sums(artifact_root / directory))
    assets = root / 'release-assets'
    assemble(source, artifact_root, assets, tag, sha, '42', '43')
    write(assets / 'SHA256SUMS.txt', sums(assets))
    release = {'tag_name': tag, 'published_at': '2026-11-27T12:00:00Z', 'draft': False,
               'assets': [{'name': f.name, 'browser_download_url': f'https://github.com/{repo}/releases/download/{tag}/{f.name}'}
                          for f in assets.iterdir()]}
    write(root / 'release.json', json.dumps(release))
    write(root / 'credentials', 'AWS_ACCESS_KEY_ID=fixture\nAWS_SECRET_ACCESS_KEY=fixture\nR2_ACCOUNT_ID=fixture\nR2_BUCKET=fixture\nR2_PUBLIC_URL=https://files.example.invalid\n')
    bin_dir = root / 'bin'
    fake_curl = bin_dir / 'curl'
    write(fake_curl, '''#!/usr/bin/env python3
import os, shutil, sys
from pathlib import Path
args=sys.argv[1:]
root=Path(os.environ['RELEASE_FIXTURE'])
url=next(v for v in args if v.startswith('https://'))
if url.startswith('https://api.github.com/'):
    print((root/'release.json').read_text())
elif url.startswith('https://github.com/'):
    shutil.copyfile(root/'release-assets'/url.rsplit('/',1)[-1],args[args.index('-o')+1])
else:
    bucket_object=root/'objects'/url.split('.com/fixture/',1)[1]
    assert '/latest/' not in str(bucket_object)
    if '-X' in args:
        assert 'If-None-Match: *' in args
        if bucket_object.exists():
            print('412')
        else:
            bucket_object.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(args[args.index('--data-binary')+1][1:],bucket_object)
            print('200')
    else:
        shutil.copyfile(bucket_object,args[args.index('-o')+1])
''')
    fake_curl.chmod(0o755)
    write(bin_dir / 'lxc', '#!/bin/sh\ntouch "$RELEASE_FIXTURE/lxd-called"\nexit 1\n')
    (bin_dir / 'lxc').chmod(0o755)
    manifest = root / 'manifest.json'
    env = {**os.environ, 'PATH': f'{bin_dir}{os.pathsep}{os.environ["PATH"]}',
           'RELEASE_FIXTURE': str(root), 'LIGHT_REMOTE_R2_ENV_FILE': str(root / 'credentials'),
           'LIGHT_REMOTE_RELEASE_STAGING_DIR': str(root / 'sync'),
           'LIGHT_REMOTE_R2_SYNC_STATE': str(root / 'state' / 'version')}
    cmd = ['bash', str(here / 'sync-release-to-r2.sh'), '--stage', version, str(manifest)]
    for _ in range(2):
        result = subprocess.run(cmd, env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        assert '=STAGED ' in result.stdout
    assert all(row['available'] for row in json.loads(manifest.read_bytes())['releases'])
    assert json.loads(manifest.read_bytes())['installScriptUrl'].endswith(f'/{version}/downloads-install.sh')
    assert not (root / 'state' / 'version').exists() and not (root / 'lxd-called').exists()
    obj=next((root / 'objects').rglob('Light-Remote-MCP-Setup*.exe'))
    write(obj, 'different bytes under the same version')
    conflict = subprocess.run(cmd, env=env, capture_output=True, text=True)
    assert conflict.returncode == 5 and 'different bytes' in conflict.stderr
    write(assets / 'install-linux-client.sh', 'changed after checksum was produced')
    tampered = subprocess.run(cmd, env=env, capture_output=True, text=True)
    assert tampered.returncode != 0 and 'release checksum mismatch' in tampered.stderr
    config['selectedProfile'] = 'goldabv2-lab'
    write(catalog, json.dumps(config))
    try:
        assemble(source, artifact_root, root / 'unsafe-release', tag, sha, '42', '43')
    except ValueError as error:
        assert 'production endpoint' in str(error)
    else:
        raise AssertionError('Gold lab must not be accepted by production release assembly')

print('PRODUCTION_RELEASE_ASSEMBLY_AND_R2_STAGE=PASS')
