import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA=process.env.LIGHT_REMOTE_SITE_CONTENT_PATH||'/var/lib/light-remote-direct/plugin-state/site-content.json';
const clientPlatforms=new Set(['windows','macos','linux']);
const clientKinds=new Set(['feature','update','maintenance','service']);
const allowedPages=new Set(['/','/downloads','/support','/ai-guide','/privacy','/terms','/cookies','/account','/account/login','/account/register']);
const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const max=(value,len)=>String(value??'').trim().slice(0,len);
const hex=(v,fallback)=>/^#[\da-f]{6}$/i.test(String(v||''))?String(v).toUpperCase():fallback;
const safeUrl=value=>{const url=max(value,600);if(!url)return '';if(url.startsWith('/')&&!url.startsWith('//')&&!url.includes('\\'))return url;try{const v=new URL(url);return v.protocol==='https:'?v.href:''}catch{return ''}};
const preset={
  brand:{background:'#FFCC00',color:'#111418',linkColor:'#111418'},
  graphite:{background:'#20252B',color:'#FFFFFF',linkColor:'#FFCC00'},
  info:{background:'#DDEDFB',color:'#143B60',linkColor:'#175992'},
  success:{background:'#DDF6E9',color:'#155535',linkColor:'#166D43'},
  warning:{background:'#FFF4C9',color:'#6D4A08',linkColor:'#785012'},
  danger:{background:'#FFE2E4',color:'#821B2C',linkColor:'#932035'},
};
const defaultAnnouncement={
 id:'6ad1f5d2-b087-4b52-8ea3-3fa4a89b3095',enabled:true,
 title:'LIGHT REMOTE',message:'Connect your devices securely with local A/B approval',
 theme:'brand',background:'#FFCC00',color:'#111418',linkColor:'#111418',
 linkLabel:'Download Light Remote →',linkUrl:'/downloads',
 pages:['/','/downloads','/support'],audience:'site',kind:'feature',platforms:['windows','macos','linux'],priority:0,dismissible:true,startAt:'',endAt:'',updatedAt:new Date().toISOString()
};
let entries=[defaultAnnouncement];
try{const data=JSON.parse(fs.readFileSync(DATA,'utf8'));if(Array.isArray(data?.announcements))entries=data.announcements.slice(0,100)}catch{}
function persist(){
 fs.mkdirSync(path.dirname(DATA),{recursive:true,mode:0o750});
 const tmp=DATA+'.'+process.pid+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify({version:1,announcements:entries}),{mode:0o640});
 fs.renameSync(tmp,DATA);
}
function sanitize(v,prior={}){
 const title=max(v.title??prior.title,110),message=max(v.message??prior.message,400);
 if(!title&&!message)throw Object.assign(new Error('announcement_text_required'),{status:400});
 const theme=Object.hasOwn(preset,String(v.theme??prior.theme))?String(v.theme??prior.theme):'brand';
 const colors=preset[theme];
 const pages=Array.isArray(v.pages)?v.pages.filter(p=>allowedPages.has(p)).slice(0,20):prior.pages||['/'];
 const startAt=v.startAt===null?'':max(v.startAt??prior.startAt,35);
 const endAt=v.endAt===null?'':max(v.endAt??prior.endAt,35);
 for(const date of [startAt,endAt])if(date&&!Number.isFinite(Date.parse(date)))throw Object.assign(new Error('invalid_announcement_date'),{status:400});
 return {id:prior.id||crypto.randomUUID(),enabled:typeof v.enabled==='boolean'?v.enabled:prior.enabled??false,
 title,message,theme,
 background:hex(v.background??prior.background,colors.background),
 color:hex(v.color??prior.color,colors.color),
 linkColor:hex(v.linkColor??prior.linkColor,colors.linkColor),
 linkLabel:max(v.linkLabel??prior.linkLabel,50),linkUrl:safeUrl(v.linkUrl??prior.linkUrl),
 pages:pages.length?pages:['/'],
 // Existing announcements remain site-only until an admin explicitly enables client delivery.
 audience:['site','clients','both'].includes(v.audience??prior.audience)?(v.audience??prior.audience):'site',
 kind:clientKinds.has(v.kind??prior.kind)?(v.kind??prior.kind):'feature',
 platforms:(Array.isArray(v.platforms)?v.platforms:prior.platforms||[...clientPlatforms]).filter(p=>clientPlatforms.has(p)).slice(0,3),
 priority:Math.max(-100,Math.min(100,Number(v.priority??prior.priority)||0)),
 dismissible:typeof v.dismissible==='boolean'?v.dismissible:prior.dismissible??true,
 startAt,endAt,updatedAt:new Date().toISOString()};
}
export function listAnnouncements(){return entries.map(x=>({...x})).sort((a,b)=>b.priority-a.priority||b.updatedAt.localeCompare(a.updatedAt))}
export function mutateAnnouncement(method,id,payload={}){
 if(method==='POST'){if(entries.length>=100)throw Object.assign(new Error('announcement_limit'),{status:400});const created=sanitize(payload);entries.push(created);persist();return created}
 const index=entries.findIndex(x=>x.id===id);
 if(index<0)throw Object.assign(new Error('announcement_not_found'),{status:404});
 if(method==='DELETE'){const [removed]=entries.splice(index,1);persist();return removed}
 if(method==='PUT'){const updated=sanitize(payload,entries[index]);entries[index]=updated;persist();return updated}
 throw Object.assign(new Error('invalid_announcement_action'),{status:405});
}
function choose(page,now=Date.now()){
 return listAnnouncements().find(x=>x.enabled&&x.audience!=='clients'&&x.pages.includes(page)&&(!x.startAt||Date.parse(x.startAt)<=now)&&(!x.endAt||Date.parse(x.endAt)>now));
}
export function announcementHtml(page){
 const entry=choose(page);if(!entry)return '';
 const link=entry.linkUrl?'<a class="lr-site-announcement-link" href="'+h(entry.linkUrl)+'"'+(entry.linkUrl.startsWith('https:')?' target="_blank" rel="noopener noreferrer"':'')+'>'+h(entry.linkLabel||'Learn more')+'</a>':'';
 const close=entry.dismissible?'<button type="button" class="lr-site-announcement-close" aria-label="Dismiss announcement">×</button>':'';
 return '<div class="lr-site-announcement" data-announcement-id="'+h(entry.id)+'" role="status" style="--lr-notice-bg:'+entry.background+';--lr-notice-color:'+entry.color+';--lr-notice-link:'+entry.linkColor+'">'+
 '<span><strong>'+h(entry.title)+'</strong>'+(entry.title&&entry.message?' · ':'')+h(entry.message)+'</span>'+link+close+'</div>';
}
export function installAnnouncements(app){
 app.use((req,res,next)=>{
  if(req.method!=='GET'||!allowedPages.has(req.path))return next();
  const original=res.send.bind(res);
  res.send=function(body){
   if(typeof body==='string'&&/<!doctype html|<html/i.test(body)){
    const notice=announcementHtml(req.path);
    if(notice){
     const styles='<style>.lr-site-announcement{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;min-height:38px;padding:8px 45px;text-align:center;font:700 12px/1.5 system-ui,sans-serif;position:relative;z-index:80;background:var(--lr-notice-bg);color:var(--lr-notice-color)}.lr-site-announcement-link{color:var(--lr-notice-link);text-decoration:underline;text-underline-offset:3px}.lr-site-announcement-close{position:absolute;right:15px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:inherit;font:700 19px system-ui;cursor:pointer;padding:3px 8px}</style>';
     body=body.replace('</head>',styles+'</head>').replace(/<body([^>]*)>/i,(match,attrs)=>match+notice+
        '<script>(function(){const el=document.querySelector(".lr-site-announcement");if(!el)return;const key="lr-announcement-dismissed-"+el.dataset.announcementId;try{if(localStorage.getItem(key)==="1")el.remove()}catch{}el.querySelector(".lr-site-announcement-close")?.addEventListener("click",()=>{el.remove();try{localStorage.setItem(key,"1")}catch{}})})();</script>');
    }
   }
   return original(body);
  };next();
 });
}
function entryId(markup){return /data-announcement-id="([\da-f-]+)"/.exec(markup)?.[1]||''}

