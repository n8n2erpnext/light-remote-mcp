"""Use reachable Ubuntu archive mirrors only on disposable GitHub runners.

Observed 2026-11-11: Ubuntu authoritative nameservers return SERVFAIL for both
archive.ubuntu.com and security.ubuntu.com even through Google Public DNS.
Mirror registration: https://launchpad.net/ubuntu/+archivemirrors
Timeout policy: https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt.sh
All suites, signing keys, package hashes, HTTPS and apt authentication stay on.
"""
import os
import pathlib
import re
import subprocess
import sys
import tempfile

MIRRORS=('https://mirrors.edge.kernel.org/ubuntu','https://mirror.math.princeton.edu/pub/ubuntu')


def replace_host(text,mirror=MIRRORS[0]):
    if mirror not in MIRRORS:
        raise ValueError('mirror_not_allowlisted')
    # Match only the complete original archive base URL. Leave unrelated
    # third-party repos and all Signed-By/components/priorities unchanged.
    return re.sub(r'https?://(?:azure\.archive|archive|security)\.ubuntu\.com/ubuntu(?=[/\s]|$)',mirror,text)


def rewrite(root,mirror):
    files=[root/'sources.list',root/'apt-mirrors.txt',*(root/'sources.list.d').glob('*.list'),*(root/'sources.list.d').glob('*.sources'),*(root/'mirrors').glob('*.list')]
    changed=0
    for file in files:
        if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(root):
            continue
        old=file.read_text();new=replace_host(old,mirror)
        if new!=old:
            file.write_text(new);changed+=1
    return changed


def select_mirror(codename):
    if not re.fullmatch(r'[a-z]+',codename):
        raise ValueError('invalid_ubuntu_codename')
    for mirror in MIRRORS:
        usable=True
        for suite in (codename,codename+'-updates',codename+'-security'):
            # This probes availability only. apt subsequently validates InRelease
            # and package hashes with the unchanged Ubuntu archive keyring.
            probe=subprocess.run(['curl','--fail','--silent','--show-error','--head','--connect-timeout','4','--max-time','10',mirror+'/dists/'+suite+'/InRelease'],capture_output=True,timeout=12)
            if probe.returncode:
                usable=False;break
        if usable:
            return mirror
    raise RuntimeError('no_reachable_signed_ubuntu_archive_mirror')


def self_test():
    assert replace_host('URIs: http://azure.archive.ubuntu.com/ubuntu/')=='URIs: '+MIRRORS[0]+'/'
    for original in ['https://azure.archive.ubuntu.com.attacker.invalid/ubuntu','https://archive.ubuntu.com/ubuntuevil','Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg','https://packages.microsoft.com/ubuntu']:
        assert replace_host(original)==original
    try:replace_host('http://archive.ubuntu.com/ubuntu','https://other.invalid/ubuntu')
    except ValueError:pass
    else:raise AssertionError('unlisted mirror accepted')
    with tempfile.TemporaryDirectory(prefix='lr-apt-probe-') as temp:
        fixture=pathlib.Path(temp).resolve();file=fixture/'apt-mirrors.txt'
        file.write_text('http://azure.archive.ubuntu.com/ubuntu priority:1\nhttps://security.ubuntu.com/ubuntu priority:2\n')
        assert rewrite(fixture,MIRRORS[0])==1
        assert file.read_text()==MIRRORS[0]+' priority:1\n'+MIRRORS[0]+' priority:2\n'
        assert rewrite(fixture,MIRRORS[0])==0
        directory=fixture/'sources.list.d';directory.mkdir()
        source=directory/'ubuntu.sources';text='Types: deb\nURIs: http://security.ubuntu.com/ubuntu/\nSuites: noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'
        source.write_text(text);assert rewrite(fixture,MIRRORS[0])==1
        assert source.read_text()==text.replace('http://security.ubuntu.com/ubuntu/',MIRRORS[0]+'/')
    print('HOSTED_APT_MIRROR_SELF_TEST=PASS')


if __name__=='__main__':
    if '--self-test' in sys.argv:
        self_test();raise SystemExit(0)
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted':
        raise SystemExit('hosted_runner_only')
    release=dict(line.split('=',1) for line in pathlib.Path('/etc/os-release').read_text().splitlines() if '=' in line)
    if release.get('ID','').strip('"')!='ubuntu':
        raise SystemExit('ubuntu_only')
    mirror=select_mirror(release['VERSION_CODENAME'].strip('"'))
    root=pathlib.Path('/etc/apt').resolve()
    print('HOSTED_UBUNTU_SELECTED_MIRROR='+mirror)
    print('HOSTED_UBUNTU_MIRROR_FILES_UPDATED='+str(rewrite(root,mirror)))
    (root/'apt.conf.d/zz-lightremote-ci').write_text('Acquire::Retries "1";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\nAcquire::ForceIPv4 "true";\n')
    subprocess.run(['apt-config','dump','Acquire::Retries','Acquire::http::Timeout','Acquire::https::Timeout','Acquire::ForceIPv4'],check=True)
