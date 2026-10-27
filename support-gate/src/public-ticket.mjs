const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const CLOSE_GRACE_MS=14*24*60*60*1000;
export const PAGE_SIZE=15;
export const MAX_EXPORT_MESSAGES=5000;
const statusLabels={1:'Open',2:'Snoozed',3:'Resolved',4:'Closed'};
export const escapeHTML=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function ticketURL(id){if(!uuid.test(id))throw Error('invalid_ticket_id');return 'https://support.thaiduy.digital/ai-support/t/'+id;}
export function ticketExpiry(ticket){
 if(Number(ticket.status_id)!==4)return null;
 const closed=Date.parse(ticket.closed_at||'');
 return Number.isFinite(closed)?new Date(closed+CLOSE_GRACE_MS):new Date(0);
}
export function ticketCanView(ticket,now=new Date()){
 const expires=ticketExpiry(ticket);return !expires||expires.getTime()>now.getTime();
}
export function brandFor(ticket){return Number(ticket.inbox_id)===2?{name:'LightBI',logo:'lightbi-app-icon.png'}:{name:'Light Remote',logo:'light-remote-mark-256.png'};}
export function ticketStatus(ticket){return String(statusLabels[ticket.status_id]||ticket.status_name||'In progress');}
export function ticketWhen(value){
 const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC':'—';
}
// Never reproduce the private bearer URL or an access code in UI, print or PDF transcripts.
export function redactTicketText(text){
 return String(text||'').replace(/https:\/\/support\.thaiduy\.digital\/ai-support\/t\/[0-9a-f-]{36}(?:\?[^\s<>"]*)?/gi,'[private ticket link]')
 .replace(/((?:ticket )?access code\s*(?:is|:)\s*)([A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})/gi,'$1[redacted]');
}
export function parseTicketPage(raw,total){
 const count=Math.max(0,Number(total)||0),pages=Math.max(1,Math.ceil(count/PAGE_SIZE));
 if(raw===undefined||raw===null||raw==='')return {page:pages,pages,total:count};
 if(!/^[1-9][0-9]{0,6}$/.test(String(raw)))return {page:pages,pages,total:count};
 return {page:Math.max(1,Math.min(pages,Number(raw))),pages,total:count};
}
export function pageURL(id,page){return ticketURL(id)+'?page='+page;}
function shell(ticket,inner,{print=false}={}){
 const brand=brandFor(ticket),status=ticketStatus(ticket);
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<meta name="robots" content="noindex,nofollow,noarchive"><meta name="color-scheme" content="light"><title>'+escapeHTML(brand.name)+' · Ticket #'+escapeHTML(ticket.reference_number)+'</title>'+
 '<link rel="stylesheet" href="/ai-support/ticket.css"></head><body class="'+(print?'print-view':'')+'"><main class="wrap"><div class="sheet">'+
 '<header class="ticket-header"><div class="identity"><img alt="'+escapeHTML(brand.name)+'" src="/ai-support/branding/'+brand.logo+'"><div><span class="kicker">Customer Support Center</span>'+escapeHTML(brand.name)+' Support</div></div><div class="header-side">Private support ticket</div></header>'+
 '<div class="main">'+inner+'</div></div></main>'+(print?'<script src="/ai-support/print-ticket.js" defer></script>':'')+'</body></html>';
}
function header(ticket,{print=false}={}){
 const status=ticketStatus(ticket),id=String(ticket.reference_number||'');
 const expiry=ticketExpiry(ticket);
 const actions=print?'<a class="btn no-print" href="'+ticketURL(ticket.uuid)+'">Back to ticket</a><button class="btn primary no-print" id="printNow" type="button">Print now</button><a class="btn no-print" href="'+ticketURL(ticket.uuid)+'/pdf">Export PDF</a>':
 '<a class="btn" href="'+ticketURL(ticket.uuid)+'/print" target="_blank" rel="noopener">Print ready</a><a class="btn primary" href="'+ticketURL(ticket.uuid)+'/pdf">Export PDF</a>';
 return '<div class="overline">Ticket #'+escapeHTML(id)+' · Support request</div><h1>'+escapeHTML(String(ticket.subject||'Support request').slice(0,320))+'</h1>'+
 '<div class="status-row"><span class="pill '+(['closed','resolved','snoozed'].includes(status.toLowerCase())?status.toLowerCase():'')+'">'+escapeHTML(status)+'</span></div>'+
 '<nav class="toolbar" aria-label="Ticket actions">'+actions+'</nav>'+
 '<div class="details"><div class="detail"><small>Ticket reference</small><strong>#'+escapeHTML(id)+'</strong></div>'+
 '<div class="detail"><small>Created</small><strong>'+ticketWhen(ticket.created_at)+'</strong></div>'+
 '<div class="detail"><small>Current status</small><strong>'+escapeHTML(status)+'</strong></div></div>'+
 '<div class="steps" aria-label="Possible ticket statuses">'+[1,2,3,4].map(i=>i===Number(ticket.status_id)?'<strong>'+statusLabels[i]+'</strong>':'<span>'+statusLabels[i]+'</span>').join('')+'</div>'+
 '<p class="expiry">'+(expiry?'Closed '+ticketWhen(ticket.closed_at)+' · Link expires '+ticketWhen(expiry):'The private ticket remains available while active and expires 14 days after it is Closed.')+'</p>';
}
export function messageCard(message){
 const staff=message.type==='outgoing';
 return '<article class="message'+(staff?' staff':'')+'"><div class="sender"><span>'+(staff?'Support team':'Customer')+'</span><time>'+ticketWhen(message.created_at)+'</time></div>'+
 '<p class="message-text">'+escapeHTML(redactTicketText(String(message.text_content||'').slice(0,4000)))+'</p></article>';
}
export function pageNavigation(ticket,{page,pages,total}){
 if(pages<=1)return '';
 const id=ticket.uuid,parts=[];
 const disabled=label=>'<span aria-disabled="true">'+label+'</span>';
 const link=(label,n,rel='')=>'<a href="'+pageURL(id,n)+'"'+(rel?' rel="'+rel+'"':'')+'>'+label+'</a>';
 parts.push(page>1?link('First',1):disabled('First'));
 parts.push(page>1?link('‹ Prev',page-1,'prev'):disabled('‹ Prev'));
 const windowStart=Math.max(1,Math.min(page-2,pages-4)),windowEnd=Math.min(pages,windowStart+4);
 if(windowStart>1)parts.push(disabled('…'));
 for(let i=windowStart;i<=windowEnd;i++)parts.push(i===page?'<b aria-current="page">'+i+'</b>':link(String(i),i));
 if(windowEnd<pages)parts.push(disabled('…'));
 parts.push(page<pages?link('Next ›',page+1,'next'):disabled('Next ›'));
 parts.push(page<pages?link('Last',pages):disabled('Last'));
 return '<nav class="pager" aria-label="Conversation pages">'+parts.join('')+'</nav>';
}
function note(notice){return notice==='sent'?'<div class="success" role="status">Reply saved. It is now visible to the support team.</div>':'';}
function reply(ticket,form){
 if(Number(ticket.status_id)===4)return '<div class="reply"><p>This ticket is closed to web replies. Reply to your support email if you need to follow up.</p></div>';
 if(!form)return '';
 const hidden='<input type="hidden" name="request_id" value="'+escapeHTML(form.requestId)+'"><input type="hidden" name="issued" value="'+escapeHTML(form.issued)+'"><input type="hidden" name="token" value="'+escapeHTML(form.token)+'">';
 return '<section class="reply"><h2>Write a reply</h2><p>Your reply goes to the same support conversation. You can also reply directly to your support email.</p>'+
 '<form method="post" action="'+ticketURL(ticket.uuid)+'" accept-charset="UTF-8">'+hidden+
 '<label for="reply">Your message</label><textarea id="reply" name="message" rows="5" minlength="1" maxlength="4000" required placeholder="Describe your update or question..."></textarea>'+
 '<button class="btn primary" type="submit">Send reply</button></form></section>';
}
const footer='<footer class="foot">Access to this ticket requires both its private link and the access code from your support email. Keep that email confidential. No account or password is required. You may also reply directly by email.</footer>';
export function buildPublicPage(ticket,messages,{form=null,notice='',pagination=null,total=undefined,print=false}={}){
 const count=total===undefined?messages.length:total;
 const section='<section aria-label="Conversation history"><div class="section-heading"><h2>Conversation</h2><p>'+count+' message'+(count===1?'':'s')+(print?' · Full history':pagination?' · Page '+pagination.page+' of '+pagination.pages:'')+'</p></div>'+
 '<div class="timeline"><div class="event">Ticket created · Confirmation sent</div>'+
 (messages.length?messages.map(messageCard).join(''):'<div class="empty">No conversation messages yet.</div>')+'</div></section>';
 return shell(ticket,note(notice)+header(ticket,{print})+section+(pagination&&!print?pageNavigation(ticket,pagination):'')+(print?'':reply(ticket,form))+footer,{print});
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
export async function systemMessageIds(pool,id){
 const res=await pool.query('SELECT native_message_id FROM support_gate_ticket_system_messages WHERE conversation_uuid=$1 ORDER BY native_message_id',[id]);
 return res.rows.map(row=>String(row.native_message_id)).filter(x=>/^[0-9]+$/.test(x));
}
export async function getTicketMessages(pool,bridge,ticket,{page,all=false}={}){
 const excluded=await systemMessageIds(pool,ticket.uuid);
 const values=[ticket.id,excluded];
 const condition='conversation_id=$1 AND NOT (id = ANY($2::bigint[]))';
 const count=await bridge.query('SELECT COUNT(*)::int AS total FROM support_bridge.public_message WHERE '+condition,values);
 const total=Number(count.rows[0]?.total||0);
 if(all){
  if(total>MAX_EXPORT_MESSAGES)throw Error('ticket_export_too_large');
  const rows=await bridge.query('SELECT id,type,created_at,text_content FROM support_bridge.public_message WHERE '+condition+' ORDER BY id ASC LIMIT $3', [...values,MAX_EXPORT_MESSAGES]);
  return {messages:rows.rows,total};
 }
 const pages=parseTicketPage(page,total);
 const result=await bridge.query('SELECT id,type,created_at,text_content FROM support_bridge.public_message WHERE '+condition+' ORDER BY id ASC LIMIT $3 OFFSET $4',[...values,PAGE_SIZE,(pages.page-1)*PAGE_SIZE]);
 return {messages:result.rows,total,pagination:pages};
}
export async function renderPublicTicket(pool,bridge,id,options={}){
 const ticket=await getPublicTicket(pool,bridge,id,options.now);
 if(!ticket)return null;
 const result=await getTicketMessages(pool,bridge,ticket,{page:options.page,all:Boolean(options.print)});
 const form=options.issueForm&&ticket.status_id!==4&&!options.print?options.issueForm(id):null;
 return buildPublicPage(ticket,result.messages,{form,notice:options.notice,pagination:result.pagination,total:result.total,print:Boolean(options.print)});
}
export function publicHeaders({print=false}={}){
 return {'content-type':'text/html; charset=utf-8','cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'same-origin','x-robots-tag':'noindex,nofollow,noarchive',
  'content-security-policy':"default-src 'none';img-src 'self';style-src 'self';"+(print?"script-src 'self';":"")+"form-action 'self';frame-ancestors 'none';base-uri 'none'"};
}
