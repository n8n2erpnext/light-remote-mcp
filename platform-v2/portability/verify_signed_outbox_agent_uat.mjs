#!/usr/bin/env node
/**
 * P0 controlled cross-layer UAT, completely FAKE-NOOP-only.
 * PG private rc50 schema outbox -> signed Ed25519 fixture -> fake Agent receipt.
 * No real Agent/PTY/Fleet, HTTP/credentials, user data, webhook or migration.
 * Exactly one synthetic run's rows are deleted; UAT writer is left FENCED.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {SyntheticAgentGeneration} from './synthetic-agent-generation.mjs';
import {SyntheticSignedAgentGate,signSyntheticEpoch,signSyntheticCommand}
 from './synthetic-signed-agent-gate.mjs';

const ROOT=path.resolve(import.meta.dirname,'..','..');
const COMPOSE=path.join(ROOT,'platform-v2','compose.yml');
const PROJECT='lightremote-rc50-v2', DB='light_remote_rc50_uat', USER='lr_rc50_uat';
const S='lr_rc50_epoch_synthetic';
const rid=crypto.randomBytes(7).toString('hex');
const holder='uat_e2e_'+rid;
const accountId='uat_account_e2e_fake',deviceId='uat_device_e2e_fake',agentId='uat_agent_e2e_fake';
const consumer='uat_fake_consumer_'+rid;
const ids=[];
let generation=null,fixture=null,stage='preflight',stats={};
const requireTrue=(x,why)=>{if(!x)throw Error('RC50_SIGNED_OUTBOX_FAIL:'+why);};
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
const run=(file,args)=>execFileSync(file,args,{cwd:ROOT,encoding:'utf8',timeout:18000,maxBuffer:2e6});
const compose=args=>run('docker',['compose','-p',PROJECT,'-f',COMPOSE,...args]);
const psql=query=>compose(['exec','-T','postgres','psql','-X','-v','ON_ERROR_STOP=1',
  '-At','-U',USER,'-d',DB,'-c',query]).trim();
const scalar=query=>{
  const lines=psql(query).split('\n').filter(Boolean);
  requireTrue(lines.length>0,'sql_scalar_empty');
  return lines.at(-1);
};
const state=()=>scalar(`SELECT generation||'|'||state||'|'||coalesce(holder,'NONE')
    FROM ${S}.writer_authority WHERE id=1`).split('|');
const formatCommand=(id,gen,digest,key,notice)=>{
  const now=Date.now();
  return signSyntheticCommand(key,{kind:'fake_command',accountId,deviceId,agentId,
    generation:gen,grantRevision:gen===initialGen?7:8,epochDigest:digest,
    commandId:id,notBefore:now-1000,expiresAt:now+56000,
    payload:{kind:'fake_noop',message:notice}});
};
const envelopeSQL=packet=>quote(JSON.stringify({signedFakeCommand:packet}))+'::jsonb';
const enqueue=(id,gen,packet,asHolder=holder)=>{
  return scalar(`SELECT ${S}.enqueue_command_uat(${quote(asHolder)},${gen},
    ${quote(id)},'fake_fleet',${envelopeSQL(packet)})`);
};
let claimIndex=0;
const claim=gen=>{
  const tag='uat_tag_e2e_'+rid+'_'+String(++claimIndex).padStart(2,'0');
  const output=psql(`SELECT row_to_json(q) FROM
    (SELECT * FROM ${S}.claim_command_uat(
    ${quote(holder)},${gen},${quote(consumer)},${quote(tag)},300)) q`);
  return {tag,row:output?JSON.parse(output.split('\n').at(-1)):null};
};
const ack=(gen,id,tag)=>scalar(`SELECT ${S}.ack_command_uat(
  ${quote(holder)},${gen},${quote(id)},${quote(consumer)},${quote(tag)})`);
const fakeId=n=>{const id='uat_cmd_e2e_'+rid+'_'+n;ids.push(id);return id;};
const fetchSigned=claimed=>{
  requireTrue(claimed?.out_kind==='fake_fleet','outbox_not_fake_fleet');
  requireTrue(typeof claimed?.out_command_id==='string','outbox_missing_command_id');
  const packet=claimed?.out_payload?.signedFakeCommand;
  requireTrue(packet?.payload?.commandId===claimed.out_command_id,'outbox_packet_id_mismatch');
  requireTrue(packet?.payload?.generation===Number(claimed.out_generation),'outbox_packet_epoch_mismatch');
  return packet;
};
const keys=crypto.generateKeyPairSync('ed25519');
const epochPacket=gen=>{
  const now=Date.now();
  return signSyntheticEpoch(keys.privateKey,{kind:'fake_epoch',accountId,deviceId,agentId,
    generation:gen,grantRevision:gen===initialGen?7:8,
    notBefore:now-1000,expiresAt:now+225000});
};
let epoch1=null,epoch2=null,initialGen=null;
const gateFactory=agent=>new SyntheticSignedAgentGate({
  agent,publicKey:keys.publicKey,
  accountId,deviceId,agentId
});
function preflight(){
  requireTrue(ROOT.endsWith('/light-remote-mcp-worktrees/rc50-v2-platform'),'unsafe_worktree');
  requireTrue(fs.readFileSync(COMPOSE,'utf8').includes('name: lightremote-rc50-v2'),'wrong_compose');
  const services=compose(['ps','--format','json']).split('\n').filter(Boolean).map(JSON.parse);
  requireTrue(services.length>=2,'missing_rc50_services');
  const network=JSON.parse(run('docker',['network','inspect',PROJECT+'_private']));
  requireTrue(network.length===1&&network[0].Internal===true,'uat_network_not_internal');
  for(const name of ['postgres','redis']){
    const rows=services.filter(x=>x.Service===name&&x.Project===PROJECT);
    requireTrue(rows.length===1&&rows[0].Health==='healthy','unsafe_service_'+name);
    requireTrue(rows[0].Publishers.every(x=>!x.PublishedPort),'published_port_'+name);
    requireTrue(rows[0].Labels.includes('rc50-v2-platform/platform-v2/compose.yml'),'wrong_compose_label');
  }
  requireTrue(scalar('SELECT current_database()')===DB,'wrong_database');
  requireTrue(scalar('SELECT current_user')===USER,'wrong_user');
  requireTrue(scalar(`SELECT COALESCE(to_regclass('${S}.command_outbox')::text,'ABSENT')`)
    ===S+'.command_outbox','no_synthetic_outbox');
  const current=state();
  requireTrue(current[1]==='fenced'&&current[2]==='NONE','writer_not_fenced_at_entry');
  requireTrue(scalar(`SELECT count(*) FROM ${S}.command_outbox`)==='0','outbox_nonempty_at_entry');
  return Number(current[0]);
}
try{
  const initial=preflight();
  stage='acquire_synthetic_writer';
  fixture=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-agent-fixture-'));
  initialGen=Number(scalar(`SELECT ${S}.start_writer_uat(${quote(holder)},${initial},300)`));
  generation=initialGen;
  requireTrue(generation===initial+1,'source_generation_not_monotonic');
  let agent=new SyntheticAgentGeneration({root:fixture,agentId});
  let gate=gateFactory(agent);
  epoch1=epochPacket(generation);
  const digest1=gate.applyEpoch(epoch1).epochDigest;
  stage='acked_once_and_duplicate';
  const id1=fakeId('ack');
  const packet1=formatCommand(id1,generation,digest1,keys.privateKey,'one completed fake noop');
  requireTrue(enqueue(id1,generation,packet1)==='queued','initial_enqueue');
  requireTrue(enqueue(id1,generation,packet1)==='duplicate_same_envelope','db_duplicate_idempotency');
  const claimed1=claim(generation);
  requireTrue(claimed1.row?.out_command_id===id1,'claim_1_mismatch');
  const delivered1=fetchSigned(claimed1.row);
  requireTrue(gate.accept(delivered1).status==='accepted_receipt_persisted','agent_refused_verified_noop');
  requireTrue(gate.startFake(id1).executed===false,'unexpected_execution_1');
  requireTrue(agent.completeFake(id1).executed===false,'unexpected_execution_2');
  requireTrue(ack(generation,id1,claimed1.tag)==='t','ack_1_not_committed');
  requireTrue(ack(generation,id1,claimed1.tag)==='f','ack_1_repeat_allowed');
  requireTrue(gate.accept(delivered1).status==='duplicate_no_execution','duplicate_receipt_replayed');
  stats.acked_once_and_duplicate=true;

  stage='uncertain_restart_before_fence';
  const id2=fakeId('uncertain');
  requireTrue(enqueue(id2,generation,formatCommand(id2,generation,digest1,
    keys.privateKey,'fake started but ack lost'))==='queued','enqueue_uncertain');
  const claimed2=claim(generation);
  requireTrue(claimed2.row?.out_command_id===id2,'claim_uncertain_mismatch');
  const delivered2=fetchSigned(claimed2.row);
  gate.accept(delivered2);gate.startFake(id2);
  agent=new SyntheticAgentGeneration({root:fixture,agentId});
  gate=gateFactory(agent);gate.applyEpoch(epoch1);
  requireTrue(agent.receipts()[id2].status==='uncertain','crash_did_not_mark_uncertain');
  requireTrue(gate.accept(delivered2).status==='duplicate_no_execution','crash_duplicate_execution');
  assert.throws(()=>gate.startFake(id2),/signed_command_not_fresh_for_start/);
  stats.inflight_restart_quarantined=true;

  stage='rogue_signature_rejected_after_outbox_claim';
  const rogueKeys=crypto.generateKeyPairSync('ed25519');
  const idBad=fakeId('invalid');
  requireTrue(enqueue(idBad,generation,formatCommand(idBad,generation,digest1,
    rogueKeys.privateKey,'signed by fake attacker only'))==='queued','enqueue_rogue_signature');
  const claimedBad=claim(generation);
  requireTrue(claimedBad.row?.out_command_id===idBad,'claim_bad_mismatch');
  assert.throws(()=>gate.accept(fetchSigned(claimedBad.row)),/signature_not_verified/);
  requireTrue(scalar(`SELECT status FROM ${S}.command_outbox
    WHERE command_id=${quote(idBad)}`)==='claimed','invalid_signature_was_acked');
  requireTrue(agent.receipts()[idBad]===undefined,'invalid_signature_created_receipt');
  stats.rogue_signed_outbox_command_rejected=true;

  stage='fence_old_generation';
  const id3=fakeId('queued');
  const queuedOld=formatCommand(id3,generation,digest1,keys.privateKey,'old queued must not move');
  requireTrue(enqueue(id3,generation,queuedOld)==='queued','enqueue_old_pending');
  const fenced=Number(scalar(`SELECT ${S}.fence_writer_uat(${generation})`));
  requireTrue(fenced===generation+1,'fence_not_monotonic');
  requireTrue(ack(generation,id2,claimed2.tag)==='f','fenced_old_writer_ack_accepted');
  // Device must receive a NEW signed epoch before its local guard knows the fence.
  // A DB-only fence cannot synchronously revoke disconnected physical devices.
  // A higher authorized generation does not consume any old outbox rows.
  const next=Number(scalar(`SELECT ${S}.start_writer_uat(${quote(holder)},${fenced},300)`));
  generation=next;
  requireTrue(generation===fenced+1,'target_generation_not_monotonic');
  epoch2=epochPacket(next);
  const digest2=gate.applyEpoch(epoch2).epochDigest;
  assert.throws(()=>gate.accept(queuedOld),/signed_command_epoch_or_grant_mismatch/);
  const noOld=claim(next);
  requireTrue(!noOld.row,'new_generation_reclaimed_old_commands');
  stats.stale_generations_quarantined=true;

  stage='receipt_reconcile_after_lost_ack';
  const id4=fakeId('reconcile');
  requireTrue(enqueue(id4,next,formatCommand(id4,next,digest2,
    keys.privateKey,'completed fake no ack'))==='queued','enqueue_reconcile');
  const claimed4=claim(next);
  requireTrue(claimed4.row?.out_command_id===id4,'claim_4_mismatch');
  const delivered4=fetchSigned(claimed4.row);
  gate.accept(delivered4);gate.startFake(id4);agent.completeFake(id4);
  // Model lost transport acknowledgement: DB still CLAIMED.
  requireTrue(scalar(`SELECT status FROM ${S}.command_outbox
    WHERE command_id=${quote(id4)}`)==='claimed','expected_claimed_before_reconcile');
  agent=new SyntheticAgentGeneration({root:fixture,agentId});
  gate=gateFactory(agent);gate.applyEpoch(epoch2);
  requireTrue(gate.accept(delivered4).status==='duplicate_no_execution','reconcile_would_reexecute');
  requireTrue(agent.receipts()[id4].status==='completed','completed_receipt_missing');
  requireTrue(ack(next,id4,claimed4.tag)==='t','reconciled_ack_failed');
  requireTrue(ack(next,id4,claimed4.tag)==='f','reconciled_duplicate_ack');
  stats.completed_no_ack_reconciled=true;
  console.log('RC50_SIGNED_PG_OUTBOX_AGENT_E2E_PASS '+JSON.stringify({
    ...stats,commandKind:'fake_noop',realDeviceExecuted:false,
    verifiedSourceWriterGeneration:initialGen,verifiedTargetWriterGeneration:next,
    globalAuthorityProven:false,productionCutoverAuthorized:false
  }));
}catch(error){
  process.stderr.write('RC50_SIGNED_PG_OUTBOX_AGENT_E2E_FAIL stage='+stage+
    ' reason='+String(error?.message||error).slice(0,220)+'\n');
  process.exitCode=1;
}finally{
  // Cleanup can only delete this UAT run's hard-coded UUID-prefix IDs.
  if(ids.length){
    try{
      const list=ids.filter(x=>/^uat_cmd_e2e_[a-f0-9]{14}_[a-z]+$/.test(x));
      if(list.length)
        psql(`DELETE FROM ${S}.command_outbox WHERE command_id IN
          (${list.map(quote).join(',')})`);
    }catch(error){
      process.stderr.write('RC50_E2E_CLEANUP_ROWS_FAILED '+String(error?.message||error).slice(0,120)+'\n');
      process.exitCode=1;
    }
  }
  if(generation!==null){
    try{
      const [g,status,owner]=state();
      if(status==='active' && owner===holder && Number(g)===generation)
        psql(`SELECT ${S}.fence_writer_uat(${generation})`);
      const [finalGen,finalStatus,finalHolder]=state();
      requireTrue(finalStatus==='fenced'&&finalHolder==='NONE','synthetic_fence_not_restored');
      requireTrue(scalar(`SELECT count(*) FROM ${S}.command_outbox
        WHERE command_id LIKE ${quote('uat_cmd_e2e_'+rid+'_%')}`)==='0',
        'synthetic_rows_remain');
      console.log('RC50_SIGNED_PG_OUTBOX_CLEANUP_PASS finalGeneration='+finalGen+' status=fenced rows=0');
    }catch(error){
      process.stderr.write('RC50_E2E_CLEANUP_FENCE_FAILED '+String(error?.message||error).slice(0,150)+'\n');
      process.exitCode=1;
    }
  }
  if(fixture){fs.rmSync(fixture,{recursive:true,force:true});}
}
