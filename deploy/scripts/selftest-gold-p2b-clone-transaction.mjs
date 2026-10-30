import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const file=fileURLToPath(new URL('gold-p2b-clone-transaction.sh',import.meta.url));
const s=fs.readFileSync(file,'utf8');
const syntax=spawnSync('bash',['-n',file],{encoding:'utf8',timeout:6000});
assert.equal(syntax.status,0,syntax.stderr);
const required=[
 'set -euo pipefail',
 'gold-p2a-runtime-rollback-20261030',
 "ls /sys/class/net",
 'P2B_NETWORK_GUARD_DENIED',
 'P2B_SQL_42_HASHES_VERIFIED',
 'P2B_NO_NIC_CLONE_SCHEMA039_GUARD=PASS',
 '--preflight',
 '--rehearse-failure',
 '--isolated-only',
 'P2B_MUTATION_DENIED',
 'pg_dump -Fc',
 'pg_restore --list',
 'redis-preimage.rdb',
 'four-units.tar',
 'SHA256SUMS.txt',
 'SET ROLE lr_gold_migrator',
 'migrations.lock.json',
 'P2B_REAL_SQL_039_TO_042=PASS',
 'ConditionPathExists=',
 'P2B_FOUR_SERVICE_BAD_CANDIDATE_DETECTED=PASS',
 'runuser -u postgres -- dropdb --force light_remote_gold_dev',
 'runuser -u postgres -- createdb -O lr_gold_migrator',
 'P2B_PG039_REDIS_RDB_FOUR_SERVICE_ROLLBACK=PASS',
 'P2B_M4_CLAIM_AND_27_UNKNOWN_WORK_PRESERVED=PASS',
 'P2B_RESTART_HEALTH_12_SAMPLES=PASS',
 'P2B_ALL_ORIGINAL_UNIT_FILES_RESTORED=PASS',
 '--rehearse-success',
 'P2B_CANDIDATE_HASH_AND_SYSTEMD_PRIORITY=PASS',
 'P2B_FOUR_SYSTEMD_OVERRIDES_EFFECTIVE=PASS',
 'P2B_REAL_IMMUTABLE_FOUR_SERVICE_SCHEMA042_CANDIDATE=PASS',
 'P2B_SUCCESS_CANDIDATE_15_SAMPLES_HTTP303=PASS',
 'P2B_OVERRIDE_NAME',
 'exit 43',
 'exit 42'
];
for(const item of required)assert.ok(s.includes(item),'missing '+item);
assert.ok(s.indexOf('guard\nif [[')<s.indexOf('WORK="$(mktemp -d'),
 'physical isolation before any preimage writes');
assert.ok(s.indexOf('PREPARED=1')<s.indexOf("trap 'rollback"),
 'rollback must be armed after verified paired preimages');
assert.ok(s.includes('< "$WORK/preimage039.dump"'),
 'PG restore should use direct stdin rather than pipefail-sensitive cat');
assert.doesNotMatch(s,/cat "\$WORK\/preimage039\.dump"\s*\|\s*runuser/);
assert.ok(s.includes('systemctl stop redis-server'));
assert.ok(s.includes('systemctl start redis-server'));
assert.ok(s.includes('tar -C "$SYS" -df "$WORK/four-units.tar"'));
assert.ok(!s.includes('FLUSHALL')&&!s.includes('FLUSHDB'));
console.log('GOLD_P2B_CLONE_TRANSACTION_STATIC_SAFETY=PASS');
