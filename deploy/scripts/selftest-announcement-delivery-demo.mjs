import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ClientAnnouncementInbox} from '../../lib/client-announcement-inbox.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-announce-demo-'));
process.env.LIGHT_REMOTE_SITE_CONTENT_PATH=path.join(dir,'site-content.json');
const {listAnnouncements,mutateAnnouncement,clientAnnouncementFeed,announcementHtml,registerClientAnnouncementFeed}=await import('../../plugin-server/site-announcements.mjs?test=client-announcements');
assert.equal(clientAnnouncementFeed({platform:'windows'}).items.length,0,'old website banner must not auto-send to clients');
const now=Date.now();
const windows=mutateAnnouncement('POST',null,{title:'New Windows build',message:'A new client release is available.',audience:'clients',kind:'update',
 enabled:true,platforms:['windows'],pages:['/'],startAt:new Date(now-15000).toISOString(),endAt:new Date(now+600000).toISOString(),linkUrl:'/downloads'});
const all=mutateAnnouncement('POST',null,{title:'Server maintenance',message:'Scheduled maintenance window',audience:'both',kind:'maintenance',
 enabled:true,platforms:['windows','macos','linux'],pages:['/'],linkUrl:'https://thaiduy.digital/',startAt:new Date(now-15000).toISOString(),endAt:new Date(now+600000).toISOString()});
const clientWindows=clientAnnouncementFeed({platform:'windows',now});
const clientMac=clientAnnouncementFeed({platform:'macos',now});
assert.equal(clientWindows.items.length,2);assert.equal(clientMac.items.length,1);assert.equal(clientMac.items[0].id,all.id);
assert(!announcementHtml('/').includes(windows.id),'client-only announcement cannot leak into website banner');
assert(announcementHtml('/').includes(all.id),'both audience still appears on homepage');
assert.throws(()=>clientAnnouncementFeed({platform:'invalid'}),/invalid_client_platform/);
assert.equal(clientAnnouncementFeed({platform:'windows',now:now+700000}).items.length,0,'expired notices not distributed');
const unsafe=mutateAnnouncement('POST',null,{title:'Unsafe URL rejected',message:'safe text',audience:'clients',enabled:true,platforms:['linux'],linkUrl:'javascript:alert(1)'});
assert.equal(unsafe.linkUrl,'');
mutateAnnouncement('DELETE',unsafe.id);
let incoming=0;
const fetchImpl=async()=>({ok:true,json:async()=>clientWindows});
const options={hub:'https://light-remote.thaiduy.digital',platform:'windows',storeFile:path.join(dir,'client-inbox.json'),fetchImpl,onNew:()=>{incoming++}};
const device=new ClientAnnouncementInbox(options);
assert.equal((await device.poll()).newItems,2);assert.equal(incoming,2);
assert.equal((await device.poll()).newItems,0);assert.equal(incoming,2);
const restarted=new ClientAnnouncementInbox(options);
assert.equal((await restarted.poll()).newItems,0);
const recorded=restarted.snapshot();assert.equal(recorded.items.length,2);
let handler=null;registerClientAnnouncementFeed({get:(route,fn)=>{assert.equal(route,'/api/client-announcements');handler=fn}});
let responseBody;
handler({query:{platform:'windows'}},{set(){return this},json(data){responseBody=data;return this}});
assert.equal(responseBody.items.length,2);
for(const file of ['maintenance.html','client-announcements.html']){
 const html=fs.readFileSync(new URL('../../plugin-server/demo/'+file,import.meta.url),'utf8');
 assert(html.includes('<!doctype html>')&&html.includes('data-theme="dark"'));
 assert(html.includes('DEMO ONLY')||html.includes('preview only'));
}
const maintenance=fs.readFileSync(new URL('../../plugin-server/demo/maintenance.html',import.meta.url),'utf8');
assert(maintenance.includes('Asia/Ho_Chi_Minh')&&maintenance.includes("Math.max(0,endAt-Date.now())"));
const editor=fs.readFileSync(new URL('../../plugin-server/admin-portal/index.html',import.meta.url),'utf8');
assert(editor.includes('announcementAudience')&&editor.includes('announcementPlatforms'));
fs.rmSync(dir,{recursive:true,force:true});
console.log('announcement_existing_website_notice_preserved=PASS');
console.log('announcement_explicit_client_opt_in_platforms_window=PASS');
console.log('announcement_public_feed_security_and_expiry=PASS');
console.log('announcement_shared_client_inbox_dedupe_after_restart=PASS');
console.log('maintenance_and_client_preview_assets=PASS');