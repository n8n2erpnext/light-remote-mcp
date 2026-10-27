import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import {sessionCookie,approvedAgent,ownerCsrf} from './libredesk-owner.mjs';
import {verifyInbound,normalizeInbound,stableEventKey} from './inbound.mjs';
import {configuredRemoteInbox,verifiedTicket} from './ticket-read.mjs';
import {ticketSummary,buildQueue} from './ticket-queue.mjs';
import {parseReply,htmlFromPlainText,rawNativeCsrf,lastPublicMessage} from './owner-reply.mjs';
import {aiProviderReady,requestAIDraft} from './ai-draft.mjs';
import {createTicketReader,renderPublicTicket,publicHeaders,getPublicTicket,getTicketMessages} from './public-ticket.mjs';
import {createTicketPDF} from './ticket-pdf.mjs';
import {issueReplyForm,validatePublicForm,readPublicForm,allowPublicOrigin,submitPublicReply} from './public-reply.mjs';
import {createGoldTicket} from './gold-intake.mjs';
import {ticketAccessCode,verifyTicketAccessCode,makeTicketCookie,ticketCookieValid,ticketCodePage,ticketCodeHeaders,readAccessForm,checkCodeAttempt,deliverTicketCode} from './ticket-access.mjs';

const {GATE_PG_URL,GATE_ADMIN_SALT,GATE_ADMIN_HASH,LIBREDESK_BASE_URL,
 LIBREDESK_API_KEY,LIBREDESK_API_SECRET,GATE_OWNER_EMAIL,GATE_WORKER_TOKEN_HASH,
 LIBREDESK_REMOTE_INBOX_ID,LIBREDESK_LIGHTBI_INBOX_ID,GATE_WEBHOOK_SECRET,
 GATE_AI_DRAFTER_URL,GATE_AI_DRAFTER_TOKEN,GATE_PUBLIC_REPLY_SECRET,
 GATE_GOLD_INTAKE_SECRET,LIBREDESK_INTAKE_API_KEY,LIBREDESK_INTAKE_API_SECRET}=process.env;
