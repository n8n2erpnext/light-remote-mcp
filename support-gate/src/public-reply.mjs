import crypto from 'node:crypto';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_AGE=30*60*1000;
export function formToken(secret,ticket,requestId,issued){
 return crypto.createHmac('sha256',secret).update(ticket+'|'+requestId+'|'+issued).digest('hex');
}
export function issueReplyForm(secret,ticket,now=Date.now()){
 const requestId=crypto.randomUUID(),issued=String(now);
 return {requestId,issued,token:formToken(secret,ticket,requestId,issued)};
}
export function validatePublicForm(secret,ticket,form,now=Date.now()){
 const requestId=String(form.get('request_id')||''),issued=String(form.get('issued')||'');
 const token=String(form.get('token')||''),message=String(form.get('message')||'').trim();
 if(!uuid.test(ticket)||!uuid.test(requestId)||!/^\d{13}$/.test(issued)||!/^[a-f0-9]{64}$/.test(token))throw Error('invalid_form');
 const age=now-Number(issued);
 if(age<0||age>MAX_AGE)throw Error('form_expired');
 const valid=Buffer.from(formToken(secret,ticket,requestId,issued),'hex');
 if(!crypto.timingSafeEqual(Buffer.from(token,'hex'),valid))throw Error('invalid_form');
 if(!message||message.length>4000||message.includes('\0'))throw Error('invalid_message');
 return {requestId,message};
}
export async function readPublicForm(req){
 const ctype=String(req.headers['content-type']||'');
 if(!ctype.startsWith('application/x-www-form-urlencoded'))throw Error('unsupported_content_type');
 let len=0;const parts=[];
 for await(const chunk of req){len+=chunk.length;if(len>10000)throw Error('form_too_large');parts.push(chunk)}
 const params=new URLSearchParams(Buffer.concat(parts).toString('utf8'));
 for(const name of ['request_id','issued','token','message']){
  if(params.getAll(name).length!==1)throw Error('invalid_form');
 }
 return params;
}
export function allowPublicOrigin(headers){
 const origin=headers.origin;
 const site=headers['sec-fetch-site'];
 // An explicit Origin must match the public ticket origin. A missing Origin on
 // a native same-origin form navigation is acceptable only with browser-only
 // Fetch Metadata proving same-origin navigation to a document.
 if(origin!==undefined)return origin==='https://support.thaiduy.digital'&&(!site||site==='same-origin');
 return site==='same-origin'&&headers['sec-fetch-mode']==='navigate'&&headers['sec-fetch-dest']==='document';
}
export async function submitPublicReply(pool,bridge,ticket,input){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[ticket.uuid]);
  const recent=await client.query("SELECT COUNT(*) FILTER (WHERE created_at>now()-interval '10 minutes')::integer AS ten,COUNT(*) FILTER (WHERE created_at>now()-interval '24 hours')::integer AS day FROM support_gate_public_web_replies WHERE conversation_uuid=$1",[ticket.uuid]);
  if(recent.rows[0].ten>=3||recent.rows[0].day>=15)throw Error('reply_rate_limited');
  const row=await client.query("INSERT INTO support_gate_public_web_replies(request_id,conversation_uuid,status) VALUES($1,$2,'processing') ON CONFLICT DO NOTHING RETURNING request_id",[input.requestId,ticket.uuid]);
  if(!row.rowCount)throw Error('duplicate_request');
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
 try{
  // Narrow SQL function runs as a DB owner, validates inbox, status and contact.
  // No direct table-write grants are given to the Support Gate DB role.
  const row=await bridge.query('SELECT support_bridge.add_web_reply($1,$2) AS message_uuid',[ticket.uuid,input.message]);
  const messageId=row.rows[0]?.message_uuid;
  if(!uuid.test(messageId))throw Error('web_reply_not_confirmed');
  await pool.query("UPDATE support_gate_public_web_replies SET status='saved',message_uuid=$2 WHERE request_id=$1",[input.requestId,messageId]);
  await pool.query("INSERT INTO support_gate_inbound_events(event_key,event_type,conversation_uuid,message_uuid,inbox_id,sender_type,status) VALUES($1,'message.created',$2,$3,$4,'contact','pending_review') ON CONFLICT(event_key) DO NOTHING",['web:'+messageId,ticket.uuid,messageId,ticket.inbox_id]);
  return messageId;
 }catch(e){
  // An ambiguous DB error after an insert must never be blindly replayed.
  await pool.query("UPDATE support_gate_public_web_replies SET status='uncertain' WHERE request_id=$1",[input.requestId]).catch(()=>{});
  throw e;
 }
}
