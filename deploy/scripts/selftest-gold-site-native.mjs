import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {initializeSiteAnnouncements,refreshSiteAnnouncements,mutateAnnouncement,listAnnouncements,clientAnnouncementFeed,wallAnnouncementFeed} from '../../plugin-server/site-announcements.mjs';

const table=new Map();
const cols=['id','enabled','title','message','theme','background','color','link_color','link_label','link_url','pages','audience','kind','platforms','priority','dismissible','start_at','end_at','updated_at'];
const rowOf=v=>Object.fromEntries(cols.map((col,i)=>[col,v[i]]));
const sqlLog=[];
const pool={
 async query(query,args=[]){return execute(query,args)},
 async connect(){return {query:execute,release(){}}}
};
async function execute(sql,args=[]){
 sqlLog.push(sql);
 if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.includes('pg_advisory_xact_lock'))return {rows:[]};
 if(sql.startsWith('INSERT INTO lr_site_announcements')){
  if(table.has(args[0])&&sql.includes('ON CONFLICT'))return {rows:[],rowCount:0};
  if(table.has(args[0]))throw Error('duplicate');
  table.set(args[0],rowOf(args));return {rows:[],rowCount:1};
 }
 if(sql.startsWith('SELECT * FROM lr_site_announcements ORDER BY'))return {rows:[...table.values()]};
 if(sql.startsWith('SELECT COUNT(*)'))return {rows:[{total:table.size}]};
 if(sql.startsWith('SELECT * FROM lr_site_announcements WHERE id'))return {rows:table.has(args[0])?[table.get(args[0])]:[]};
 if(sql.startsWith('UPDATE lr_site_announcements SET')){table.set(args[0],rowOf(args));return {rows:[],rowCount:1};}
 if(sql.startsWith('DELETE FROM lr_site_announcements WHERE id')){const row=table.get(args[0]);table.delete(args[0]);return {rows:row?[row]:[]};}
 throw Error('unexpected_query:'+sql);
}
await initializeSiteAnnouncements(pool);
assert.equal(listAnnouncements().length,1);
const newNotice=await mutateAnnouncement('POST',null,{enabled:true,title:'Gold Native SQL',message:'Test relational announcement',pages:['/'],kind:'update',audience:'site'});
assert.ok(table.has(newNotice.id));
assert.equal(table.get(newNotice.id).title,'Gold Native SQL');
await mutateAnnouncement('PUT',newNotice.id,{title:'Gold SQL Updated'});
assert.equal(table.get(newNotice.id).title,'Gold SQL Updated');
await refreshSiteAnnouncements();
assert.ok(listAnnouncements().some(r=>r.title==='Gold SQL Updated'));
await mutateAnnouncement('DELETE',newNotice.id);
assert.ok(!table.has(newNotice.id));
assert.ok(sqlLog.every(sql=>!sql.includes('::jsonb')&&!sql.includes('payload')));
const migration=fs.readFileSync('platform-v2/sql/018_gold_site_announcements_native.sql','utf8');
assert.ok(migration.includes('pages TEXT[]')&&migration.includes('priority SMALLINT')&&!migration.includes('payload JSONB'));
// Admin destinations are exclusive. Wall feed cannot leak distribution notices.
const distribution=await mutateAnnouncement('POST',null,{enabled:true,title:'Distribution Only',
 message:'Distribution notice',kind:'update',audience:'clients',platforms:['windows']});
const wall=await mutateAnnouncement('POST',null,{enabled:true,title:'Wall Only',
 message:'Wall notice',kind:'service',audience:'wall',platforms:['windows']});
const both=await mutateAnnouncement('POST',null,{enabled:true,title:'Website + Distribution',
 message:'Distribution and website',kind:'feature',audience:'both',pages:['/'],platforms:['windows']});
const web=clientAnnouncementFeed({platform:'windows'}),wallFeed=wallAnnouncementFeed({platform:'windows'});
assert.equal(wallFeed.channel,'wall');
assert.deepEqual(web.items.map(x=>x.id).sort(),[distribution.id,both.id].sort());
assert.deepEqual(wallFeed.items.map(x=>x.id),[wall.id]);
assert.equal(wallAnnouncementFeed({platform:'macos'}).items.length,0);
assert.equal(clientAnnouncementFeed({platform:'linux'}).items.length,0);
assert.notEqual(web.revision,wallFeed.revision);
const policy=fs.readFileSync('platform-v2/sql/042_gold_wall_announcements_channel.sql','utf8');
assert.match(policy,/audience IN \('site','clients','both','wall'\)/);
const admin=fs.readFileSync('plugin-server/admin-portal/index.html','utf8');
assert.match(admin,/announcementDistributionTab/);assert.match(admin,/announcementWallTab/);
assert.match(admin,/announcementChannel==='wall'/);
for(const m of admin.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g))
 if(m[1].trim())new vm.Script(m[1],{filename:'gold-admin-announcements.inline.js'});
await mutateAnnouncement('DELETE',distribution.id);
await mutateAnnouncement('DELETE',wall.id);
await mutateAnnouncement('DELETE',both.id);
console.log('GOLD_WALL_DISTRIBUTION_ANNOUNCEMENT_INDEPENDENT_FEEDS_AND_ADMIN_PASS');
console.log('GOLD_NATIVE_ANNOUNCEMENTS_SQL_FAKE=PASS');
