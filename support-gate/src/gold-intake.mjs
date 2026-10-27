import crypto from 'node:crypto';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const email=/^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,24}$/i;
export function signature(secret,ts,id,body){
 return crypto.createHmac('sha256',secret).update(ts+'.'+id+'.'+body).digest('hex');
}
export function validSignedIntake(secret,headers,body,now=Date.now()){
 if(!secret||secret.length<40||typeof body!=='string'||body.length>16384)return false;
 const ts=String(headers['x-gold-time']||''),id=String(headers['x-gold-request-id']||'');
 const mac=String(headers['x-gold-signature']||'');
 if(!/^\d{13}$/.test(ts)||Math.abs(now-Number(ts))>300000||!uuid.test(id)||!/^[a-f0-9]{64}$/.test(mac))return false;
 return crypto.timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(signature(secret,ts,id,body),'hex'));
}
export function validateTicketPayload(body){
 const d=JSON.parse(body);
 if(!d||Array.isArray(d)||typeof d!=='object')throw Error('invalid_payload');
 const address=String(d.email||'').trim().toLowerCase();
 const name=String(d.name||'').trim();
 const subject=String(d.subject||'').trim();
 const detail=String(d.description||'').trim();
 const area=String(d.problemArea||'other').trim();
 const status=String(d.deviceStatus||'unknown').trim();
 const os=String(d.targetOsArch||'').trim();
 const ver=String(d.targetVersion||'').trim();
 const err=String(d.sanitizedError||'').trim();
 if(!email.test(address)||address.length>254)throw Error('invalid_email');
 if(name.length>100||!subject||subject.length>180||!detail||detail.length>3000)throw Error('invalid_fields');
 if(!['install','approval','remote','account','update','billing','security','other'].includes(area))throw Error('invalid_area');
 if(!['unknown','online','offline'].includes(status)||os.length>120||ver.length>100||err.length>1200)throw Error('invalid_fields');
 const bounded=(key,max)=>String(d[key]||'').trim().slice(0,max);
 return {email:address,name,subject,description:detail,problemArea:area,deviceStatus:status,targetOsArch:os,targetVersion:ver,sanitizedError:err,
  accountVerified:d.accountVerified===true,accountPlan:bounded('accountPlan',48),
  browserPlatform:bounded('browserPlatform',120),browserUserAgent:bounded('browserUserAgent',500),
  serverCoreVersion:bounded('serverCoreVersion',120),mcpSurfaceVersion:bounded('mcpSurfaceVersion',120),
  registeredDevice:d.registeredDevice&&typeof d.registeredDevice==='object'&&!Array.isArray(d.registeredDevice)?
   Object.fromEntries(['name','platform','architecture','version','status'].map(k=>[k,String(d.registeredDevice[k]||'').slice(0,k==='name'?160:120)])):null};
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
export function nativeTicketBody(d){
 return '<p>'+esc(d.description).replace(/\r?\n/g,'<br>')+'</p><p><strong>Source:</strong> Gold Distribution /support<br>'+
 '<strong>Area:</strong> '+esc(d.problemArea)+'<br><strong>Device:</strong> '+esc(d.deviceStatus)+
 '<br><strong>OS / arch (target device):</strong> '+esc(d.targetOsArch)+'<br><strong>Client version (target device):</strong> '+esc(d.targetVersion)+
 (d.sanitizedError?'<br><strong>Sanitized error:</strong> '+esc(d.sanitizedError).replace(/\r?\n/g,'<br>'):'')+
 '</p><p><strong>Gold account:</strong> '+(d.accountVerified?'Verified session':'Guest')+
 (d.accountVerified?'<br><strong>Current plan:</strong> '+esc(d.accountPlan||'Unknown'):'')+
 '<br><strong>Detected browser platform:</strong> '+esc(d.browserPlatform)+
 '<br><strong>Browser:</strong> '+esc(d.browserUserAgent)+
 '<br><strong>Gold Core:</strong> '+esc(d.serverCoreVersion)+
 '<br><strong>MCP Surface:</strong> '+esc(d.mcpSurfaceVersion)+
 (d.registeredDevice?'<br><strong>Registered device:</strong> '+esc(d.registeredDevice.name)+
 ' · '+esc(d.registeredDevice.platform)+' / '+esc(d.registeredDevice.architecture)+
 ' · '+esc(d.registeredDevice.version)+' · '+esc(d.registeredDevice.status):'')+'</p>';
}
export async function createGoldTicket(req,res,{pool,secret,apiKey,apiSecret,inboxId,readBody,sendJson,fetchImpl=fetch}){
 const bad=(status,error)=>sendJson(res,status,{ok:false,error});
 if(!apiKey||!apiSecret||!inboxId||!secret)return bad(503,'intake_unavailable');
 let raw;
 try{raw=await readBody(req,16384)}catch{return bad(413,'request_too_large')}
 if(!validSignedIntake(secret,req.headers,raw))return bad(403,'invalid_signature');
 const id=String(req.headers['x-gold-request-id']);
 let data;
 try{data=validateTicketPayload(raw)}catch{return bad(400,'invalid_ticket_request')}
 const inserted=await pool.query("INSERT INTO support_gate_gold_intake_requests(request_id,state) VALUES($1,'processing') ON CONFLICT DO NOTHING RETURNING request_id",[id]);
 if(!inserted.rowCount){
  const prior=await pool.query('SELECT state,reference_number FROM support_gate_gold_intake_requests WHERE request_id=$1',[id]);
  const row=prior.rows[0]||{};
  if(row.state==='created')return sendJson(res,200,{ok:true,accepted:true,referenceNumber:row.reference_number});
  return bad(409,'submission_already_processing_check_email');
 }
 try{
  const content=nativeTicketBody(data);
  const remote=await fetchImpl('http://app:9000/api/v1/conversations',{
   method:'POST',headers:{authorization:'token '+apiKey+':'+apiSecret,'content-type':'application/json','accept':'application/json'},
   body:JSON.stringify({inbox_id:Number(inboxId),contact_email:data.email,first_name:data.name||'Support Customer',
    subject:data.subject,content,initiator:'contact',reuse_contact:true,
    source_id:'<gold-'+id+'@support.thaiduy.digital>'}),
   signal:AbortSignal.timeout(12000)
  });
  const reply=await remote.json().catch(()=>({}));
  const item=reply?.data||reply?.message||reply;
  if(!remote.ok||!uuid.test(String(item?.uuid||'')))throw Error('native_ticket_not_confirmed');
  const ref=String(item.reference_number||'');
  await pool.query("UPDATE support_gate_gold_intake_requests SET state='created',reference_number=$2,conversation_uuid=$3 WHERE request_id=$1",[id,ref,item.uuid]);
  // Webhook should grant public access; bounded reconciliation if event delivery is delayed.
  await pool.query("INSERT INTO support_gate_public_ticket_access(conversation_uuid,inbox_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[item.uuid,Number(inboxId)]);
  return sendJson(res,201,{ok:true,accepted:true,referenceNumber:ref,message:'Check your email for the private ticket link.'});
 }catch{
  await pool.query("UPDATE support_gate_gold_intake_requests SET state='uncertain' WHERE request_id=$1",[id]).catch(()=>{});
  return bad(502,'submission_unconfirmed_please_check_email_before_retrying');
 }
}
