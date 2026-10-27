const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const statuses={1:'Open',2:'Snoozed',3:'Resolved',4:'Closed'};
const escapeHTML=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function ticketURL(id){if(!uuid.test(id))throw Error('invalid_ticket_id');return 'https://support.thaiduy.digital/ai-support/t/'+id;}
export function buildPublicPage(ticket,messages){
 const brand=ticket.inbox_id===2?'LightBI':'Light Remote',status=statuses[ticket.status_id]||'In progress';
 const heading=escapeHTML(ticket.subject||'Support request').slice(0,320);
 const when=d=>{const v=new Date(d);return Number.isFinite(v.getTime())?v.toISOString().slice(0,16).replace('T',' ')+' UTC':''};
 const body=messages.slice(-25).map(m=>{
  const label=m.type==='incoming'?'Customer':'Support';
  return '<article class="bubble '+(m.type==='outgoing'?'out':'')+'"><div class="by">'+label+' · '+when(m.created_at)+'</div><p>'+escapeHTML(String(m.text_content||'').slice(0,3500))+'</p></article>';
 }).join('');
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>'+brand+' ticket</title><style>body{font:15px/1.65 system-ui,Arial,sans-serif;background:#f5f7fb;color:#223043;margin:0}.wrap{max-width:760px;margin:36px auto;padding:16px}.card{background:#fff;border-radius:14px;padding:28px;border:1px solid #e1e6ef;box-shadow:0 10px 32px #17243c0b}header{background:#15253b;color:#fff;padding:18px 26px;border-radius:12px 12px 0 0;font-size:19px;font-weight:750}.badge{font-size:13px;background:#fff3d3;color:#725216;padding:5px 12px;border-radius:16px}.bubble{padding:16px;border:1px solid #e7e9ee;border-radius:10px;margin-top:12px;white-space:pre-wrap;overflow-wrap:anywhere}.out{background:#f0f7ff}.by{font-size:12px;color:#637187;font-weight:650}h1{font-size:23px;line-height:1.3;overflow-wrap:anywhere}a{color:#185ca0}footer{font-size:13px;color:#667287;padding:20px 2px}p{margin:8px 0}</style></head><body><div class="wrap"><header>'+brand+' Support</header><section class="card"><span class="badge">'+escapeHTML(status)+'</span><h1>'+heading+'</h1><p>Ticket #'+escapeHTML(ticket.reference_number)+'</p><p>Created '+when(ticket.created_at)+'</p><h2 style="font-size:17px">Conversation</h2>'+body+'<footer>Reply directly to the confirmation email if you need to add information. No account or password is required to view this page. Anyone with this private link can read the conversation, so do not share it publicly.</footer></section></div></body></html>';
}
export function makeBridgeURL(gateURL){const u=new URL(gateURL);if(!['db','127.0.0.1','localhost'].includes(u.hostname)||u.pathname!=='/support_gate')throw Error('gate_pg_target_invalid');u.pathname='/libredesk';return u.toString();}
export function createTicketReader(gateURL,Pool){return new Pool({connectionString:makeBridgeURL(gateURL),max:3,connectionTimeoutMillis:5000,statement_timeout:5000});}
export async function renderPublicTicket(pool,bridge,id){
 if(!uuid.test(id))return null;
 const grant=await pool.query('SELECT expires_at FROM support_gate_public_ticket_access WHERE conversation_uuid=$1 AND expires_at>now() AND revoked_at IS NULL',[id]);
 if(!grant.rowCount)return null;
 const rows=await bridge.query('SELECT * FROM support_bridge.ticket WHERE uuid=$1 AND inbox_id IN (1,2)',[id]);
 if(!rows.rowCount)return null;
 const ticket=rows.rows[0];
 const messages=await bridge.query("SELECT type,created_at,text_content FROM (SELECT id,created_at,type,text_content FROM support_bridge.public_message WHERE conversation_id=$1 ORDER BY id DESC LIMIT 25) x ORDER BY id",[ticket.id]);
 return buildPublicPage(ticket,messages.rows);
}
export function publicHeaders(){return {'content-type':'text/html; charset=utf-8','cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','x-robots-tag':'noindex,nofollow,noarchive','content-security-policy':"default-src 'none';style-src 'unsafe-inline';form-action 'none';frame-ancestors 'none';base-uri 'none'"};}
