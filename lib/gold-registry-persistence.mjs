/**
 * Light Remote Gold canonical registry storage: native PostgreSQL only.
 * Business logic stays in existing Operator/Plugin registries.
 * No JSON-file, SQLite, generic JSONB snapshot or fallback writer.
 */
import {GoldNativeAccountDevice} from './gold-native-account-device.mjs';
import {GoldNativeAccountAux} from './gold-native-account-aux.mjs';
import {GoldNativeProTeam} from './gold-native-pro-team.mjs';
import {GoldNativeLicense} from './gold-native-license.mjs';
import {GoldNativeConnections} from './gold-native-connections.mjs';
import {GoldNativePaddle} from './gold-native-paddle.mjs';
import {GoldNativeSupport} from './gold-native-support.mjs';
import {GoldNativeAB} from './gold-native-ab.mjs';
import {GoldNativeEnrollment} from './gold-native-enrollment.mjs';
import {GoldNativeAgentClients} from './gold-native-agent-clients.mjs';
import {GoldNativeUsage} from './gold-native-usage.mjs';

const DOMAINS=Object.freeze({
 accounts:{maps:['accounts','sessions','oneTimeTokens','upgradeRequests','pendingRegistrations','googleSignupIntents','groups']},
 devices:{maps:['devices']},
 enrollments:{maps:['pending','bindings']},
 connections:{maps:['connections']},
 access_grants:{maps:['requests','grants']},
 agent_clients:{maps:['rows']},
 usage:{maps:['openConnections'],objects:['accounts'],scalars:['trackingSince']},
 licenses:{maps:['rows']},
 pro_teams:{maps:['teams','invites','teamGrants','notificationReads'],objects:['emailInviteEvents']},
 support_outbox:{objects:['rows']},
 paddle_billing:{objects:['state']}
});
function capture(instance,spec){
 const data={schemaVersion:1};
 for(const field of spec.maps||[]){
  if(!(instance[field] instanceof Map))throw Error('gold_native_map_missing:'+field);
  data[field]=[...instance[field]];
 }
 for(const field of spec.objects||[])data[field]=instance[field];
 for(const field of spec.scalars||[])data[field]=instance[field];
 return structuredClone(data);
}
function hydrate(instance,spec,data,domain){
 if(!data||data.schemaVersion!==1)throw Error('gold_native_domain_state_invalid:'+domain);
 for(const field of spec.maps||[]){
  const entries=data[field];
  if(!Array.isArray(entries)||entries.some(x=>!Array.isArray(x)||x.length!==2))
   throw Error('gold_native_entries_invalid:'+domain+':'+field);
  instance[field]=new Map(entries);
 }
 for(const field of spec.objects||[]){
  if(data[field]===null||typeof data[field]!=='object')
   throw Error('gold_native_object_invalid:'+domain+':'+field);
  instance[field]=data[field];
 }
 for(const field of spec.scalars||[]){
  if(data[field]===undefined)throw Error('gold_native_scalar_invalid:'+domain+':'+field);
  instance[field]=data[field];
 }
 if(domain==='accounts'){
  instance.byEmail=new Map();
  for(const [accountId,row] of instance.accounts){
   if(!row?.email||row.accountId!==accountId)throw Error('gold_account_identity_mismatch');
   const email=String(row.email).toLowerCase();
   if(instance.byEmail.has(email))throw Error('gold_account_email_duplicate');
   instance.byEmail.set(email,accountId);
  }
  instance._ensureGroups();
 }
 if(domain==='licenses'){
  instance.byHash=new Map();
  for(const [key,row] of instance.rows){
   if(row.licenseId!==key||!row.keyHash||instance.byHash.has(row.keyHash))
    throw Error('gold_license_identity_mismatch');
   instance.byHash.set(row.keyHash,key);
  }
 }
}
export class GoldRegistryPersistence{
 constructor({pool}={}){
  if(!pool?.query||!pool?.connect)throw Error('gold_postgres_pool_required');
  this.pool=pool;this.mounted=new Set();this.pending=Promise.resolve();
  this.errored=null;this.loaded={};
 }
 static async open({pool}){
  const store=new GoldRegistryPersistence({pool});
  const [accounts,aux,teams,licenses,connections,paddle,support,ab,enrollments,agentClients,usage]=await Promise.all([
   GoldNativeAccountDevice.open({pool}),GoldNativeAccountAux.open({pool}),
   GoldNativeProTeam.open({pool}),GoldNativeLicense.open({pool}),
   GoldNativeConnections.open({pool}),GoldNativePaddle.open({pool}),
   GoldNativeSupport.open({pool}),GoldNativeAB.open({pool}),
   GoldNativeEnrollment.open({pool}),GoldNativeAgentClients.open({pool}),
   GoldNativeUsage.open({pool})
  ]);
  store.native={accounts,aux,teams,licenses,connections,paddle,support,ab,enrollments,agentClients,usage};
  store.loaded={
   accounts:{schemaVersion:1,...aux.data,accounts:accounts.accounts.map(row=>[row.accountId,row])},
   devices:{schemaVersion:1,devices:accounts.devices.map(row=>[row.deviceId,row])},
   pro_teams:teams.data,
   licenses:{schemaVersion:1,rows:licenses.rows},
   connections:{schemaVersion:1,connections:connections.rows},
   paddle_billing:{schemaVersion:1,state:paddle.data},
   support_outbox:{schemaVersion:1,rows:support.rows},
   enrollments:enrollments.data,
   agent_clients:{schemaVersion:1,rows:agentClients.rows},
   usage:usage.data
  };
  return store;
 }
 mount(domain,instance){
  if(!Object.hasOwn(DOMAINS,domain)||this.mounted.has(domain))
   throw Error('gold_native_domain_invalid_or_duplicate:'+domain);
  const data=domain==='access_grants'?this.native.ab.mount():this.loaded[domain];
  hydrate(instance,DOMAINS[domain],data,domain);
  instance.stateFile=null; // Never load or write a legacy JSON state file.
  instance._persist=()=>this.enqueue(domain,capture(instance,DOMAINS[domain]));
  instance._save=instance._persist;
  this.mounted.add(domain);
  // Persist default groups/initial state through native SQL before the API
  // starts listening. A missing table/permission fails closed.
  instance._persist();
  return instance;
 }
 enqueue(domain,data){
  if(this.errored)throw this.errored;
  const n=this.native;
  this.pending=this.pending.then(async()=>{
   switch(domain){
    case 'accounts':
     return n.accounts.writeAccounts(new Map(data.accounts),
      client=>n.aux.store.write(data,client));
    case 'devices':return n.accounts.writeDevices(new Map(data.devices));
    case 'pro_teams':return n.teams.store.write(data);
    case 'licenses':return n.licenses.store.write(new Map(data.rows));
    case 'connections':return n.connections.store.write(new Map(data.connections));
    case 'paddle_billing':return n.paddle.store.write(data.state);
    case 'support_outbox':return n.support.store.write(data.rows);
    case 'access_grants':return n.ab.write(data);
    case 'enrollments':return n.enrollments.store.write(data);
    case 'agent_clients':return n.agentClients.store.write(new Map(data.rows));
    case 'usage':return n.usage.store.write(data);
    default:throw Error('gold_native_domain_unimplemented:'+domain);
   }
  }).catch(error=>{
   this.errored=Error('gold_native_postgres_write_failed:'+domain,{cause:error});
   throw this.errored;
  });
  this.pending.catch(()=>{});
 }
 async flush(){await this.pending;if(this.errored)throw this.errored}
}
