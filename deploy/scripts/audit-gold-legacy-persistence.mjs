import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldRegistryPersistence} from '../../lib/gold-registry-persistence.mjs';
assert.equal(process.env.LIGHT_REMOTE_GOLD_INDEPENDENT,'1','gold_only');
assert.equal(process.env.LR_GOLD_INSTANCE_ID,'uat19','uat_only');
const root=fs.realpathSync(process.env.LIGHT_REMOTE_GOLD_ROOT);
const stateRoot='/var/lib/light-remote-gold-uat';
const guard=new GoldRegistryPersistence({pool:{query(){},connect(){}}});
assert.throws(()=>guard.mount('accounts',{stateFile:'/tmp/legacy-accounts.json'}),
  /gold_legacy_statefile_forbidden:accounts/,'legacy JSON fallback not rejected');
const op=fs.readFileSync(path.join(root,'operator-host/executor.mjs'),'utf8');
const plugin=fs.readFileSync(path.join(root,'plugin-server/server.mjs'),'utf8');
const mount=fs.readFileSync(path.join(root,'lib/gold-registry-persistence.mjs'),'utf8');
const domains=['usage','devices','enrollments','connections','access_grants','agent_clients','accounts','pro_teams','licenses'];
for(const domain of domains)assert.ok(op.includes("goldRegistries.mount('"+domain+"'"),'missing_pg_native_mount:'+domain);
for(const domain of ['support_outbox','paddle_billing'])assert.ok(plugin.includes("goldPluginStates.mount('"+domain+"'"),'missing_pg_plugin_mount:'+domain);
assert.ok(mount.includes('instance.stateFile=null'),'legacy_file_writer_not_disabled');
assert.ok(!op.includes('new FreeBenefitRegistry('),'free_benefit_json_registry_active');
const code=op+'\n'+plugin+'\n'+mount;
assert.equal(/(?:from\s*['"][^'"]*sqlite|require\s*\(\s*['"][^'"]*sqlite|better-sqlite3)/i.test(code),false,'sqlite_driver_in_gold_runtime');
const legacy=[];
const allowedLocal=new Set(['wall/auth.json','wall/device.json']);
let agentLocal=[];
function scan(folder){
 if(!fs.existsSync(folder))return;
 for(const dir of fs.readdirSync(folder,{withFileTypes:true})){
  const abs=path.join(folder,dir.name);
  if(dir.isDirectory()){if(['node_modules','.git'].includes(dir.name))continue;scan(abs);continue}
  if(!dir.isFile())continue;
  const rel=path.relative(stateRoot,abs).split(path.sep).join('/');
  const f=dir.name.toLowerCase();
  if(/\.(sqlite3?|db)(?:-wal|-shm)?$/.test(f))legacy.push(abs);
  if(abs.startsWith(stateRoot+path.sep)&&f.endsWith('.json')){
   if(allowedLocal.has(rel))agentLocal.push(rel);
   else legacy.push(abs);
  }
 }
}
scan(stateRoot);
scan(root);
assert.deepEqual(legacy,[],'forbidden_legacy_persistence_files');
assert.deepEqual(agentLocal.sort(),['wall/auth.json','wall/device.json'],'unexpected_local_agent_file_state');
const gold=await connectGoldStorage();
try{
 const migrations=await gold.pool.query('SELECT count(*)::int n FROM lr_schema_migrations');
 assert.equal(migrations.rows[0].n,31);
 const snap=await gold.pool.query("SELECT to_regclass('public.lr_gold_registry_documents') AS snapshot_table");
 assert.equal(snap.rows[0].snapshot_table,null,'generic_jsonb_snapshot_table_still_exists');
 const p=await gold.pool.query("SELECT count(*)::int AS n FROM lr_teams");
 assert.equal(p.rows[0].n,0,'uat_fixture_team_not_clean');
 console.log('GOLD_NO_LEGACY_SQLITE_OR_BUSINESS_JSON_FILES=PASS');
 console.log('GOLD_11_POSTGRES_REGISTRY_DOMAINS=PASS');
 console.log('GOLD_LOCAL_WALL_AUTH_IDENTITY_CONFIG=2_ALLOWED');
 console.log('GOLD_SCHEMA_31_NO_GENERIC_JSONB_SNAPSHOT=PASS');
}finally{await gold.close()}
