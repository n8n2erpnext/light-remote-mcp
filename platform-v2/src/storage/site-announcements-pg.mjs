// Gold PostgreSQL source of truth for site announcements.
// No file-backed persistence or silent fallback. Uses the existing site sanitizer.
import {sanitizeAnnouncement} from '../../../plugin-server/site-announcements.mjs';

const notFound=()=>Object.assign(new Error('announcement_not_found'),{status:404});
const limitError=()=>Object.assign(new Error('announcement_limit'),{status:400});
const row=r=>({
  id:r.announcement_id,enabled:r.enabled,title:r.title,message:r.message,
  theme:r.theme,background:r.background.trim(),color:r.color.trim(),
  linkColor:r.link_color.trim(),linkLabel:r.link_label,linkUrl:r.link_url,
  pages:r.pages,audience:r.audience,kind:r.kind,platforms:r.platforms,
  priority:r.priority,dismissible:r.dismissible,
  startAt:r.starts_at?new Date(r.starts_at).toISOString():'',
  endAt:r.ends_at?new Date(r.ends_at).toISOString():'',
  updatedAt:new Date(r.updated_at).toISOString()
});
const fields=[
  'announcement_id','enabled','title','message','theme','background','color',
  'link_color','link_label','link_url','pages','audience','kind','platforms',
  'priority','dismissible','starts_at','ends_at','updated_at'
];
const values=n=>[
  n.id,n.enabled,n.title,n.message,n.theme,n.background,n.color,
  n.linkColor,n.linkLabel,n.linkUrl,n.pages,n.audience,n.kind,n.platforms,
  n.priority,n.dismissible,n.startAt||null,n.endAt||null,n.updatedAt
];
export class GoldPgSiteAnnouncementsRepository{
  constructor({pool}={}){
    if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function')
      throw Error('gold_site_pg_pool_required');
    this.pool=pool;
  }
  async list(){
    const result=await this.pool.query(
      'SELECT * FROM lr_site_announcements ORDER BY priority DESC,updated_at DESC,announcement_id ASC LIMIT 100');
    return (result.rows||[]).map(row);
  }
  async mutate(method,id,input={}){
    if(method==='POST'){
      const client=await this.pool.connect();
      try{
        await client.query('BEGIN');
        // Covers count+insert under concurrent operators on separate instances.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('lr_gold_site_announcements_limit'))");
        const count=Number((await client.query('SELECT COUNT(*)::int AS count FROM lr_site_announcements')).rows?.[0]?.count);
        if(!Number.isFinite(count)||count>=100)throw limitError();
        const n=sanitizeAnnouncement(input);
        const result=await client.query(
          'INSERT INTO lr_site_announcements ('+fields.join(',')+') VALUES ('+
          fields.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',values(n));
        if(result.rows?.length!==1)throw Error('gold_site_pg_insert_not_confirmed');
        await client.query('COMMIT');return row(result.rows[0]);
      }catch(error){await client.query('ROLLBACK');throw error}
      finally{client.release()}
    }
    if(!['PUT','DELETE'].includes(method))
      throw Object.assign(new Error('invalid_announcement_action'),{status:405});
    if(!/^[0-9a-f-]{36}$/i.test(String(id||'')))throw notFound();
    if(method==='DELETE'){
      const result=await this.pool.query(
        'DELETE FROM lr_site_announcements WHERE announcement_id=$1 RETURNING *',[id]);
      if(result.rows?.length!==1)throw notFound();
      return row(result.rows[0]);
    }
    // SERIALIZED row modification. Inputs are sanitized with the current row and
    // written atomically, not cached in a stale Node.js map.
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const current=await client.query(
        'SELECT * FROM lr_site_announcements WHERE announcement_id=$1 FOR UPDATE',[id]);
      if(current.rows?.length!==1)throw notFound();
      const n=sanitizeAnnouncement(input,row(current.rows[0]));
      const sql='UPDATE lr_site_announcements SET '+fields.slice(1)
        .map((f,i)=>f+'=$'+(i+2)).join(',')+
        ' WHERE announcement_id=$1 RETURNING *';
      const result=await client.query(sql,values(n));
      if(result.rows?.length!==1)throw notFound();
      await client.query('COMMIT');return row(result.rows[0]);
    }catch(error){await client.query('ROLLBACK');throw error}
    finally{client.release()}
  }
}
