import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {validateLinuxHostWritePaths,linuxServicePolicy} from '../../device-agent/linux-service-policy.mjs';

const noHost=validateLinuxHostWritePaths([]);
assert.deepEqual(noHost,[]);
assert.deepEqual(validateLinuxHostWritePaths(['/etc/systemd/system','/etc/systemd/system']),['/etc/systemd/system']);
const invalid=['/','/etc','/usr','/usr/local','/home','/var/lib','/tmp','/opt/../etc','/etc//systemd/system','/etc/systemd/system/','/etc/systemd/system;rm'];
for(const path of invalid)assert.throws(()=>validateLinuxHostWritePaths([path]),undefined,'must deny '+path);
assert.throws(()=>validateLinuxHostWritePaths(['/etc/systemd/system','/etc/systemd/system','/etc/systemd/system','/etc/systemd/system','/etc/systemd/system']),/host_write_paths_limit_exceeded/);
const mock=(mode,uid=0,realpath='/opt/lr-gold-fixture')=>({
 realpathSync:()=>realpath,
 lstatSync:()=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid,mode}),
});
assert.deepEqual(validateLinuxHostWritePaths(['/opt/lr-gold-fixture'],{filesystem:mock(0o40755)}),['/opt/lr-gold-fixture']);
assert.throws(()=>validateLinuxHostWritePaths(['/opt/lr-gold-fixture'],{filesystem:mock(0o40777)}),/host_write_path_not_root_owned_directory/);
assert.throws(()=>validateLinuxHostWritePaths(['/opt/lr-gold-fixture'],{filesystem:mock(0o40755,1000)}),/host_write_path_not_root_owned_directory/);
assert.throws(()=>validateLinuxHostWritePaths(['/opt/lr-gold-fixture'],{filesystem:mock(0o40755,0,'/etc')}),/host_write_path_symlink/);
const helper=new URL('../../device-agent/linux-service-policy.mjs',import.meta.url).pathname;
const cli=spawnSync(process.execPath,[helper,'/tmp/nonexistent.json','hostWritePaths','/etc/systemd/system'],{encoding:'utf8'});
assert.equal(cli.status,0);
assert.equal(cli.stdout,'/etc/systemd/system');
const normal=linuxServicePolicy({enrollment:{grantableCapabilities:['filesystem']}});
assert.equal(normal.noNewPrivileges,true);
const catalogOnly=linuxServicePolicy({enrollment:{grantableCapabilities:['sudo-on-demand'],approvedCapabilities:[]}});
assert.equal(catalogOnly.noNewPrivileges,true,'catalog must not relax systemd without owner approval');
const sudo=linuxServicePolicy({enrollment:{grantableCapabilities:['sudo-on-demand'],approvedCapabilities:['sudo-on-demand']}});
assert.equal(sudo.noNewPrivileges,false,'server-approved sudo should enable the approved path');
const mainOff=linuxServicePolicy({enrollment:{enrollmentId:'trusted-host',grantableCapabilities:['sudo-on-demand']},policy:{deniedCapabilities:['sudo-on-demand']}});
assert.equal(mainOff.noNewPrivileges,true,'trusted Main local OFF must keep systemd hardened');
const mainOn=linuxServicePolicy({enrollment:{enrollmentId:'trusted-host',grantableCapabilities:['sudo-on-demand']},policy:{deniedCapabilities:[]}});
assert.equal(mainOn.noNewPrivileges,false,'trusted Main local ON may enable approved path');
for(const file of ['../../client/linux/install.sh','../../device-agent/install-linux-service.sh']){
 const script=fs.readFileSync(new URL(file,import.meta.url),'utf8');
 assert.match(script,/--host-write-path/);
 assert.match(script,/--acknowledge-host-write-risk/);
 assert.match(script,/--clear-host-write-paths/);
 assert.match(script,/host-write-paths\.list/);
 assert.match(script,/ReadWritePaths=\$[^\n]+ \$HOST_WRITE_VALIDATED/);
 assert.match(script,/ProtectSystem=strict/);
}
for(const path of ['/etc/systemd/system','/usr/local/libexec']){
 try{console.log('GOLD_HOST_WRITE_REALPATH',path,validateLinuxHostWritePaths([path]));}catch(e){console.log('GOLD_HOST_WRITE_REALPATH_UNAVAILABLE',path,e.code||e.message);}
}
console.log('GOLD_HOST_WRITE_DEFAULT_RESTRICTED=PASS');
console.log('GOLD_HOST_WRITE_OWNER_PATH_VALIDATION=PASS');
console.log('GOLD_HOST_WRITE_INSTALLERS_CONSISTENT=PASS');
