#!/usr/bin/env python3
"""Assemble verified, exact-commit CI packages into GitHub Release assets."""
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path


PRODUCTION_PROFILE = 'goldabv2-production'
PRODUCTION_ORIGIN = 'https://light-remote.thaiduy.digital'


def production_profile(source):
    catalog = json.loads((source / 'config/endpoints.json').read_text(encoding='utf-8'))
    profile = catalog.get('profiles', {}).get(PRODUCTION_PROFILE, {})
    origins = profile.get('cloudOrigins', {})
    if (catalog.get('selectedProfile') != PRODUCTION_PROFILE or
            profile.get('productId') != 'goldabv2-desktop-v4' or
            any(origins.get(role) != PRODUCTION_ORIGIN for role in ('owner', 'operator', 'deviceChannel', 'mcp'))):
        raise ValueError('The tagged source must embed the production endpoint profile')


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def unique_file(directory, filename):
    files = list(directory.rglob(filename))
    if len(files) != 1 or not files[0].is_file() or files[0].is_symlink():
        raise ValueError(f'Expected exactly one file {filename} in {directory.name}')
    return files[0]


def copy_verified(directory, filename, output):
    artifact = unique_file(directory, filename)
    declared = []
    for line in unique_file(directory, 'SHA256SUMS.txt').read_text(encoding='utf-8-sig').splitlines():
        entry = re.fullmatch(r'([0-9a-fA-F]{64}) [ *](.+)', line)
        if entry and entry[2].replace('\\', '/').rsplit('/', 1)[-1] == filename:
            declared.append(entry[1].lower())
    if declared != [digest(artifact)] or not artifact.stat().st_size:
        raise ValueError(f'CI checksum mismatch or missing asset: {filename}')
    shutil.copyfile(artifact, output)


def assemble(source, inputs, output, tag, sha, baseline, packages):
    version = (source / 'VERSION').read_text(encoding='utf-8').strip()
    if tag != 'v' + version or not re.fullmatch(r'v\d+\.\d+\.\d+(?:-(?:rc|beta)\.\d+)?', tag):
        raise ValueError('The production tag must exactly match VERSION and be a release, RC or beta')
    if not re.fullmatch(r'[a-f0-9]{40}', sha) or not (baseline.isdecimal() and packages.isdecimal()):
        raise ValueError('Expected a source commit and two successful CI run IDs')
    production_profile(source)
    win = inputs / f'light-remote-desktop-v4-COMPLETE-windows-x64-{sha}'
    manifest = json.loads(unique_file(win, 'BUILD_MANIFEST.json').read_text(encoding='utf-8-sig'))
    installer = 'Light-Remote-MCP-Setup-x64.exe'
    win_file = unique_file(win, installer)
    if (manifest.get('sourceCommit') != sha or str(manifest.get('ciRunId')) != baseline or
            manifest.get('projectVersion') != version or manifest.get('platform') != 'windows-x64' or
            manifest.get('dependencyHashes', {}).get('config/endpoints.json') != digest(source / 'config/endpoints.json') or
            manifest.get('artifact') != {'name': installer, 'bytes': win_file.stat().st_size, 'sha256': digest(win_file)}):
        raise ValueError('Windows build provenance does not match the tagged source and installer')

    output.mkdir()
    copy_verified(win, installer, output / f'Light-Remote-MCP-Setup-x64-{version}.exe')
    for arch, deb_arch, pkg_arch in [('x64', 'amd64', 'x86_64'), ('arm64', 'arm64', 'arm64')]:
        linux = inputs / f'gpt-operator-linux-{arch}-{sha}'
        mac = inputs / f'light-remote-macos-{arch}-{sha}'
        for directory, name in [
            (linux, f'Light-Remote-MCP-Client-Linux-{arch}-{version}.tar.gz'),
            (linux, f'light-remote_{version}_{deb_arch}.deb'),
            (mac, f'Light-Remote-Client-macOS-{arch}-{version}.tar.gz'),
            (mac, f'Light-Remote-{version}-{pkg_arch}.pkg'),
        ]:
            copy_verified(directory, name, output / name)

    shutil.copyfile(source / 'client/linux/install.sh', output / 'install-linux-client.sh')
    shutil.copyfile(source / 'plugin-server/downloads-install-linux.sh', output / 'downloads-install.sh')
    provenance = {'schemaVersion': 1, 'version': version, 'gitSha': sha,
                  'baselineRunId': baseline, 'packageRunId': packages,
                  'endpointProfile': PRODUCTION_PROFILE, 'publicOrigin': PRODUCTION_ORIGIN}
    (output / 'release-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    if len(sys.argv) != 8:
        sys.exit('usage: assemble-production-release.py SOURCE INPUT_DIR OUTPUT_DIR TAG SHA CI_RUN PACKAGE_RUN')
    source, inputs, output = map(Path, sys.argv[1:4])
    assemble(source, inputs, output, *sys.argv[4:])
