"""Replace the failing Azure Ubuntu mirror on disposable GitHub-hosted runners.

Keep repository suites, signing keys and all package verification intact.
Never used by ARM, production deployment or the product installer.
"""
import os
import pathlib
import re
import sys


def replace_host(text):
    return re.sub(r'(?<=://)azure\.archive\.ubuntu\.com(?=[:/])', 'archive.ubuntu.com', text)


if '--self-test' in sys.argv:
    assert replace_host('URIs: http://azure.archive.ubuntu.com/ubuntu/') == 'URIs: http://archive.ubuntu.com/ubuntu/'
    assert replace_host('https://azure.archive.ubuntu.com/ubuntu noble main') == 'https://archive.ubuntu.com/ubuntu noble main'
    for original in ['https://security.ubuntu.com/ubuntu', 'https://azure.archive.ubuntu.com.attacker.invalid/ubuntu', 'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg']:
        assert replace_host(original) == original
    print('HOSTED_APT_MIRROR_SELF_TEST=PASS')
    raise SystemExit(0)

if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted':
    raise SystemExit('hosted_runner_only')
root=pathlib.Path('/etc/apt').resolve()
files=[root/'sources.list',*(root/'sources.list.d').glob('*.list'),*(root/'sources.list.d').glob('*.sources'),*(root/'mirrors').glob('*.list')]
changed=0
for file in files:
    if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(root):
        continue
    old=file.read_text()
    new=replace_host(old)
    if new!=old:
        file.write_text(new)
        changed+=1
print('HOSTED_UBUNTU_MIRROR_FILES_UPDATED='+str(changed))
