import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-gold-site-announcements-'));
process.env.LR_GOLD_SITE_ANNOUNCEMENTS_PG='1';
process.env.LIGHT_REMOTE_SITE_CONTENT_PATH=path.join(dir,'must-never-be-written.json');
const site=await import('../../plugin-server/site-announcements.mjs');
const {GoldPgSiteAnnouncementsRepository}=await import('../src/storage/site-announcements-pg.mjs');
let rows=new Map(),queries=[],released=0,rollbacks=0;
const columns=['announcement_id','enabled','title','message','theme','background','color',
'link_color','link_label','link_url','pages','audience','kind','platforms',
'priority','dismissible','starts_at','ends_at','updated_at'];
const rowFrom=params=>Object.fromEntries(columns.map((col,i)=>[col,
  ['starts_at','ends_at','updated_at'].includes(col)&&params[i]?new Date(params[i]):params[i]]));
const query=async(sql,params=[])=>{
  queries.push({sql,params});
  if(sql.startsWith('SELECT * FROM lr_site_announcements ORDER BY'))return {rows:[...rows.values()].sort((a,b)=>b.priority-a.priority)};
  if(sql.startsWith('SELECT pg_advisory_xact_lock')||sql==='BEGIN'||sql==='COMMIT')return{rows:[]};
  if(sql==='ROLLBACK'){rollbacks++;return{rows:[]}};
  if(sql.startsWith('SELECT COUNT(*)::int'))return{rows:[{count:rows.size}]};
  if(sql.startsWith('INSERT INTO lr_site_announcements')){
    const row=rowFrom(params);rows.set(row.announcement_id,row);return{rows:[row]};}
  if(sql.startsWith('SELECT * FROM lr_site_announcements WHERE')){
    return{rows:rows.has(params[0])?[rows.get(params[0])]:[]};}
  if(sql.startsWith('UPDATE lr_site_announcements')){
    const row=rowFrom(params);rows.set(row.announcement_id,row);return{rows:[row]};}
  if(sql.startsWith('DELETE FROM lr_site_announcements WHERE')){
    const row=rows.get(params[0]);rows.delete(params[0]);return{rows:row?[row]:[]};}
  throw Error('unexpected_pg_query:'+sql);
};
const pool={query,connect:async()=>({query,release:()=>{released++}})};
test('Gold announcements: one PostgreSQL repository serves Admin CRUD, site banner and device feed',async()=>{
 const repo=new GoldPgSiteAnnouncementsRepository({pool});
 site.configureGoldPgSiteAnnouncements(repo);
 assert.deepEqual(await site.listAnnouncements(),[]);
 const created=await site.mutateAnnouncement('POST',null,{
  enabled:true,title:'Gold Release',message:'New device features',
  audience:'both',platforms:['windows','linux'],pages:['/'],
  linkUrl:'/downloads',kind:'update',priority:10,
 });
 assert.equal(rows.size,1);assert.equal(created.audience,'both');
 assert.equal((await site.listAnnouncements())[0].id,created.id);
 assert.match(await site.announcementHtml('/'),/Gold Release/);
 const win=await site.clientAnnouncementFeed({platform:'windows'});
 assert.equal(win.items.length,1);assert.equal(win.items[0].kind,'update');
 assert.equal((await site.clientAnnouncementFeed({platform:'macos'})).items.length,0);
 const updated=await site.mutateAnnouncement('PUT',created.id,{message:'Update delivered'});
 assert.equal(updated.message,'Update delivered');
 assert.match(await site.announcementHtml('/'),/Update delivered/);
 assert.equal((await site.mutateAnnouncement('DELETE',created.id)).id,created.id);
 assert.equal((await site.listAnnouncements()).length,0);
 assert.equal(released,2);
 assert(queries.some(x=>x.sql.startsWith('SELECT pg_advisory_xact_lock')));
 assert(queries.some(x=>x.sql.startsWith('INSERT INTO lr_site_announcements')&&x.params[3]==='New device features'));
 assert(!fs.existsSync(process.env.LIGHT_REMOTE_SITE_CONTENT_PATH),'Gold must never create its legacy JSON state file');
});
test('Gold database read failure denies website feed instead of falling back to JSON',async()=>{
 const old=pool.query;
 pool.query=async()=>{throw Error('gold_pg_database_unavailable')};
 try{
  await assert.rejects(()=>site.listAnnouncements(),/gold_pg_database_unavailable/);
  await assert.rejects(()=>site.clientAnnouncementFeed({platform:'windows'}),/gold_pg_database_unavailable/);
 }finally{
  pool.query=old;fs.rmSync(dir,{recursive:true,force:true});
 }
});