/** Public broadcast feed for the shared Windows/macOS/Linux device Agent.
 * Never include account, secret, or admin-only content in this feed.
 * Account-targeted notices must use a separate authenticated channel.
 */
export function clientAnnouncementFeed({platform='windows',now=Date.now()}={}){
 const target=String(platform).toLowerCase();
 if(!clientPlatforms.has(target))throw Object.assign(new Error('invalid_client_platform'),{status:400});
 const items=listAnnouncements().filter(x=>x.enabled&&['clients','both'].includes(x.audience)
   &&(x.platforms||[...clientPlatforms]).includes(target)
   &&(!x.startAt||Date.parse(x.startAt)<=now)&&(!x.endAt||Date.parse(x.endAt)>now))
   .slice(0,25).map(x=>({id:x.id,kind:x.kind||'feature',title:x.title,message:x.message,
    priority:x.priority,dismissible:x.dismissible,linkLabel:x.linkLabel,linkUrl:x.linkUrl,
    startAt:x.startAt,endAt:x.endAt,updatedAt:x.updatedAt}));
 const revision=crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0,20);
 return {schemaVersion:1,platform:target,revision,checkedAt:new Date(now).toISOString(),pollAfterSeconds:300,items};
}
export function registerClientAnnouncementFeed(app){
 app.get('/api/client-announcements',(req,res)=>{
  try{const feed=clientAnnouncementFeed({platform:req.query.platform||'windows'});
   res.set('Cache-Control','no-store').set('X-Content-Type-Options','nosniff');
   return res.json(feed);
  }catch(error){return res.status(error.status||500).json({ok:false,error:error.message});}
 });
}
