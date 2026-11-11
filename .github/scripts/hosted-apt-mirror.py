"""Bound disposable hosted-runner apt failures without altering package trust.

References:
https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt.sh
https://developers.google.com/speed/public-dns/docs/doh/json
Never invoked on ARM, production, self-hosted runners, or the product installer.
"""
import ipaddress
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.parse

HOSTS=('archive.ubuntu.com','security.ubuntu.com')


def replace_host(text):
    # Upgrade only exact Ubuntu archive URI hosts; retain suite/key/priority.
    return re.sub(r'https?://(?:azure\.archive|archive|security)\.ubuntu\.com(?=[:/])',
                  lambda m: 'https://'+('security.ubuntu.com' if 'security.' in m[0] else 'archive.ubuntu.com'),text)


def rewrite(root):
    files=[root/'sources.list',root/'apt-mirrors.txt',*(root/'sources.list.d').glob('*.list'),*(root/'sources.list.d').glob('*.sources'),*(root/'mirrors').glob('*.list')]
    changed=0
    for file in files:
        if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(root):
            continue
        old=file.read_text();new=replace_host(old)
        if new!=old:
            file.write_text(new);changed+=1
    return changed


def checked_answers(host,body):
    if host not in HOSTS or body.get('Status')!=0 or body.get('TC') or body.get('CD'):
        raise ValueError('DNS fallback response rejected')
    if body.get('Question')!=[{'name':host+'.','type':1}]:
        raise ValueError('DNS fallback question mismatch')
    result=[]
    for answer in body.get('Answer',[]):
        if answer.get('type')!=1 or answer.get('name','').rstrip('.')!=host:
            continue
        address=ipaddress.ip_address(answer['data'])
        if address.version!=4 or not address.is_global or int(answer.get('TTL',0))<=0:
            raise ValueError('DNS fallback address rejected')
        result.append(str(address))
    if not result:
        raise ValueError('DNS fallback has no public IPv4 answer')
    return sorted(set(result))


def ensure_dns(host,hosts_file):
    # libc/getent is bounded as well; a broken resolver must not hold CI forever.
    try:
        resolved=subprocess.run(['getent','ahostsv4',host],capture_output=True,text=True,timeout=8)
        if resolved.returncode==0 and any(ipaddress.ip_address(line.split()[0]).is_global for line in resolved.stdout.splitlines() if line.split()):
            print('HOSTED_APT_DNS=system host='+host);return
    except (subprocess.TimeoutExpired,ValueError):
        pass
    query=urllib.parse.urlencode({'name':host,'type':'A','edns_client_subnet':'0.0.0.0/0'})
    # HTTPS certificate validation, default DNSSEC checking and apt signatures
    # remain enabled. No fixed IP, broad resolver change, proxy, or TLS bypass.
    raw=subprocess.run(['curl','--fail','--silent','--show-error','--connect-timeout','5','--max-time','12','https://dns.google/resolve?'+query],capture_output=True,text=True,check=True,timeout=15)
    addresses=checked_answers(host,json.loads(raw.stdout))
    with hosts_file.open('a') as stream:
        stream.write('\n# Light Remote disposable hosted-runner apt DNS recovery\n')
        for address in addresses:
            stream.write(address+' '+host+'\n')
    print('HOSTED_APT_DNS=https-fallback host='+host+' publicIPv4='+str(len(addresses)))


def self_test():
    assert replace_host('URIs: http://azure.archive.ubuntu.com/ubuntu/')=='URIs: https://archive.ubuntu.com/ubuntu/'
    for original in ['https://security.ubuntu.com/ubuntu','https://azure.archive.ubuntu.com.attacker.invalid/ubuntu','Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg']:
        assert replace_host(original)==original
    with tempfile.TemporaryDirectory(prefix='lr-apt-probe-') as temp:
        fixture=pathlib.Path(temp).resolve();file=fixture/'apt-mirrors.txt'
        file.write_text('http://azure.archive.ubuntu.com/ubuntu priority:1\nhttps://security.ubuntu.com/ubuntu priority:2\n')
        assert rewrite(fixture)==1
        assert file.read_text()=='https://archive.ubuntu.com/ubuntu priority:1\nhttps://security.ubuntu.com/ubuntu priority:2\n'
        assert rewrite(fixture)==0
    sample={'Status':0,'Question':[{'name':'archive.ubuntu.com.','type':1}],'Answer':[{'name':'archive.ubuntu.com.','type':1,'TTL':60,'data':'91.189.91.81'}]}
    assert checked_answers(HOSTS[0],sample)==['91.189.91.81']
    for change in [{'Status':2},{'TC':True},{'CD':True},{'Question':[{'name':'other.invalid.','type':1}]},{'Answer':[{'name':'archive.ubuntu.com.','type':1,'TTL':60,'data':'127.0.0.1'}]},{'Answer':[]}]:
        try:checked_answers(HOSTS[0],{**sample,**change})
        except ValueError:pass
        else:raise AssertionError('unsafe DNS response accepted')
    print('HOSTED_APT_MIRROR_SELF_TEST=PASS')


if __name__=='__main__':
    if '--self-test' in sys.argv:
        self_test();raise SystemExit(0)
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted':
        raise SystemExit('hosted_runner_only')
    root=pathlib.Path('/etc/apt').resolve()
    print('HOSTED_UBUNTU_MIRROR_FILES_UPDATED='+str(rewrite(root)))
    (root/'apt.conf.d/zz-lightremote-ci').write_text('Acquire::Retries "1";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\nAcquire::ForceIPv4 "true";\n')
    for host in HOSTS:
        ensure_dns(host,pathlib.Path('/etc/hosts'))
    subprocess.run(['apt-config','dump','Acquire::Retries','Acquire::http::Timeout','Acquire::https::Timeout','Acquire::ForceIPv4'],check=True)
