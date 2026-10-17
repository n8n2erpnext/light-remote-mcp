import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import {GoldPgCoreAuthority} from '../src/storage/gold-core-authority.mjs';
import {GoldPgNotificationRepository} from '../src/storage/notifications-pg.mjs';
import {createGoldCoreHttpHandler} from '../src/http/gold-core-http.mjs';

const NOW=Date.parse('2026-10-17T17:00:00.000Z');
const QA='sys_123e4567-e89b-42d3-a456-426614174000';
const QA_TOKEN='Q'.repeat(48),OTHER_TOKEN='O'.repeat(48);
const actorByHash=new Map([
 [crypto.createHash('sha256').update(QA_TOKEN).digest('hex'),
  {account_id:'acct_quality',email:'qa@example.test',
   plan:'free',group_id:'grp_quality'}],
 [crypto.createHash('sha256').update(OTHER_TOKEN).digest('hex'),
  {account_id:'acct_other',email:'other@example.test',
   plan:'free',group_id:'grp_default'}]
]);
test('Gold real Core session projection + PG notifications enforce group audience end to end',async()=>{
 const statements=[];
 const notice={notification_id:QA,category:'feature',title:'Quality only',
  body:'Group quality announcement',link:'/account/inbox',
  audience_type:'group',audience_value:'grp_quality',
  published_by:'acct_admin',scheduled_at:new Date(NOW-10000),
  created_at:new Date(NOW-10000),expires_at:null,canceled_at:null};
 const pool={
  query:async(sql,params=[])=>{
   statements.push({sql,params});
   if(sql.includes('FROM lr_sessions s JOIN lr_accounts a')){
    assert(sql.includes('a.group_id'),'Core must load group from verified PG account');
    const actor=actorByHash.get(params[0]);
    return{rows:actor?[{session_id:'as_test',expires_at:new Date(NOW+3600000),
     ...actor}]:[]};
   }
   if(sql.startsWith('SELECT n.*,rd.read_at FROM lr_notifications n')){
    assert(sql.includes("n.audience_type='group' AND n.audience_value=$3"));
    return{rows:params[2]==='grp_quality'?
     [{...notice,read_at:null}]:[]};
   }
   throw Error('unexpected_sql_group_roundtrip');
  },
  connect:async()=>({query:async()=>({rows:[]}),release(){}})
 };
 const core=new GoldPgCoreAuthority({pool,
  pairingEncryptionKey:crypto.randomBytes(32),
  verifyIdentityProof:async()=>false,verifyDeviceProof:async()=>false,
  verifyAgentPrincipal:async()=>null,verifyWallApproval:async()=>false,
  verifyPaddleSignature:async()=>null});
 const notifications=new GoldPgNotificationRepository({pool,now:()=>NOW});
 const deny=async()=>null;
 const handler=createGoldCoreHttpHandler({core,team:{},notifications,
  approveWallRequest:deny,verifyAgentIngress:deny,
  verifyOAuthClient:deny,verifyBillingIngress:deny,
  verifyUsageIngress:deny});
 const server=http.createServer(async(req,res)=>{
  if(!await handler(req,res)){res.writeHead(404);res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const root='http://127.0.0.1:'+server.address().port;
 const fetchInbox=async(token,url='/v1/accounts/notifications')=>{
  const result=await fetch(root+url,{
   headers:token?{authorization:'Bearer '+token}:{}});
  return{status:result.status,body:await result.json()};
 };
 try{
  const allowed=await fetchInbox(QA_TOKEN,
   '/v1/accounts/notifications?accountId=acct_other&groupId=grp_default');
  assert.equal(allowed.status,200);
  assert.equal(allowed.body.notifications.length,1);
  assert.equal(allowed.body.notifications[0].notificationId,QA);
  const excluded=await fetchInbox(OTHER_TOKEN,
   '/v1/accounts/notifications?groupId=grp_quality&accountId=acct_quality');
  assert.equal(excluded.status,200);
  assert.equal(excluded.body.notifications.length,0);
  const noSession=await fetchInbox(null);
  assert.equal(noSession.status,401);
  const inboxParams=statements.filter(x=>x.sql.startsWith('SELECT n.*,rd.read_at'))
   .map(x=>x.params);
  assert.deepEqual(inboxParams,[
   ['acct_quality','free','grp_quality'],
   ['acct_other','free','grp_default']
  ]);
  assert(statements.every(x=>!x.params.includes('acct_admin_from_body')));
 }finally{await new Promise(resolve=>server.close(resolve))}
});