if(!GATE_PUBLIC_REPLY_SECRET||GATE_PUBLIC_REPLY_SECRET.length<40)throw Error('public_ticket_reply_secret_missing');
if(!GATE_PG_URL||!GATE_ADMIN_SALT||!GATE_ADMIN_HASH)throw Error('support_gate_config_missing');
const pool=new pg.Pool({connectionString:GATE_PG_URL,max:6,connectionTimeoutMillis:6000});
const publicTicketBridge=createTicketReader(GATE_PG_URL,pg.Pool);
const root=join(dirname(fileURLToPath(import.meta.url)),'../public');
const authorityUrl='http://app:9000/api/v1/agents/me';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const remoteInbox=configuredRemoteInbox(LIBREDESK_REMOTE_INBOX_ID);
const lightbiInbox=configuredRemoteInbox(LIBREDESK_LIGHTBI_INBOX_ID);
const inboxAllowed=id=>id===remoteInbox||(lightbiInbox>0&&id===lightbiInbox);
const aiReady=()=>aiProviderReady({url:GATE_AI_DRAFTER_URL,token:GATE_AI_DRAFTER_TOKEN});
const outgoingReady=()=>Boolean(LIBREDESK_BASE_URL&&LIBREDESK_API_KEY&&LIBREDESK_API_SECRET&&remoteInbox&&Number(LIBREDESK_LIGHTBI_INBOX_ID)>0);
const ownerEmail=(GATE_OWNER_EMAIL||'support@thaiduy.digital').toLowerCase();
// The one owner identity is managed by Libredesk, never in Support Gate.
async function libredeskOwner(req){
 const validCookie=sessionCookie(req.headers.cookie);
 if(!validCookie)return null;
 const ctrl=new AbortController();
 const timer=setTimeout(()=>ctrl.abort(),4500);
 try{
  const result=await fetch(authorityUrl,{
   method:'GET',headers:{cookie:'libredesk_session='+validCookie,accept:'application/json'},
   redirect:'error',signal:ctrl.signal
  });
  if(!result.ok)return null;
  const payload=await result.json();
  const agent=approvedAgent(payload,ownerEmail);
  if(!agent)return null;
  return {email:agent.email,role:agent.role,csrf:ownerCsrf(validCookie,GATE_ADMIN_HASH)};
 }catch{return null}finally{clearTimeout(timer)}
}
function json(res,status,result){
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'x-content-type-options':'nosniff'});res.end(JSON.stringify(result));
}
const fail=(res,status,message)=>json(res,status,{ok:false,error:message});
async function readJson(req){
 let value='';for await(const chunk of req){value+=chunk;if(value.length>65536)throw Error('too_large')}
 try{return JSON.parse(value||'{}')}catch{throw Error('invalid_json')}
}
async function guard(req,res,mutation=false){
 const session=await libredeskOwner(req);
 if(!session){fail(res,401,'libredesk_login_required');return null}
 if(mutation&&req.headers['x-csrf']!==session.csrf){fail(res,403,'csrf_failed');return null}
 return session;
}
function validate(d){
 const brand=String(d.brand||'').trim(),conversation=String(d.conversation_uuid||'').trim();
 const recipient=String(d.recipient||'').trim().toLowerCase();
 const subject=String(d.subject||'').trim(),message=String(d.message||'').trim();
 const baseline=String(d.based_on_message_uuid||'').trim();
 if(!['light-remote','lightbi'].includes(brand))throw Error('invalid_brand');
 if(!uuid.test(conversation))throw Error('invalid_conversation');
 if(!email.test(recipient)||recipient.length>256)throw Error('invalid_recipient');
 if(!subject||subject.length>240||!message||message.length>20000)throw Error('invalid_draft');
 if(baseline&&!uuid.test(baseline))throw Error('invalid_baseline');
 return {brand,conversation,recipient,subject,message,baseline};
}
async function log(id,action,details={}){
 await pool.query('INSERT INTO support_gate_audit(draft_id,action,details) VALUES($1,$2,$3::jsonb)',
 [id,action,JSON.stringify(details)]);
}
async function setup(){
 await pool.query("CREATE TABLE IF NOT EXISTS support_gate_gold_intake_requests (request_id uuid PRIMARY KEY,state text NOT NULL CHECK(state IN ('processing','created','uncertain')),reference_number text,conversation_uuid uuid,created_at timestamptz NOT NULL DEFAULT now())");
 await pool.query("CREATE TABLE IF NOT EXISTS support_gate_public_web_replies ("+
  "request_id uuid PRIMARY KEY,conversation_uuid uuid NOT NULL,status text NOT NULL " +
  "CHECK(status IN ('processing','saved','uncertain')),message_uuid uuid,"+
  "created_at timestamptz NOT NULL DEFAULT now())");
 await pool.query("CREATE INDEX IF NOT EXISTS public_web_reply_rate_idx ON support_gate_public_web_replies(conversation_uuid,created_at)");
 await pool.query("CREATE TABLE IF NOT EXISTS support_gate_ticket_access_attempts (conversation_uuid uuid PRIMARY KEY,failures integer NOT NULL DEFAULT 0,window_started timestamptz NOT NULL DEFAULT now())");
 await pool.query("CREATE TABLE IF NOT EXISTS support_gate_ticket_code_delivery (conversation_uuid uuid PRIMARY KEY,status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','uncertain')),sent_count integer NOT NULL DEFAULT 0,window_started timestamptz NOT NULL DEFAULT now(),last_sent_at timestamptz)");
 await pool.query("CREATE TABLE IF NOT EXISTS support_gate_ticket_system_messages (conversation_uuid uuid NOT NULL,native_message_id bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(conversation_uuid,native_message_id))");
 await pool.query("CREATE TABLE IF NOT EXISTS support_gate_public_ticket_access ("+
  "conversation_uuid uuid PRIMARY KEY,inbox_id integer NOT NULL CHECK(inbox_id IN (1,2)),"+
  "created_at timestamptz NOT NULL DEFAULT now(),"+
  "expires_at timestamptz,revoked_at timestamptz)");
 await pool.query("CREATE TABLE IF NOT EXISTS support_gate_drafts ("+
 "id uuid PRIMARY KEY,brand text NOT NULL CHECK(brand IN ('light-remote','lightbi')),"+
 "conversation_uuid uuid NOT NULL,recipient text NOT NULL,subject text NOT NULL,message text NOT NULL,"+
 "based_on_message_uuid uuid,status text NOT NULL DEFAULT 'draft' CHECK(status IN"+
 " ('draft','approved','sending','sent','unknown','needs_review')),"+
 "version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),"+
 "updated_at timestamptz NOT NULL DEFAULT now(),approved_at timestamptz,sent_at timestamptz,"+
 "remote_message_id text,last_error text)");
 await pool.query("CREATE TABLE IF NOT EXISTS support_gate_inbound_events ("+
 "id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,event_key text NOT NULL UNIQUE,"+
 "event_type text NOT NULL,conversation_uuid uuid,message_uuid uuid,inbox_id integer,"+
 "sender_type text,status text NOT NULL DEFAULT 'pending_review',"+
 "received_at timestamptz NOT NULL DEFAULT now())");
 await pool.query("CREATE TABLE IF NOT EXISTS support_gate_integration (name text PRIMARY KEY,external_id integer,created_at timestamptz NOT NULL DEFAULT now())");
 await pool.query("CREATE TABLE IF NOT EXISTS support_gate_manual_replies ("+
 "request_id uuid PRIMARY KEY,conversation_uuid uuid NOT NULL,baseline uuid NOT NULL,"+
 "recipient text NOT NULL,status text NOT NULL CHECK(status IN ('sending','queued','uncertain')),"+
 "remote_message_id text,created_at timestamptz NOT NULL DEFAULT now())");
 await pool.query("CREATE TABLE IF NOT EXISTS support_gate_audit ("+
 "seq bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,draft_id uuid,"+
 "action text NOT NULL,details jsonb NOT NULL DEFAULT '{}'::jsonb,"+
 "created_at timestamptz NOT NULL DEFAULT now())");
}
async function upstream(path,method='GET',body=null){
 if(!outgoingReady())throw Error('api_not_configured');
 const base=new URL(LIBREDESK_BASE_URL);
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('invalid_upstream');
 const url=new URL(path,base);const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),9000);
 try{
  const headers={Authorization:'Basic '+Buffer.from(LIBREDESK_API_KEY+':'+LIBREDESK_API_SECRET).toString('base64')};
  if(body!==null)headers['content-type']='application/json';
  const response=await fetch(url,{method,headers,body:body===null?undefined:JSON.stringify(body),redirect:'error',signal:controller.signal});
  if(!response.ok)throw Error('upstream_http_'+response.status);
  return await response.json();
 }finally{clearTimeout(timeout)}
}
async function send(res,id,version){
 if(!outgoingReady())return fail(res,503,'api_not_configured_no_email_sent');
 const client=await pool.connect();let draft;
 try{
  await client.query('BEGIN');
  const found=await client.query('SELECT * FROM support_gate_drafts WHERE id=$1 FOR UPDATE',[id]);
  draft=found.rows[0];
  if(!draft||draft.status!=='approved'||draft.version!==version){
   await client.query('ROLLBACK');return fail(res,409,'draft_not_approved_or_stale');
  }
  if(!draft.based_on_message_uuid){
   await client.query('ROLLBACK');return fail(res,409,'latest_conversation_message_required');
  }
  await client.query("UPDATE support_gate_drafts SET status='sending',updated_at=now() WHERE id=$1",[id]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
 try{
  const root='/api/v1/conversations/'+encodeURIComponent(draft.conversation_uuid);
  const conversation=(await upstream(root)).data;
  const expectedInbox=Number(draft.brand==='light-remote'?LIBREDESK_REMOTE_INBOX_ID:LIBREDESK_LIGHTBI_INBOX_ID);
  if(!conversation||conversation.uuid!==draft.conversation_uuid||
   conversation.inbox_channel!=='email'||Number(conversation.inbox_id)!==expectedInbox||
   String(conversation.contact?.email||'').toLowerCase()!==draft.recipient){
   await pool.query("UPDATE support_gate_drafts SET status='needs_review',last_error='recipient_or_inbox_changed' WHERE id=$1",[id]);
   return fail(res,409,'recipient_or_brand_inbox_mismatch');
  }
  const route=root+'/messages';
  const fetched=await upstream(route+'?page=1&page_size=1');
  const messages=Array.isArray(fetched.data)?fetched.data:
    Array.isArray(fetched.data?.messages)?fetched.data.messages:null;
  if(!messages||!messages.length||messages[0].uuid!==draft.based_on_message_uuid){
   await pool.query("UPDATE support_gate_drafts SET status='needs_review',last_error='conversation_changed_or_unverifiable' WHERE id=$1",[id]);
   return fail(res,409,'conversation_changed_review_again');
  }
  const result=await upstream(route,'POST',{message:draft.message,private:false});
  const remote=String(result.data?.uuid||result.data?.message?.uuid||'');
  await pool.query("UPDATE support_gate_drafts SET status='sent',sent_at=now(),remote_message_id=$2,updated_at=now() WHERE id=$1",[id,remote]);
  await log(id,'owner_sent',{remote_message_id:remote});
  return json(res,200,{ok:true,status:'sent',remote_message_id:remote});
 }catch(e){
  // A timeout after POST is ambiguous: never automatically retry an email.
  await pool.query("UPDATE support_gate_drafts SET status='unknown',last_error=$2,updated_at=now() WHERE id=$1",[id,String(e.message).slice(0,200)]);
  return fail(res,502,'send_uncertain_manual_reconciliation_required');
 }
}
async function ownerReadUpstream(req,path){
 // Read-only native Libredesk API under the same authenticated Admin session,
 // without issuing an API key or allowing the worker to access ticket bodies.
 const cookie=sessionCookie(req.headers.cookie);
 if(!cookie)throw Error('session_required');
 const ctrl=new AbortController();
 const timer=setTimeout(()=>ctrl.abort(),6000);
 try{
  const response=await fetch('http://app:9000'+path,{method:'GET',
   headers:{cookie:'libredesk_session='+cookie,accept:'application/json'},
   redirect:'error',signal:ctrl.signal});
  if(!response.ok)throw Error('libredesk_read_http_'+response.status);
  const result=await response.json();
  if(!result||result.data===undefined)throw Error('libredesk_response_invalid');
  return result.data;
 }finally{clearTimeout(timer)}
}
async function loadOwnerQueue(req,res){
 if(!remoteInbox)return fail(res,503,'remote_inbox_mapping_not_configured');
 // Signed webhook notifications are durable, one visible row per conversation.
 // Message bodies and customer details stay in Libredesk and are read only with owner cookies.
 const seen=await pool.query(
  "SELECT conversation_uuid::text AS uuid, MAX(received_at) AS event_at, COUNT(*)::int AS events "+
  "FROM support_gate_inbound_events WHERE conversation_uuid IS NOT NULL "+
  "GROUP BY conversation_uuid ORDER BY MAX(received_at) DESC LIMIT 40");
 const byUUID=new Map();let failures=0;
 for(let i=0;i<seen.rows.length;i+=6){
  const chunk=seen.rows.slice(i,i+6);
  await Promise.all(chunk.map(async item=>{
   try{
    const conv=await ownerReadUpstream(req,'/api/v1/conversations/'+item.uuid);
    const summary=ticketSummary(conv,remoteInbox,lightbiInbox);
    if(summary)byUUID.set(item.uuid,summary);
   }catch{failures++}
  }));
 }
 const queue=buildQueue(seen.rows,byUUID);
 return json(res,200,{ok:true,brands:['light-remote',...(lightbiInbox?['lightbi']:[])],
  tickets:queue,total:queue.length,sync_at:new Date().toISOString(),unavailable:failures,
  mode:'webhook_index_owner_read',next_refresh_seconds:30});
}
async function loadOwnerTicket(req,res,conversationUUID){
 if(!remoteInbox)return fail(res,503,'remote_inbox_mapping_not_configured');
 try{
  const route='/api/v1/conversations/'+conversationUUID;
  const conversation=await ownerReadUpstream(req,route);
  // Enforce inbox boundary before fetching any message content.
  if(!conversation||conversation.inbox_channel!=='email'||!inboxAllowed(Number(conversation.inbox_id)))
   return fail(res,403,'ticket_not_in_remote_email_inbox');
  const raw=await ownerReadUpstream(req,route+'/messages?page=1&page_size=12&private=false');
  const msgs=Array.isArray(raw?.results)?raw.results:Array.isArray(raw)?raw:null;
  if(!msgs)return fail(res,502,'messages_response_invalid');
  const ticket=verifiedTicket(conversation,msgs,remoteInbox,lightbiInbox);
  return json(res,200,{ok:true,ticket});
 }catch(err){
  if(String(err.message).startsWith('ticket_'))return fail(res,422,err.message);
  return fail(res,502,'libredesk_ticket_read_failed');
 }
}
async function ownerCreateAIDraft(req,res,conversationUUID){
 if(!aiReady())return fail(res,503,'ai_drafter_not_connected');
 if(!remoteInbox)return fail(res,503,'remote_inbox_mapping_not_configured');
 let ticket;
 try{
  const route='/api/v1/conversations/'+conversationUUID;
  const conv=await ownerReadUpstream(req,route);
  if(!conv||Number(conv.inbox_id)!==remoteInbox||conv.inbox_channel!=='email')
   return fail(res,403,'ai_ticket_scope_denied');
  const messagesRaw=await ownerReadUpstream(req,route+'/messages?page=1&page_size=12&private=false');
  const messages=Array.isArray(messagesRaw?.results)?messagesRaw.results:Array.isArray(messagesRaw)?messagesRaw:null;
  if(!messages)return fail(res,502,'ai_ticket_messages_unavailable');
  ticket=verifiedTicket(conv,messages,remoteInbox);
  if(!ticket.based_on_message_uuid)return fail(res,409,'ai_ticket_missing_baseline');
 }catch{return fail(res,502,'ai_ticket_read_failed')}
 // Reuse an existing draft based on this exact public message; never call AI twice
 // for the same input because retrying the browser should not create competing replies.
 const existing=await pool.query(
  "SELECT id,message FROM support_gate_drafts WHERE brand='light-remote' AND conversation_uuid=$1 "+
  "AND based_on_message_uuid=$2 AND status IN ('draft','needs_review') ORDER BY updated_at DESC LIMIT 1",
  [conversationUUID,ticket.based_on_message_uuid]);
 if(existing.rowCount)return json(res,200,{ok:true,id:existing.rows[0].id,
  message:existing.rows[0].message,status:'draft',reused:true});
 let reply;
 try{reply=await requestAIDraft({url:GATE_AI_DRAFTER_URL,token:GATE_AI_DRAFTER_TOKEN,ticket})}
 catch{return fail(res,503,'ai_drafter_failed_no_email_sent')}
 // Refetch latest public message to reject stale AI output before saving a draft.
 try{
  const raw=await ownerReadUpstream(req,
   '/api/v1/conversations/'+conversationUUID+'/messages?page=1&page_size=12&private=false');
  const messages=Array.isArray(raw?.results)?raw.results:Array.isArray(raw)?raw:null;
  if(!messages||lastPublicMessage(messages)!==ticket.based_on_message_uuid)
   return fail(res,409,'conversation_changed_during_ai_generation');
 }catch{return fail(res,502,'ai_baseline_check_failed')}
 const id=crypto.randomUUID();
 await pool.query("INSERT INTO support_gate_drafts(id,brand,conversation_uuid,recipient,subject,message,based_on_message_uuid) "+
  "VALUES($1,'light-remote',$2,$3,$4,$5,$6)",
  [id,conversationUUID,ticket.recipient,ticket.subject,reply,ticket.based_on_message_uuid]);
 await log(id,'owner_requested_ai_draft',{brand:'light-remote',conversation_uuid:conversationUUID});
 return json(res,201,{ok:true,id,status:'draft',message:reply,reused:false});
}
async function ownerPostNative(req,path,body){
 const session=sessionCookie(req.headers.cookie);
 const csrf=rawNativeCsrf(req.headers.cookie);
 if(!session||!csrf)throw Error('native_csrf_unavailable');
 const ctrl=new AbortController();
 const timer=setTimeout(()=>ctrl.abort(),12000);
 try{
  const response=await fetch('http://app:9000'+path,{
   method:'POST',headers:{cookie:'libredesk_session='+session+'; csrf_token='+csrf,
    'x-csrftoken':csrf,'content-type':'application/json','accept':'application/json'},
   body:JSON.stringify(body),redirect:'error',signal:ctrl.signal});
  if(!response.ok)throw Error('native_post_http_'+response.status);
  const result=await response.json();
  if(!result?.data?.uuid)throw Error('native_post_result_unconfirmed');
  return result.data;
 }finally{clearTimeout(timer)}
}
async function ownerSendNativeReply(req,res,conversationUUID){
 if(!remoteInbox)return fail(res,503,'remote_inbox_mapping_not_configured');
 let input;
 try{input=parseReply(await readJson(req))}
 catch{return fail(res,400,'invalid_owner_reply')}
 let route='/api/v1/conversations/'+conversationUUID;
 try{
  const conv=await ownerReadUpstream(req,route);
  if(!conv||!inboxAllowed(Number(conv.inbox_id))||conv.inbox_channel!=='email')
   return fail(res,403,'not_an_authorized_email_ticket');
  const contact=typeof conv.contact?.email==='string'?conv.contact.email:
   String(conv.contact?.email?.String||'');
  if(contact.toLowerCase()!==input.recipient)return fail(res,409,'ticket_recipient_changed');
  const raw=await ownerReadUpstream(req,route+'/messages?page=1&page_size=12&private=false');
  const messages=Array.isArray(raw?.results)?raw.results:Array.isArray(raw)?raw:null;
  if(!messages||lastPublicMessage(messages)!==input.baseline)
   return fail(res,409,'conversation_changed_refresh_before_sending');
 }catch{return fail(res,502,'ticket_revalidation_failed_no_email_sent')}
 const inserted=await pool.query(
  "INSERT INTO support_gate_manual_replies(request_id,conversation_uuid,baseline,recipient,status) "+
  "VALUES($1,$2,$3,$4,'sending') ON CONFLICT DO NOTHING RETURNING request_id",
  [input.requestId,conversationUUID,input.baseline,input.recipient]);
 if(!inserted.rowCount)return fail(res,409,'duplicate_send_request_check_conversation');
 try{
  const msg=await ownerPostNative(req,route+'/messages',{
   message:htmlFromPlainText(input.message),private:false,sender_type:'agent',to:[input.recipient]});
  await pool.query("UPDATE support_gate_manual_replies SET status='queued',remote_message_id=$2 WHERE request_id=$1",
   [input.requestId,msg.uuid]);
  await log(null,'owner_manual_reply_queued',{conversation_uuid:conversationUUID,message_uuid:msg.uuid});
  return json(res,200,{ok:true,status:'queued',message_uuid:msg.uuid});
 }catch{
  await pool.query("UPDATE support_gate_manual_replies SET status='uncertain' WHERE request_id=$1",
   [input.requestId]).catch(()=>{});
  return fail(res,502,'delivery_uncertain_check_libredesk_do_not_retry_blindly');
 }
}
async function readRawWebhook(req){
 const parts=[];let length=0;
 for await(const chunk of req){length+=chunk.length;if(length>131072)throw Error('webhook_body_too_large');parts.push(chunk)}
 return Buffer.concat(parts);
}
async function connectWebhook(req,res){
 if(!GATE_WEBHOOK_SECRET)return fail(res,503,'webhook_secret_missing');
 const existing=await pool.query("SELECT external_id FROM support_gate_integration WHERE name='libredesk_webhook'");
 if(existing.rowCount)return json(res,200,{ok:true,connected:true,webhook_id:existing.rows[0].external_id});
 const rawCookie=String(req.headers.cookie||'');
 const s=sessionCookie(rawCookie);
 const match=rawCookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('csrf_token='));
 // Libredesk compares the literal CSRF cookie value to X-CSRFTOKEN.
 // Decoding this value would mismatch any percent-encoded characters.
 const csrf=match?match.slice('csrf_token='.length):'';
 if(!s||!csrf||csrf.length>512)return fail(res,403,'libredesk_session_or_csrf_missing');
 const headers={cookie:'libredesk_session='+s+'; csrf_token='+csrf,
  'x-csrftoken':csrf,'content-type':'application/json'};
 const url='http://app:9000/api/v1/webhooks';
 const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),8000);
 try{
  const list=await fetch(url,{headers,signal:ctrl.signal,redirect:'error'});
  if(!list.ok)return fail(res,502,'libredesk_webhooks_permission_required');
  const current=await list.json();
  if(Array.isArray(current.data)&&current.data.some(x=>x.name==='Light Remote Gold AI Support Gate'))
   return fail(res,409,'webhook_name_exists_verify_manually');
  const payload={name:'Light Remote Gold AI Support Gate',
   url:'https://support.thaiduy.digital/ai-support/api/webhooks/libredesk',
   events:['conversation.created','message.created'],
   secret:GATE_WEBHOOK_SECRET,is_active:true};
  const created=await fetch(url,{method:'POST',headers,body:JSON.stringify(payload),signal:ctrl.signal,redirect:'error'});
  if(!created.ok)return fail(res,502,'libredesk_webhook_creation_rejected_'+created.status);
  const result=await created.json();const id=Number(result.data?.id);
  if(!Number.isSafeInteger(id)||id<=0)return fail(res,502,'webhook_creation_unconfirmed_reconcile_first');
  await pool.query("INSERT INTO support_gate_integration(name,external_id) VALUES('libredesk_webhook',$1) ON CONFLICT(name) DO NOTHING",[id]);
  await log(null,'libredesk_webhook_connected',{webhook_id:id});
  return json(res,201,{ok:true,connected:true,webhook_id:id});
 }catch{return fail(res,502,'webhook_connect_outcome_uncertain_check_libredesk')}finally{clearTimeout(timer)}
}
async function receiveWebhook(req,res){
 const bytes=await readRawWebhook(req);
 if(!verifyInbound(bytes,req.headers['x-libredesk-signature'],GATE_WEBHOOK_SECRET))return fail(res,401,'invalid_webhook_signature');
 let payload;
 try{payload=JSON.parse(bytes.toString('utf8'))}catch{return fail(res,400,'malformed_webhook')}
 const event=normalizeInbound(payload);
 if(!event)return fail(res,400,'invalid_webhook_event');
 const key=stableEventKey(event,bytes);
 const saved=await pool.query('INSERT INTO support_gate_inbound_events(event_key,event_type,conversation_uuid,message_uuid,inbox_id,sender_type) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (event_key) DO NOTHING RETURNING id',
 [key,event.event,event.conversation_uuid,event.message_uuid,event.inbox_id,event.sender_type]);
 if(saved.rowCount&&event.event==='conversation.created'&&event.conversation_uuid&&inboxAllowed(event.inbox_id)){
  await pool.query('INSERT INTO support_gate_public_ticket_access(conversation_uuid,inbox_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[event.conversation_uuid,event.inbox_id]);
  // Native automation sends the link; only the verified inbox can send the matching code.
  // Any ambiguous mail outcome is retained for owner review, never blindly resent.
  try{await deliverTicketCode(pool,event.conversation_uuid,event.inbox_id,{
   secret:GATE_PUBLIC_REPLY_SECRET,apiKey:LIBREDESK_INTAKE_API_KEY,apiSecret:LIBREDESK_INTAKE_API_SECRET});}
  catch(e){console.error('[ticket-code-delivery]',String(e.message).slice(0,100))}
 }
 return json(res,202,{ok:true,queued:Boolean(saved.rowCount),duplicate:!saved.rowCount});
}
async function handler(req,res){
 const path=new URL(req.url,'http://localhost').pathname,method=req.method;
 if(path==='/api/internal/gold-intake'&&method==='POST')return createGoldTicket(req,res,{pool,secret:GATE_GOLD_INTAKE_SECRET,
  apiKey:LIBREDESK_INTAKE_API_KEY,apiSecret:LIBREDESK_INTAKE_API_SECRET,inboxId:remoteInbox,
  readBody:async(r,max)=>{let raw='';for await(const chunk of r){raw+=chunk;if(raw.length>max)throw Error('too_large')}return raw},sendJson:json});
 const codeMatch=path.match(/^\/t\/([a-f0-9-]{36})\/access\/(verify|request)$/i);
 if(codeMatch&&uuid.test(codeMatch[1])&&method==='POST'){
  const ticketId=codeMatch[1],action=codeMatch[2];
  if(!allowPublicOrigin(req.headers))return fail(res,403,'same_origin_required');
  const ticket=await getPublicTicket(pool,publicTicketBridge,ticketId);
  if(!ticket)return fail(res,404,'ticket_expired_or_unavailable');
  let form;
  try{form=await readAccessForm(req)}catch{return fail(res,400,'invalid_form')}
  if(action==='verify'){
   if(form.getAll('code').length!==1)return fail(res,400,'invalid_code_form');
   const allowed=await checkCodeAttempt(pool,ticketId);
   if(!allowed||!verifyTicketAccessCode(GATE_PUBLIC_REPLY_SECRET,ticketId,form.get('code'))){
    res.writeHead(allowed?403:429,ticketCodeHeaders());
    return res.end(ticketCodePage(ticketId,{inboxId:ticket.inbox_id,message:allowed?'Invalid access code. Check the email and try again.':'Too many attempts. Try again after 15 minutes.',error:true}));
   }
   res.writeHead(303,{'set-cookie':makeTicketCookie(GATE_PUBLIC_REPLY_SECRET,ticketId),
    'location':'/ai-support/t/'+ticketId,'cache-control':'no-store','referrer-policy':'same-origin'});
   return res.end();
  }
  // Request sends ONLY to the verified original Libredesk contact inbox.
  let notice='An access code has been sent to the original ticket email. Check the inbox and spam folder.';
  try{
   const result=await deliverTicketCode(pool,ticketId,ticket.inbox_id,{
    secret:GATE_PUBLIC_REPLY_SECRET,apiKey:LIBREDESK_INTAKE_API_KEY,apiSecret:LIBREDESK_INTAKE_API_SECRET});
   if(!result.sent)notice='A recent code email has already been requested. Check your inbox or try again after 15 minutes.';
  }catch(e){
   console.error('[ticket-code-request]',String(e.message).slice(0,100));
   notice='Delivery could not be confirmed. Please reply to the original support email for help.';
  }
  res.writeHead(200,ticketCodeHeaders());
  return res.end(ticketCodePage(ticketId,{inboxId:ticket.inbox_id,message:notice}));
 }
 const exportMatch=path.match(/^\/t\/([a-f0-9-]{36})\/(print|pdf)$/i);
 if(exportMatch&&uuid.test(exportMatch[1])&&method==='GET'){
  const id=exportMatch[1],format=exportMatch[2];
  if(!ticketCookieValid(GATE_PUBLIC_REPLY_SECRET,id,req.headers))return fail(res,403,'ticket_access_code_required');
  const ticket=await getPublicTicket(pool,publicTicketBridge,id);
  if(!ticket)return fail(res,404,'ticket_expired_or_unavailable');
  try{
   if(format==='print'){
    const html=await renderPublicTicket(pool,publicTicketBridge,id,{print:true});
    if(!html)return fail(res,404,'ticket_expired_or_unavailable');
    res.writeHead(200,publicHeaders({print:true}));return res.end(html);
   }
   const result=await getTicketMessages(pool,publicTicketBridge,ticket,{all:true});
   const pdf=createTicketPDF(ticket,result.messages);
   pdf.on('error',()=>res.destroy());
   res.writeHead(200,{'content-type':'application/pdf','content-disposition':'attachment; filename="support-ticket-'+String(ticket.reference_number).replace(/[^0-9A-Za-z_-]/g,'')+'.pdf"',
    'cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','referrer-policy':'same-origin','x-robots-tag':'noindex,nofollow,noarchive'});
   return pdf.pipe(res);
  }catch(e){return fail(res,String(e.message)==='ticket_export_too_large'?413:502,String(e.message)==='ticket_export_too_large'?'ticket_export_too_large':'ticket_export_failed');}
 }
 const publicMatch=path.match(/^\/t\/([a-f0-9-]{36})$/i);
 if(publicMatch&&uuid.test(publicMatch[1])){
  const ticketId=publicMatch[1];
  if(method==='GET'){
   const ticket=await getPublicTicket(pool,publicTicketBridge,ticketId);
   if(!ticket){res.writeHead(404,ticketCodeHeaders());return res.end('Ticket link unavailable or expired')}
   if(!ticketCookieValid(GATE_PUBLIC_REPLY_SECRET,ticketId,req.headers)){
    res.writeHead(200,ticketCodeHeaders());return res.end(ticketCodePage(ticketId,{inboxId:ticket.inbox_id}));
   }
   const note=new URL(req.url,'http://localhost').searchParams.get('sent');
   const page=await renderPublicTicket(pool,publicTicketBridge,ticketId,{
    issueForm:id=>issueReplyForm(GATE_PUBLIC_REPLY_SECRET,id),
    page:new URL(req.url,'http://localhost').searchParams.get('page'),
    notice:note==='1'?'sent':''});
   res.writeHead(page?200:404,publicHeaders());return res.end(page||'Ticket link unavailable or expired');
  }
  if(method==='POST'){
   if(!allowPublicOrigin(req.headers))return fail(res,403,'same_origin_required');
   if(!ticketCookieValid(GATE_PUBLIC_REPLY_SECRET,ticketId,req.headers))return fail(res,403,'ticket_access_code_required');
   const ticket=await getPublicTicket(pool,publicTicketBridge,ticketId);
   if(!ticket)return fail(res,404,'ticket_expired_or_unavailable');
   if(Number(ticket.status_id)===4)return fail(res,409,'closed_ticket_read_only');
   let input;
   try{input=validatePublicForm(GATE_PUBLIC_REPLY_SECRET,ticketId,await readPublicForm(req))}
   catch{return fail(res,400,'invalid_or_expired_form_reload_ticket')}
   try{await submitPublicReply(pool,publicTicketBridge,ticket,input)}
   catch(e){const code=String(e.message);
    return fail(res,code==='reply_rate_limited'?429:code==='duplicate_request'?409:502,
     code==='reply_rate_limited'?'reply_rate_limited':code==='duplicate_request'?'duplicate_request':'reply_not_confirmed_refresh_ticket');}
   res.writeHead(303,{'location':'/ai-support/t/'+ticketId+'?sent=1','cache-control':'no-store','referrer-policy':'same-origin'});
   return res.end();
  }
 }
 if(path==='/'&&String(req.headers.host||'').endsWith(':9088')){
  res.writeHead(302,{location:'https://support.thaiduy.digital/ai-support/','cache-control':'no-store'});
  return res.end();
 }
 if(path==='/healthz')return json(res,200,{ok:true,service:'support-gate',outbound_ready:outgoingReady(),ai_draft_ready:aiReady()});
 if(path==='/api/webhooks/libredesk'&&method==='POST')return receiveWebhook(req,res);
 if(['/', '/app.js','/styles.css','/ticket.css','/print-ticket.js','/ticket-actions.js','/branding/light-remote-mark.png','/branding/light-remote-mark-256.png','/branding/lightbi-app-icon.png'].includes(path)&&method==='GET'){
  const file=path==='/'?'index.html':path.slice(1),text=await readFile(join(root,file));
  const type=file.endsWith('.png')?'image/png':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
  res.writeHead(200,{'content-type':type+(type==='image/png'?'':'; charset=utf-8'),'cache-control':type==='image/png'?'public, max-age=3600':'no-store',
   'content-security-policy':"default-src 'self';script-src 'self';style-src 'self';base-uri 'none';object-src 'none';frame-ancestors 'none'"});
  return res.end(text);
 }
 if(path==='/api/agent/drafts'&&method==='POST'){
  // Scoped Light Remote bridge capability: create drafts only, never approve/send.
  const provided=String(req.headers['x-gate-worker-token']||'');
  const digest=crypto.createHash('sha256').update(provided).digest();
  const expected=Buffer.from(GATE_WORKER_TOKEN_HASH||'','hex');
  if(!provided||expected.length!==32||!crypto.timingSafeEqual(digest,expected))
   return fail(res,403,'worker_not_authorized');
  const d=validate(await readJson(req)),id=crypto.randomUUID();
  await pool.query('INSERT INTO support_gate_drafts(id,brand,conversation_uuid,recipient,subject,message,based_on_message_uuid) VALUES($1,$2,$3,$4,$5,$6,$7)',
   [id,d.brand,d.conversation,d.recipient,d.subject,d.message,d.baseline||null]);
  await log(id,'light_remote_agent_draft_created',{brand:d.brand});
  return json(res,201,{ok:true,id,status:'draft'});
 }
 // Owner access is delegated to the EXISTING Libredesk session on this same
 // NetBird host. No second admin password or account exists in Support Gate.
 if(path==='/api/session'){
  const s=await guard(req,res);if(!s)return;
  return json(res,200,{ok:true,csrf:s.csrf,outbound_ready:outgoingReady(),ai_draft_ready:aiReady(),email:s.email});
 }
 const s=await guard(req,res,method!=='GET');if(!s)return;
 if(path==='/api/tickets/queue'&&method==='GET')return loadOwnerQueue(req,res);
 const aiDraftMatch=path.match(/^\/api\/tickets\/([a-f0-9-]{36})\/ai-draft$/i);
 if(method==='POST'&&aiDraftMatch&&uuid.test(aiDraftMatch[1]))
  return ownerCreateAIDraft(req,res,aiDraftMatch[1]);
 const ownerReplyMatch=path.match(/^\/api\/tickets\/([a-f0-9-]{36})\/reply$/i);
 if(method==='POST'&&ownerReplyMatch&&uuid.test(ownerReplyMatch[1]))
  return ownerSendNativeReply(req,res,ownerReplyMatch[1]);
 const ticketMatch=path.match(/^\/api\/tickets\/([a-f0-9-]{36})$/i);
 if(method==='GET'&&ticketMatch&&uuid.test(ticketMatch[1]))
  return loadOwnerTicket(req,res,ticketMatch[1]);
 if(path==='/api/integration/connect-webhook'&&method==='POST')return connectWebhook(req,res);
 if(path==='/api/inbound/events'&&method==='GET'){
  const rows=await pool.query('SELECT id,event_type,conversation_uuid,message_uuid,inbox_id,sender_type,status,received_at FROM support_gate_inbound_events ORDER BY id DESC LIMIT 100');
  const count=await pool.query('SELECT count(*)::integer AS total FROM support_gate_inbound_events');
  const integration=await pool.query("SELECT external_id FROM support_gate_integration WHERE name='libredesk_webhook'");
  return json(res,200,{ok:true,total:count.rows[0].total,events:rows.rows,webhook_ready:Boolean(GATE_WEBHOOK_SECRET),webhook_connected:Boolean(integration.rowCount),mail_sending_ready:outgoingReady()});
 }
 if(path==='/api/drafts'&&method==='GET'){
  const rows=await pool.query('SELECT * FROM support_gate_drafts ORDER BY updated_at DESC LIMIT 100');
  return json(res,200,{ok:true,drafts:rows.rows});
 }
 if(path==='/api/drafts'&&method==='POST'){
  const d=validate(await readJson(req)),id=crypto.randomUUID();
  await pool.query('INSERT INTO support_gate_drafts(id,brand,conversation_uuid,recipient,subject,message,based_on_message_uuid) VALUES($1,$2,$3,$4,$5,$6,$7)',
   [id,d.brand,d.conversation,d.recipient,d.subject,d.message,d.baseline||null]);
  await log(id,'draft_created');
  return json(res,201,{ok:true,id});
 }
 const match=path.match(/^\/api\/drafts\/([a-f0-9-]{36})(?:\/(approve|send))?$/i);
 if(!match||!uuid.test(match[1]))return fail(res,404,'not_found');
 const id=match[1],action=match[2];
 if(method==='PATCH'&&!action){
  const d=validate(await readJson(req));
  const result=await pool.query("UPDATE support_gate_drafts SET brand=$2,conversation_uuid=$3,recipient=$4,subject=$5,message=$6,based_on_message_uuid=$7,version=version+1,status='draft',approved_at=null,updated_at=now() WHERE id=$1 AND status IN ('draft','approved','needs_review') RETURNING version",
   [id,d.brand,d.conversation,d.recipient,d.subject,d.message,d.baseline||null]);
  if(!result.rowCount)return fail(res,409,'draft_not_editable');
  await log(id,'draft_edited');
  return json(res,200,{ok:true,version:result.rows[0].version});
 }
 if(method==='POST'&&action==='approve'){
  const d=await readJson(req);
  const row=await pool.query("UPDATE support_gate_drafts SET status='approved',approved_at=now(),updated_at=now() WHERE id=$1 AND version=$2 AND status='draft' RETURNING id",[id,Number(d.version)]);
  if(!row.rowCount)return fail(res,409,'draft_stale_or_not_draft');
  await log(id,'owner_approved');
  return json(res,200,{ok:true,status:'approved'});
 }
 if(method==='POST'&&action==='send'){
  const d=await readJson(req);return send(res,id,Number(d.version));
 }
 return fail(res,404,'not_found');
}
await setup();
const server=http.createServer((req,res)=>Promise.resolve(handler(req,res)).catch(e=>{
 console.error('support_gate_request_failed',e.code||e.message?.split(' ')[0]||'unexpected');
 if(!res.headersSent)fail(res,500,'internal_error');else res.end();
}));
server.listen(Number(process.env.PORT||9088),'0.0.0.0',()=>console.log('SUPPORT_GATE_OWNER_REVIEW_READY'));
process.on('SIGTERM',()=>server.close(async()=>{await Promise.all([pool.end(),publicTicketBridge.end()])}));
