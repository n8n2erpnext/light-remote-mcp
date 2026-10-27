const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const addr=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function parseReply(body){
 const message=String(body?.message||'').trim();
 const recipient=String(body?.recipient||'').trim().toLowerCase();
 const baseline=String(body?.baseline||'').trim();
 const requestId=String(body?.request_id||'').trim();
 if(!message||message.length>10000||!addr.test(recipient)||recipient.length>254||!uuid.test(baseline)||!uuid.test(requestId))
  throw Error('invalid_owner_reply');
 return {message,recipient,baseline,requestId};
}
export function htmlFromPlainText(text){
 const safe=String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
 return '<p>'+safe.replace(/\r\n?/g,'\n').replace(/\n/g,'<br>')+'</p>';
}
export function rawNativeCsrf(header){
 const match=String(header||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('csrf_token='));
 const csrf=match?.slice(11)||'';
 return csrf.length>0&&csrf.length<=512?csrf:'';
}
export function lastPublicMessage(messages){
 if(!Array.isArray(messages))return '';
 return [...messages].filter(m=>m&&uuid.test(m.uuid)&&m.private===false&&['incoming','outgoing'].includes(m.type))
  .sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0))[0]?.uuid||'';
}
