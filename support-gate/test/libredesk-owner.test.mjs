import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sessionCookie,approvedAgent,ownerCsrf} from '../src/libredesk-owner.mjs';
const session='a'.repeat(64);
const ownerEmail='support@thaiduy.digital';
const sys={status:'success',data:{id:1,email:'System',enabled:true,type:'agent',roles:['Admin']}};
test('cookie is exactly scoped to official Libredesk session',()=>{
 assert.equal(sessionCookie('csrf_token=x; libredesk_session='+session+'; other=xyz'),session);
 assert.equal(sessionCookie('sg_session='+session),'');
 assert.equal(sessionCookie('libredesk_session=invalid'),'');
 assert.equal(sessionCookie('libredesk_session='+session+'; libredesk_session=fake'),session);
});
test('allows only explicitly scoped enabled admins',()=>{
 assert.equal(approvedAgent(sys,ownerEmail).email,'System');
 assert.equal(approvedAgent({data:{...sys.data,email:ownerEmail}},ownerEmail).email,ownerEmail);
 assert.equal(approvedAgent({data:{...sys.data,email:{String:ownerEmail,Valid:true}}},ownerEmail).id,1);
 for (const delta of [
 {roles:['Agent']},{email:'attacker@example.com'},{enabled:false},
 {type:'contact'},{id:0},{roles:null}
 ]) assert.equal(approvedAgent({data:{...sys.data,...delta}},ownerEmail),null);
 assert.equal(approvedAgent({data:null},ownerEmail),null);
});
test('csrf is bound to authenticated cookie',()=>{
 assert.equal(ownerCsrf(session,'secret'),ownerCsrf(session,'secret'));
 assert.notEqual(ownerCsrf(session,'secret'),ownerCsrf('b'.repeat(64),'secret'));
});
