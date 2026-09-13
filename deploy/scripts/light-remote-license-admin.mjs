#!/usr/bin/env node
import http from 'node:http';

const socketPath=process.env.OPERATOR_SOCKET||'/home/ubuntu/.local/run/gpt-vps-operator/operator.sock';
const [command,...args]=process.argv.slice(2);
function request(method,target,body=null){return new Promise((resolve,reject)=>{const payload=body==null?null:Buffer.from(JSON.stringify(body)),headers={accept:'application/json'};if(payload){headers['content-type']='application/json';headers['content-length']=payload.length;}const req=http.request({socketPath,method,path:target,headers},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>{let json;try{json=JSON.parse(text)}catch{json={raw:text}}if(res.statusCode<200||res.statusCode>=300){const e=new Error(json.error||`http_${res.statusCode}`);e.status=res.statusCode;e.payload=json;reject(e);return;}resolve(json);});});req.on('error',reject);if(payload)req.write(payload);req.end();});}
function days(value){const n=Number(value);if(!Number.isFinite(n)||n<=0||n>3650)throw new Error('invalid_days');return n;}
function print(value){console.log(JSON.stringify(value,null,2));}
try{
  if(command==='issue'){
    const [plan,daysRaw,...labelParts]=args;const result=await request('POST','/v1/admin/licenses/issue',{plan,durationDays:days(daysRaw),label:labelParts.join(' ')});
    print({...result,note:'Plaintext key is shown only on issuance. Deliver it to the user, then treat it as a secret.'});
  }else if(command==='list') print(await request('GET','/v1/admin/licenses'));
  else if(command==='revoke'){
    const [licenseId,...reason]=args;print(await request('POST',`/v1/admin/licenses/${encodeURIComponent(licenseId||'')}/revoke`,{reason:reason.join(' ')||'admin_revoked'}));
  }else if(command==='grant'){
    const [accountId,plan,term='permanent']=args;const durationDays=term==='permanent'?null:days(term);print(await request('POST',`/v1/admin/accounts/${encodeURIComponent(accountId||'')}/entitlement`,{plan,durationDays,sourceRef:'license-admin-cli'}));
  }else if(command==='revoke-entitlement'){
    const [accountId,...reason]=args;print(await request('POST',`/v1/admin/accounts/${encodeURIComponent(accountId||'')}/entitlement/revoke`,{reason:reason.join(' ')||'license-admin-cli'}));
  }else if(command==='account'){
    const [accountId]=args;print(await request('GET',`/v1/admin/accounts/${encodeURIComponent(accountId||'')}`));
  }else{
    console.error('Usage: light-remote-license-admin.mjs issue <pro|vip> <days> [label] | list | revoke <licenseId> [reason] | grant <accountId> <free|pro|vip> <days|permanent> | revoke-entitlement <accountId> [reason] | account <accountId>');
    process.exitCode=2;
  }
}catch(error){console.error(JSON.stringify({ok:false,error:error.message,status:error.status||null},null,2));process.exitCode=1;}
