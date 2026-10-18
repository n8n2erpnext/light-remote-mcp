import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initializeSiteAnnouncements,refreshSiteAnnouncements,mutateAnnouncement,listAnnouncements} from '../../plugin-server/site-announcements.mjs';

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
console.log('GOLD_NATIVE_ANNOUNCEMENTS_SQL_FAKE=PASS');
