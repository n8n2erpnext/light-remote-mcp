import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {goldCredentials,verifyGoldSchema,verifyGoldRedis,openGoldDataPlane} from '../src/storage/gold-data-plane.mjs';
import {GoldPgNotificationRepository} from '../src/storage/notifications-pg.mjs';
import {goldTableManifest} from '../src/storage/gold-permissions.mjs';

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-gold-data-test-'));
  fs.mkdirSync(path.join(root,'secrets'),{mode:0o700});
  const write=(name,value)=>{
    const file=path.join(root,'secrets',name);
    fs.writeFileSync(file,value,{mode:0o600});return file;
  };
  const env={
    LIGHT_REMOTE_GOLD_INDEPENDENT:'1',LIGHT_REMOTE_GOLD_ROOT:root,
    OPERATOR_SOCKET:path.join(root,'run','operator.sock'),
    OPERATOR_STATE_DIR:path.join(root,'state'),
    OPERATOR_LOG_DIR:path.join(root,'logs'),
    OPERATOR_KEY_FILE:path.join(root,'secrets','operator.private'),
    LR_GOLD_INSTANCE_ID:'dev01',
    LR_GOLD_PG_URL_FILE:write('pg.url','postgres://lr_gold_app:secret@pg-dev:5432/light_remote_gold_dev\n'),
    LR_GOLD_REDIS_URL_FILE:write('redis.url','redis://:secret@redis-dev:6379/0\n'),
  };
  return {root,env,clear(){fs.rmSync(root,{recursive:true,force:true})}};
}
const schemaPool=({role='lr_gold_app',db='light_remote_gold_dev',superuser=false,unsafePolicy=false,versions=Array.from({length:19},(_,i)=>i+1),tables=goldTableManifest()}={})=>{
  let ended=0;return{
    query:async(sql)=>sql.includes('current_database')?
      {rows:[{db,role,superuser}]}:
      sql.includes('FROM pg_tables')?
      {rows:tables.map(tablename=>({tablename}))}:
      sql.includes("has_schema_privilege(current_user")?
      {rows:[{schema_usage:true,schema_create:unsafePolicy,ledger_read:true,
        ledger_insert:false,ledger_update:false,inherited_migrator:false}]}:
      {rows:versions.map(version=>({version}))},
    end:async()=>{ended++},get ended(){return ended}
  };
};
const redisClient=({fail=false}={})=>{
  const m=new Map();let closed=false;
  return {
    isOpen:false,connect:async function(){this.isOpen=true},
    ping:async()=>fail?'WRONG':'PONG',
    set:async(k,v,o)=>{assert(o.NX&&o.EX===15);m.set(k,v);return'OK'},
    get:async k=>m.get(k)??null,
    del:async k=>Number(m.delete(k)),
    quit:async()=>{closed=true},disconnect:async()=>{closed=true},
    get closed(){return closed},get keyCount(){return m.size}
  };
};
test('Gold file credentials and target DB name/role are mandatory',()=>{
  const f=fixture();try{
    const x=goldCredentials(f.env);
    assert.equal(x.instance,'dev01');assert.match(x.urls.pg,/lr_gold_app/);
    assert.throws(()=>goldCredentials({...f.env,LR_GOLD_INSTANCE_ID:'!'}),/gold_instance_id_required/);
    assert.throws(()=>goldCredentials({...f.env,LR_GOLD_PG_URL_FILE:'/etc/shadow'}),/gold_pg_credentials_outside_root|gold_pg_credentials_perms/);
    fs.chmodSync(f.env.LR_GOLD_PG_URL_FILE,0o644);
    assert.throws(()=>goldCredentials(f.env),/gold_pg_credentials_perms/);
    fs.chmodSync(f.env.LR_GOLD_PG_URL_FILE,0o600);
    fs.writeFileSync(f.env.LR_GOLD_PG_URL_FILE,'postgres://postgres:secret@pg-dev:5432/light_remote_gold_dev');
    assert.throws(()=>goldCredentials(f.env),/gold_pg_invalid_role/);
  }finally{f.clear()}
});
test('Gold plugin role validates all plugin-owned state paths before sharing one PG/Redis data plane',()=>{
  const f=fixture();try{
    const inRoot=p=>path.join(f.root,p);
    const fields={
      OPERATOR_SOCKET:inRoot('run/operator.sock'),
      LIGHT_REMOTE_PLUGIN_OAUTH_SECRET_FILE:inRoot('secrets/plugin-oauth'),
      LIGHT_REMOTE_PLUGIN_OAUTH_LEGACY_CLIENTS_FILE:inRoot('state/plugin-clients.json'),
      LIGHT_REMOTE_ACCOUNT_RECOVERY_FILE:inRoot('state/recovery.json'),
      LIGHT_REMOTE_PADDLE_STATE_FILE:inRoot('state/paddle.json'),
      LIGHT_REMOTE_SITE_ANALYTICS_PATH:inRoot('state/analytics.json'),
      LIGHT_REMOTE_SITE_CONTENT_PATH:inRoot('state/content.json'),
      LIGHT_REMOTE_SUPPORT_OUTBOX_FILE:inRoot('state/support.json'),
      LIGHT_REMOTE_GOOGLE_OAUTH_FILE:inRoot('state/google.json'),
      LIGHT_REMOTE_BACKOFFICE_CONFIG_FILE:inRoot('secrets/backoffice.json'),
      LIGHT_REMOTE_DISTRIBUTION_DIR:inRoot('distribution'),
      LIGHT_REMOTE_MAIL_ENV_FILE:inRoot('secrets/mail.env'),
      LIGHT_REMOTE_OPENAI_CHALLENGE_FILE:inRoot('secrets/challenge'),
      LIGHT_REMOTE_PLUGIN_HOST:'127.0.0.1',
      LIGHT_REMOTE_PLUGIN_ORIGIN:'http://127.0.0.1:5979',
      LIGHT_REMOTE_PLUGIN_ALLOW_HTTP_LOOPBACK:'1',
      LIGHT_REMOTE_PADDLE_ENV:'sandbox'
    };
    const env={...f.env,...fields};
    assert.equal(goldCredentials(env,{role:'plugin'}).instance,'dev01');
    assert.throws(()=>goldCredentials({...env,LIGHT_REMOTE_SITE_CONTENT_PATH:'/var/lib/light-remote-direct/plugin-state/site-content.json'},{role:'plugin'}),/gold_isolation_outside_root_LIGHT_REMOTE_SITE_CONTENT_PATH/);
    assert.throws(()=>goldCredentials({...env,LIGHT_REMOTE_PADDLE_ENV:'live'},{role:'plugin'}),/gold_staging_live_paddle_forbidden/);
  }finally{f.clear()}
});
test('Gold PG admits only exact least-privilege role, DB and all 19 migrations',async()=>{
  assert.equal((await verifyGoldSchema(schemaPool())).schemaVersion,19);
  await assert.rejects(()=>verifyGoldSchema(schemaPool({role:'postgres'})),/gold_pg_database_role_mismatch/);
  await assert.rejects(()=>verifyGoldSchema(schemaPool({superuser:true})),/gold_pg_database_role_mismatch/);
  await assert.rejects(()=>verifyGoldSchema(schemaPool({unsafePolicy:true})),/gold_pg_app_privileges_unsafe/);
  await assert.rejects(()=>verifyGoldSchema(schemaPool({versions:[1,2,3]})),/gold_pg_schema_incomplete/);
  await assert.rejects(()=>verifyGoldSchema(schemaPool({tables:goldTableManifest().slice(1)})),/gold_pg_table_catalog_incomplete_or_drifted/);
  await assert.rejects(()=>verifyGoldSchema(schemaPool({tables:[...goldTableManifest(),'lr_unauthorized']})),/gold_pg_table_catalog_incomplete_or_drifted/);
  await assert.rejects(()=>verifyGoldSchema(schemaPool({versions:[1,1,...Array.from({length:11},(_,i)=>i+3)]})),/gold_pg_schema_incomplete/);
});
test('Gold Redis readiness probes namespace and deletes its own ephemeral key',async()=>{
  const redis=redisClient();const r=await verifyGoldRedis(redis,{instance:'dev01'});
  assert.equal(r.prefix,'lr:gold:dev01:');assert.equal(r.cacheOnly,true);
  assert.equal(redis.keyCount,0);
  await assert.rejects(()=>verifyGoldRedis(redisClient({fail:true}),{instance:'dev01'}),/gold_redis_unavailable/);
});
test('Gold data plane opens and closes only after PG/Redis checks',async()=>{
  const f=fixture();try{
    const pg=schemaPool(),cache=redisClient();
    const x=await openGoldDataPlane({env:f.env,poolFactory:()=>pg,redisFactory:()=>cache});
    assert.equal(x.postgres.role,'lr_gold_app');
    await x.close();assert.equal(pg.ended,1);assert(cache.closed);
    const badPg=schemaPool({versions:[]});
    await assert.rejects(()=>openGoldDataPlane({env:f.env,poolFactory:()=>badPg}),/gold_data_plane_not_ready/);
    assert.equal(badPg.ended,1);
    const okPg=schemaPool(),badRedis=redisClient({fail:true});
    await assert.rejects(()=>openGoldDataPlane({env:f.env,poolFactory:()=>okPg,redisFactory:()=>badRedis}),/gold_data_plane_not_ready/);
    assert.equal(okPg.ended,1);assert(badRedis.closed);
  }finally{f.clear()}
});
const nid='sys_11111111-2222-4333-8444-555555555555';
const record={
  notification_id:nid,category:'security',title:'Account alert',body:'Test scope only',
  link:'/account/inbox',audience_type:'account',audience_value:'acct-one',
  published_by:'admin',created_at:new Date('2026-10-17T10:00:00Z'),
  scheduled_at:new Date('2026-10-17T10:00:00Z'),expires_at:null,canceled_at:null,
  read_count:0,read_at:null
};
test('PG notification SQL is parameterized and account scoped; never needs JSON files',async()=>{
  const queries=[];
  const pool={query:async(sql,args=[])=>{
    queries.push([sql,args]);
    if(sql.startsWith('INSERT INTO lr_notifications('))return{rows:[{...record,notification_id:args[0]}]};
    if(sql.startsWith('SELECT n.*,rd.read_at'))return{rows:[record]};
    if(sql.startsWith('INSERT INTO lr_notification_reads('))return{rows:args[0]==='acct-one'?[{notification_id:nid}]:[]};
    if(sql.startsWith('SELECT n.*,'))return{rows:[record]};
    if(sql.startsWith('UPDATE lr_notifications'))return{rows:[{...record,canceled_at:new Date()}]};
    throw Error('unexpected_sql_'+sql);
  }};
  const repo=new GoldPgNotificationRepository({pool,now:()=>Date.parse('2026-10-17T10:00:00Z')});
  const written=await repo.publish({type:'security',title:'Account alert',body:'Test scope only',
    audienceType:'account',audienceValue:'acct-one'});
  assert.equal(written.audienceType,'account');
  assert(queries[0][0].includes('INSERT INTO lr_notifications'));
  assert.equal(queries[0][1][6],'acct-one');
  const inbox=await repo.inbox('acct-one',{plan:'free',groupId:'grp_default'});
  assert.equal(inbox.unreadCount,1);
  assert.deepEqual(queries[1][1],['acct-one','free','grp_default']);
  await assert.rejects(()=>repo.markRead('acct-two',nid,{plan:'free'}),/notification_not_found/);
  assert.equal(queries[2][1][0],'acct-two');
  assert.deepEqual(await repo.markRead('acct-one',nid,{plan:'free',groupId:'grp_default'}),{ok:true});
  assert.match(queries[3][0],/ON CONFLICT\(notification_id,account_id\) DO UPDATE/);
  assert.equal((await repo.list()).notifications[0].readCount,0);
  assert.equal((await repo.cancel(nid)).status,'canceled');
  await assert.rejects(()=>repo.publish({type:'security',title:'a',body:'b'}),/invalid_notification_content/);
  await assert.rejects(()=>repo.inbox('../foo'),/invalid_notification_account/);
});
