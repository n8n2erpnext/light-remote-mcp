import crypto from 'node:crypto';

const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cookieName='__Secure-support_ticket';
const ticketOrigin='https://support.thaiduy.digital';
const mac=(secret,value)=>crypto.createHmac('sha256',secret).update(value).digest();

export function ticketAccessCode(secret,id){
 if(!secret||secret.length<40||!uuid.test(id))throw Error('ticket_access_config_invalid');
 const digest=mac(secret,'ticket-access-code:v1:'+id.toLowerCase());
 let chars='';
 // Eight 5-bit groups provide forty pseudorandom bits per ticket.
 for(let i=0;i<8;i++){
  const offset=i*5,byte=Math.floor(offset/8),bit=offset%8;
  const number=((digest[byte]<<8)|(digest[byte+1]||0)) >>> (11-bit);
  chars+=alphabet[number&31];
 }
 return chars.slice(0,4)+'-'+chars.slice(4);
}
export function verifyTicketAccessCode(secret,id,supplied){
 const value=String(supplied||'').trim().toUpperCase().replace(/-/g,'');
 if(!/^[A-HJ-NP-Z2-9]{8}$/.test(value))return false;
 const expected=ticketAccessCode(secret,id).replace('-','');
 return crypto.timingSafeEqual(Buffer.from(value),Buffer.from(expected));
}
export function makeTicketCookie(secret,id,now=Date.now()){
 const expires=now+12*60*60*1000;
 const body=Buffer.from(id.toLowerCase()+'|'+expires).toString('base64url');
 const sig=mac(secret,'ticket-access-cookie:v1:'+body).toString('base64url');
 return cookieName+'='+body+'.'+sig+'; Path=/ai-support/t/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200';
}
export function ticketCookieValid(secret,id,headers,now=Date.now()){
 if(!secret||!uuid.test(id))return false;
 const row=String(headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='));
 if(!row)return false;
 const raw=row.slice(cookieName.length+1),parts=raw.split('.');
 if(parts.length!==2||parts[0].length>150||parts[1].length>55)return false;
 const expected=mac(secret,'ticket-access-cookie:v1:'+parts[0]);
 let provided;
 try{provided=Buffer.from(parts[1],'base64url')}catch{return false}
 if(provided.length!==expected.length||!crypto.timingSafeEqual(expected,provided))return false;
 const values=Buffer.from(parts[0],'base64url').toString('utf8').split('|');
 return values.length===2&&values[0]===id.toLowerCase()&&/^[0-9]{13}$/.test(values[1])&&
  Number(values[1])>now&&Number(values[1])<=now+12*60*60*1000;
}
function esc(value){return String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function ticketCodePage(id,{message='',error=false,inboxId=1}={}){
 const action=ticketOrigin+'/ai-support/t/'+id;
 const note=message?'<p role="status" class="'+(error?'error':'notice')+'">'+esc(message)+'</p>':'';
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<meta name="robots" content="noindex,nofollow,noarchive"><title>Ticket access · Support Center</title>'+
 '<style>body{margin:0;background:#f3f5f9;color:#263a4c;font:15px/1.6 system-ui,Arial,sans-serif}main{max-width:470px;margin:10vh auto;padding:0 16px}.panel{background:#fff;border:1px solid #dbe2e9;border-radius:14px;padding:28px;box-shadow:0 12px 35px #162d4614}.logo{display:flex;align-items:center;gap:12px}.logo img{width:44px;height:44px;object-fit:contain}h1{margin:24px 0 8px;font-size:23px}p{color:#5b687a}label{font-weight:650;display:block;margin:20px 0 6px}input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #bcc8d6;border-radius:8px;font:600 19px/1.4 monospace;letter-spacing:.12em;text-transform:uppercase}button{background:#24588c;color:white;border:0;border-radius:8px;padding:12px 18px;font-weight:700;cursor:pointer;margin-top:14px}.secondary{background:#edf3f9;color:#244b76}.notice{padding:12px;background:#eaf5ef;border-radius:8px}.error{padding:12px;background:#fff0ea;color:#8c382e;border-radius:8px}small{display:block;color:#6d7b89;margin-top:20px}</style></head>'+
 '<body><main><div class="panel"><div class="logo"><img src="'+ticketOrigin+'/ai-support/branding/'+(Number(inboxId)===2?'lightbi-app-icon.png':'light-remote-mark-256.png')+'" alt=""><strong>Support Center · Private ticket</strong></div>'+
 '<h1>Enter your ticket access code</h1><p>The private ticket link alone does not open the conversation. Enter the 8-character code sent to the original ticket contact email. No account or password is required.</p>'+
 note+'<form method="post" action="'+action+'/access/verify" accept-charset="UTF-8"><label for="access-code">Access code</label><input id="access-code" name="code" type="text" minlength="8" maxlength="9" autocomplete="one-time-code" placeholder="ABCD-EFGH" pattern="[A-Za-z2-9]{4}-?[A-Za-z2-9]{4}" required><button type="submit">Open ticket</button></form>'+
 '<form method="post" action="'+action+'/access/request"><button class="secondary" type="submit">Resend ticket email</button></form>'+
 '<small>The ticket link and code are sent together to the original contact email. For security, requests and failed attempts are rate limited. Replying by email remains available.</small>'+
 '</div></main></body></html>';
}
export function ticketCodeHeaders(){return {'content-type':'text/html; charset=utf-8','cache-control':'private, no-store, max-age=0','referrer-policy':'same-origin','x-content-type-options':'nosniff','x-frame-options':'DENY','x-robots-tag':'noindex,nofollow,noarchive','content-security-policy':"default-src 'none';img-src https://support.thaiduy.digital;style-src 'unsafe-inline';form-action 'self';frame-ancestors 'none';base-uri 'none'"};}
export async function readAccessForm(req){
 if(!String(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded'))throw Error('invalid_content_type');
 const chunks=[];let size=0;
 for await(const c of req){size+=c.length;if(size>2048)throw Error('oversize');chunks.push(c)}
 return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
export async function checkCodeAttempt(pool,id){
 const row=await pool.query("INSERT INTO support_gate_ticket_access_attempts(conversation_uuid,failures,window_started) VALUES($1,1,now()) ON CONFLICT(conversation_uuid) DO UPDATE SET failures=CASE WHEN support_gate_ticket_access_attempts.window_started<now()-interval '15 minutes' THEN 1 ELSE support_gate_ticket_access_attempts.failures+1 END,window_started=CASE WHEN support_gate_ticket_access_attempts.window_started<now()-interval '15 minutes' THEN now() ELSE support_gate_ticket_access_attempts.window_started END RETURNING failures",[id]);
 return Number(row.rows[0]?.failures)<=6;
}
export async function deliverTicketCode(pool,id,inboxId,{secret,apiKey,apiSecret,fetchImpl=fetch,now=new Date()}={}){
 if(!secret||secret.length<40||!apiKey||!apiSecret||!uuid.test(id)||![1,2].includes(Number(inboxId)))throw Error('code_delivery_not_configured');
 const client=await pool.connect();let reserved=false;
 try{
  await client.query('BEGIN');
  await client.query("INSERT INTO support_gate_ticket_code_delivery(conversation_uuid) VALUES($1) ON CONFLICT DO NOTHING",[id]);
  const r=await client.query('SELECT * FROM support_gate_ticket_code_delivery WHERE conversation_uuid=$1 FOR UPDATE',[id]);
  const row=r.rows[0];
  // One delivery per 15m, max three per calendar day; no blind retry after ambiguous email response.
  if(row.status==='sending'||row.status==='uncertain'||row.sent_count>=3&&Date.now()-new Date(row.window_started).getTime()<86400000||
     row.last_sent_at&&now.getTime()-new Date(row.last_sent_at).getTime()<15*60*1000){
   await client.query('COMMIT');return {sent:false,limited:true};
  }
  const reset=now.getTime()-new Date(row.window_started).getTime()>=86400000;
  await client.query("UPDATE support_gate_ticket_code_delivery SET status='sending',sent_count=$2,window_started=$3,last_sent_at=now() WHERE conversation_uuid=$1",[id,reset?1:Number(row.sent_count)+1,reset?now:new Date(row.window_started)]);
  await client.query('COMMIT');reserved=true;
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
 if(!reserved)return {sent:false};
 let sendAttempted=false;
 try{
  const auth='token '+apiKey+':'+apiSecret;
  const head={authorization:auth,accept:'application/json'};
  const get=await fetchImpl('http://app:9000/api/v1/conversations/'+id,{headers:head,redirect:'error',signal:AbortSignal.timeout(10000)});
  const response=await get.json().catch(()=>({}));
  const conv=response.data||response;
  if(!get.ok||conv.uuid!==id||conv.inbox_channel!=='email'||Number(conv.inbox_id)!==Number(inboxId)||!conv.contact?.email)throw Error('code_recipient_verification_failed');
  const pass=ticketAccessCode(secret,id);
  // This is the only automated acknowledgment: native Libredesk Rule 1 is disabled.
  // Deliver URL and access code together through the verified original inbox.
  const link='https://support.thaiduy.digital/ai-support/t/'+id;
  const brand=Number(inboxId)===2?'LightBI':'Light Remote';
  const reference=String(conv.reference_number||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,32);
  const ticketName=reference?'ticket #'+reference:'your support ticket';
  const message='<p>Hello,</p>'+
    '<p>We have received '+ticketName+' for '+brand+' Support.</p>'+
    '<p><strong>Open your private ticket:</strong></p>'+
    '<p><a href="'+link+'" style="display:inline-block;padding:12px 18px;background-color:#24588c;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">View ticket</a></p>'+
    '<p>If the button does not work, copy this link:<br><a href="'+link+'">'+link+'</a></p>'+
    '<p><strong>Your ticket access code:</strong></p>'+
    '<p><strong style="font-size:24px;letter-spacing:2px">'+pass+'</strong></p>'+
    '<p>Enter this code after opening the link. No account or password is required. You may respond on the ticket page or reply directly to this email.</p>'+
    '<p>Keep this email private. The ticket remains accessible while active and the link expires 14 days after it is Closed.</p>'+
    '<p>Kind regards,<br>'+brand+' Support</p>';
  sendAttempted=true;
  const sent=await fetchImpl('http://app:9000/api/v1/conversations/'+id+'/messages',{
   method:'POST',headers:{...head,'content-type':'application/json'},
   body:JSON.stringify({message,private:false,sender_type:'agent',
    send_from:Number(inboxId)===2?'support@lightbi.app':'support@thaiduy.digital',
    to:[String(conv.contact.email).trim().toLowerCase()]}),redirect:'error',signal:AbortSignal.timeout(12000)});
  const data=await sent.json().catch(()=>({}));
  const item=data.data||data;
  if(!sent.ok||!uuid.test(String(item.uuid||item.message?.uuid||'')))throw Error('code_delivery_unconfirmed');
  const nativeId=Number(item.id||item.message?.id);
  if(!Number.isSafeInteger(nativeId)||nativeId<=0)throw Error('code_delivery_message_id_missing');
  await pool.query('INSERT INTO support_gate_ticket_system_messages(conversation_uuid,native_message_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,nativeId]);
  await pool.query("UPDATE support_gate_ticket_code_delivery SET status='sent' WHERE conversation_uuid=$1",[id]);
  return {sent:true};
 }catch(e){
  await pool.query("UPDATE support_gate_ticket_code_delivery SET status=$2 WHERE conversation_uuid=$1",[id,sendAttempted?'uncertain':'pending']).catch(()=>{});
  throw Error('code_delivery_uncertain_review_needed');
 }
}
