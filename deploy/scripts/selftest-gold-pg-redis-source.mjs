import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const home=path.join(root,'infra/pgredis');
const manifest=JSON.parse(fs.readFileSync(path.join(home,'migrations/migrations.lock.json'),'utf8'));
assert.equal(manifest.format,1);
assert.equal(manifest.migrations.length,18);
const names=new Set();
for(const [index,m] of manifest.migrations.entries()){
  assert.equal(m.version,index+1);
  assert.match(m.file,/^[0-9]{3}_[a-z_]+\.sql$/);
  assert.equal(names.has(m.file),false);names.add(m.file);
  const body=fs.readFileSync(path.join(home,'migrations',m.file));
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'),m.sha256);
}
const files=fs.readdirSync(path.join(home,'migrations'))
  .filter(x=>/^[0-9]{3}_.*\.sql$/.test(x)).sort();
assert.deepEqual(files,[...names].sort());
console.log('GOLD_PG_SQL_IMMUTABLE_HASHES_18_PASS');
const compose=fs.readFileSync(path.join(home,'compose.yml'),'utf8');
assert.match(compose,/postgres:17-alpine/);
assert.match(compose,/redis:8-alpine/);
assert.match(compose,/internal:\s*true/);
assert.match(compose,/restart:\s*unless-stopped/);
assert.match(compose,/LR_GOLD_PG_ENV:\?/);
assert.match(compose,/LR_GOLD_REDIS_CONF:\?/);
const redisTemplate=fs.readFileSync(path.join(home,'redis.example.conf'),'utf8');
assert.match(redisTemplate,/appendonly yes/);
assert.match(redisTemplate,/protected-mode yes/);
assert.match(redisTemplate,/requirepass <random-secret-stored-outside-repo>/);
assert.doesNotMatch(compose,/^\s*ports:/m);
assert.doesNotMatch(compose,/^\s*name:/m);
assert.doesNotMatch(compose,/^\s*network_mode:/m);
assert.doesNotMatch(compose,/^\s*privileged:/m);
console.log('GOLD_PG_REDIS_ISOLATION_STATIC_CONTRACT_PASS');
