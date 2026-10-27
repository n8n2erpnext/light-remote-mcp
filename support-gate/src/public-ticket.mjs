import crypto from 'node:crypto';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const CLOSE_GRACE_MS=14*24*60*60*1000;
const statusLabels={1:'Open',2:'Snoozed',3:'Resolved',4:'Closed'};
export const escapeHTML=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
export function ticketURL(id){if(!uuid.test(id))throw Error('invalid_ticket_id');return 'https://support.thaiduy.digital/ai-support/t/'+id;}
export function ticketExpiry(ticket){
 if(Number(ticket.status_id)!==4)return null;
 const closed=Date.parse(ticket.closed_at||'');
 return Number.isFinite(closed)?new Date(closed+CLOSE_GRACE_MS):new Date(0);
}
export function ticketCanView(ticket,now=new Date()){
 const expires=ticketExpiry(ticket);
 return !expires||expires.getTime()>now.getTime();
}
export function buildPublicPage(ticket,messages,{form=null,notice=''}={}){
 const isBI=Number(ticket.inbox_id)===2;
 const brand=isBI?'LightBI':'Light Remote';
 const logo=isBI?'lightbi-app-icon.png':'light-remote-mark-256.png';
 const status=String(statusLabels[ticket.status_id]||ticket.status_name||'In progress');
 const expires=ticketExpiry(ticket);
 const canReply=Number(ticket.status_id)!==4;
 const when=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC':''};
 const bubbles=messages.slice(-25).map(m=>'<article class="message '+(m.type==='outgoing'?'staff':'')+'"><div class="who">'+(m.type==='incoming'?'Customer':'Support team')+' · '+when(m.created_at)+'</div><p>'+escapeHTML(String(m.text_content||'').slice(0,4000))+'</p></article>').join('');
 const nonceFields=form?'<input type="hidden" name="request_id" value="'+escapeHTML(form.requestId)+'"><input type="hidden" name="issued" value="'+escapeHTML(form.issued)+'"><input type="hidden" name="token" value="'+escapeHTML(form.token)+'">':'';
 const replyForm=canReply&&form?'<section class="reply"><h2>Reply to this ticket</h2><p class="hint">Your message will appear in the conversation. You can also reply directly to any support email.</p><form method="post" action="'+ticketURL(ticket.uuid)+'" accept-charset="UTF-8">'+nonceFields+'<label for="reply">Your message</label><textarea id="reply" name="message" rows="5" minlength="1" maxlength="4000" required placeholder="Write your reply here..."></textarea><button type="submit">Send reply</button></form></section>':'<p class="hint">This ticket is closed to web replies. Reply to your support email if you need to follow up.</p>';
 const expiryInfo=expires?'<p class="expiry">Closed on '+when(ticket.closed_at)+' · This private link remains available for 14 days after closure, until '+when(expires)+'.</p>':'<p class="expiry">This link stays active while the ticket is not Closed. Once Closed, it remains available for 14 days.</p>';
 const notes=notice==='sent'?'<div class="success" role="status">Reply saved. It is now visible to the support team.</div>':'';
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>'+brand+' · Ticket #'+escapeHTML(ticket.reference_number)+'</title><style>'+
 'body{margin:0;background:#f3f5f9;color:#27374b;font:15px/1.65 system-ui,-apple-system,Segoe UI,Arial,sans-serif}main{max-width:760px;margin:38px auto;padding:0 16px}.panel{background:white;border:1px solid #dde4ed;border-radius:13px;overflow:hidden;box-shadow:0 12px 35px #1b335511}.brand{background:#152538;color:#fff;padding:22px 30px;display:flex;align-items:center;gap:15px;font-size:19px;font-weight:700}.brand img{width:44px;height:44px;object-fit:contain}.body{padding:28px 30px}h1{font-size:24px;line-height:1.35;overflow-wrap:anywhere;margin:15px 0 4px}h2{font-size:17px;margin-top:28px}.meta{color:#6e7b8b;font-size:13px}.status{display:inline-block;background:#eaf1fa;color:#244d80;border-radius:16px;padding:3px 13px;font-size:13px;font-weight:700}.closed{background:#f4eaee;color:#913a53}.expiry,.hint{font-size:13px;color:#697b90}.statuses{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px}.statuses span{font-size:12px;border:1px solid #e1e7ed;border-radius:8px;padding:3px 9px;color:#697786}.statuses strong{background:#fff0bf;color:#5d4413;border-radius:8px;padding:4px 10px;font-size:12px}.message{border:1px solid #e0e7f0;border-radius:10px;padding:13px 17px;margin-top:12px;overflow-wrap:anywhere;white-space:pre-wrap}.staff{background:#f0f7ff}.who{color:#617287;font-size:12px;font-weight:650}.message p{margin:7px 0}.reply{border-top:1px solid #e4e9ee;margin-top:28px;padding-top:7px}label{display:block;font-weight:650;margin:12px 0 7px}textarea{box-sizing:border-box;width:100%;border-radius:9px;border:1px solid #b7c4d2;resize:vertical;font:inherit;padding:12px;color:inherit}button{border:0;border-radius:8px;padding:12px 22px;background:#25578c;color:white;font:inherit;font-weight:700;cursor:pointer;margin-top:12px}button:hover{background:#1c4674}.success{background:#e7f7ec;color:#20663a;padding:12px 15px;border-radius:9px;margin:18px 0}.footer{margin-top:27px;border-top:1px solid #e5e8ee;padding-top:19px;color:#63758b;font-size:12px}a{color:#1b528b}@media(max-width:600px){main{margin:15px auto}.body{padding:20px}.brand{padding:16px 20px}}</style></head><body><main><div class="panel"><div class="brand"><img src="https://support.thaiduy.digital/ai-support/branding/'+logo+'" alt="'+brand+'"><span>'+brand+' Support</span></div><div class="body">'+notes+
 '<span class="status '+(ticket.status_id===4?'closed':'')+'">'+escapeHTML(status)+'</span><h1>'+escapeHTML(ticket.subject||'Support request').slice(0,320)+'</h1><p class="meta">Ticket #'+escapeHTML(ticket.reference_number)+' · Created '+when(ticket.created_at)+'</p>'+expiryInfo+
 '<div class="statuses">'+[1,2,3,4].map(id=>Number(ticket.status_id)===id?'<strong>'+statusLabels[id]+'</strong>':'<span>'+statusLabels[id]+'</span>').join('')+'</div>'+
 '<h2>Conversation</h2>'+bubbles+replyForm+
 '<div class="footer">You can also reply by email. No account or password is required. Anyone holding this private link may read this ticket and, while it is active, respond. Please do not share it publicly.</div></div></div></main></body></html>';
}
export function makeBridgeURL(gateURL){const u=new URL(gateURL);if(!['db','127.0.0.1','localhost'].includes(u.hostname)||u.pathname!=='/support_gate')throw Error('gate_pg_target_invalid');u.pathname='/libredesk';return u.toString();}
export function createTicketReader(gateURL,Pool){return new Pool({connectionString:makeBridgeURL(gateURL),max:3,connectionTimeoutMillis:5000,statement_timeout:5000});}
export async function getPublicTicket(pool,bridge,id,now=new Date()){
 if(!uuid.test(id))return null;
 const grant=await pool.query('SELECT conversation_uuid FROM support_gate_public_ticket_access WHERE conversation_uuid=$1 AND revoked_at IS NULL',[id]);
 if(!grant.rowCount)return null;
 const rows=await bridge.query('SELECT * FROM support_bridge.ticket WHERE uuid=$1 AND inbox_id IN (1,2)',[id]);
 if(!rows.rowCount||!ticketCanView(rows.rows[0],now))return null;
 return rows.rows[0];
}
export async function renderPublicTicket(pool,bridge,id,options={}){
 const ticket=await getPublicTicket(pool,bridge,id,options.now);
 if(!ticket)return null;
 const messages=await bridge.query("SELECT type,created_at,text_content FROM (SELECT id,created_at,type,text_content FROM support_bridge.public_message WHERE conversation_id=$1 ORDER BY id DESC LIMIT 25) x ORDER BY id",[ticket.id]);
 const form=options.issueForm&&ticket.status_id!==4?options.issueForm(id):null;
 return buildPublicPage(ticket,messages.rows,{form,notice:options.notice});
}
export function publicHeaders(){return {'content-type':'text/html; charset=utf-8','cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'same-origin','x-robots-tag':'noindex,nofollow,noarchive','content-security-policy':"default-src 'none';img-src https://support.thaiduy.digital;style-src 'unsafe-inline';form-action 'self';frame-ancestors 'none';base-uri 'none'"};}
