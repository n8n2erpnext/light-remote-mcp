import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const operator=require('../../lib/operator');
operator.callOperator=async (path,options={})=>{
  if(path!=='/operator/auth/login'||options.method!=='POST') throw new Error('wrong_auth_upstream');
  if(options.body?.password==='wrong'){const e=new Error('operator_http_401');e.status=401;e.payload={error:'invalid_bridge_credentials'};throw e;}
  return {ok:true,session:{token:'b1.test.token',expiresAt:123,expiresInSeconds:900,scope:'operator'}};
};
const handler=require('../../api/auth');
function res(){return {statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[String(k).toLowerCase()]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};}
let r=res(); await handler({method:'GET',body:{},headers:{}},r); if(r.statusCode!==405) throw new Error('auth_get_not_rejected');
r=res(); await handler({method:'POST',body:{username:'operator',password:''},headers:{}},r); if(r.statusCode!==400) throw new Error('empty_password_not_rejected');
r=res(); await handler({method:'POST',body:{username:'operator',password:'wrong'},headers:{}},r); if(r.statusCode!==401||r.body?.error!=='invalid_bridge_credentials') throw new Error('bad_credentials_not_propagated');
r=res(); await handler({method:'POST',body:{username:'operator',password:'correct'},headers:{}},r); if(r.statusCode!==200||r.body?.session?.token!=='b1.test.token'||JSON.stringify(r.body).includes('correct')) throw new Error('auth_success_contract_failed');
console.log('auth-api-post-only=PASS');
console.log('auth-api-invalid-credentials=PASS');
console.log('auth-api-session-response=PASS');
console.log('auth-api-password-not-reflected=PASS');
