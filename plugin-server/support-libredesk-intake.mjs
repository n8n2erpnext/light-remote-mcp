import crypto from 'node:crypto';
import fs from 'node:fs';

const emailRegex=/^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,24}$/i;
const areas=new Set(['install','approval','remote','account','update','billing','security','other']);
export function validateGoldSupportRequest(body={}){
 const data={
  email:String(body.email||'').trim().toLowerCase(),
  name:String(body.name||'').trim(),
  subject:String(body.subject||'').trim(),
  description:String(body.description||'').trim(),
  problemArea:String(body.problemArea||'other').trim(),
  deviceStatus:String(body.deviceStatus||'unknown').trim(),
  targetOsArch:String(body.targetOsArch||'').trim(),
  targetVersion:String(body.targetVersion||'').trim(),
  sanitizedError:String(body.sanitizedError||'').trim()
 };
 if(String(body.website||'').trim())throw Object.assign(Error('submission_rejected'),{status:400});
 if(!emailRegex.test(data.email)||data.email.length>254)throw Object.assign(Error('valid_email_required'),{status:400});
 if(data.name.length>100||!data.subject||data.subject.length>180||
  !data.description||data.description.length>3000||data.sanitizedError.length>1200||
  data.targetOsArch.length>120||data.targetVersion.length>100)throw Object.assign(Error('invalid_support_fields'),{status:400});
 if(!areas.has(data.problemArea)||!['unknown','online','offline'].includes(data.deviceStatus))throw Object.assign(Error('invalid_support_fields'),{status:400});
 return data;
}
export function signedGoldHeaders(secret,id,body,timestamp=Date.now()){
 const ts=String(timestamp);
 const sig=crypto.createHmac('sha256',secret).update(ts+'.'+id+'.'+body).digest('hex');
 return {'content-type':'application/json','accept':'application/json','x-gold-time':ts,'x-gold-request-id':id,'x-gold-signature':sig};
}
export async function callGoldSupportIntake(data,{secretFile=(process.env.LIGHT_REMOTE_SUPPORT_GATE_SECRET_FILE||(process.env.LIGHT_REMOTE_GOLD_DEMO==='1'?'/opt/light-remote-gold-uat/secrets/support-intake.secret':undefined)),requestId=crypto.randomUUID(),fetchImpl=fetch}={}){
 const secret=fs.readFileSync(secretFile,'utf8').trim();
 if(secret.length<40)throw Error('support_intake_not_configured');
 const payload=JSON.stringify(data);
 const response=await fetchImpl('https://support.thaiduy.digital/ai-support/api/internal/gold-intake',{
  method:'POST',headers:signedGoldHeaders(secret,requestId,payload),body:payload,
  signal:AbortSignal.timeout(18000),redirect:'error'
 });
 const body=await response.json().catch(()=>({ok:false,error:'malformed_intake_response'}));
 if(!response.ok||body.ok!==true){
  const error=String(body.error||'intake_not_confirmed');
  throw Object.assign(Error(error),{status:response.status===429?429:response.status===400?400:response.status===409?409:502});
 }
 return {accepted:true,referenceNumber:String(body.referenceNumber||''),message:'Ticket created. Check your email for your private ticket link.'};
}
