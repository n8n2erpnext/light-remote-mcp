/*
 * Optional Gold Wall modules. Local owner-scoped SQLite.
 * No secondary Wall, server, Account, mandatory Project, or old Continuity code.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {createGoldCodexConnection} from './gold-codex-api.mjs';
import {requireGoldMemoryPrivateKey} from './gold-memory-key-permissions.mjs';
import {createGoldCodexPlus} from './gold-codex-plus.mjs';
import {saveGoldCheckpoint,readGoldCheckpoint,listGoldCheckpoints,goldHandoff,saveGoldObserverReceipt,listGoldObserverReceipts,confirmGoldObserverTask} from './gold-memory-ledger.mjs';
import {createGoldScope,listGoldScopes,changeGoldScopeCapture,changeGoldScopeSyncPolicy,bindGoldScope,resolveGoldScope,appendGoldScopedCheckpoint,readGoldScopedCheckpoint,goldScopedHandoff,goldScopedExport,goldLegacyUnassignedCount} from './gold-memory-scope.mjs';
import {ingestGoldAutoEvent,ingestGoldAutoFsEffect,resolveGoldAutoWorkspace,flushGoldAuto,goldAutoPending} from './gold-memory-auto.mjs';
import {goldSyncIdentity,goldGrantReplica,goldAcceptReplicaInvite,goldNextSyncFrame,goldApplySyncFrame,goldApplySyncAck,goldRevokeReplica,goldSyncStatus} from './gold-memory-sync.mjs';
import {goldDeviceSelection,goldSetDeviceSelection} from './gold-memory-device-selection.mjs';
import {queueGoldReplicaEvidence,pendingGoldReplicaEvidence,acceptGoldReplicaEvidence,applyGoldReplicaEvidenceAck} from './gold-memory-evidence.mjs';
import {manualEvidenceCap,signManualEvidenceFrames} from './gold-memory-manual-evidence.mjs';
import {receiveGoldPeerRequest,pollGoldPeer,allowGoldPeerHomeUrl,configureGoldPeerRoute,listGoldPeerRoutes,runGoldPeerRoutes} from './gold-memory-peer.mjs';
const loadBuiltin=createRequire(import.meta.url);

function fault(code,status=400){return Object.assign(new Error(code),{status});}
function strictText(input,max,code){
  if(typeof input!=='string'||!input.trim()||input.length>max)throw fault(code);
  return input.trim();
}
function openPrivate(file){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  if(fs.existsSync(file))requireGoldMemoryPrivateKey(file,'gold_modules_database_permissions');
  const {DatabaseSync}=loadBuiltin('node:sqlite'); // do not activate SQLite while modules are OFF
  const db=new DatabaseSync(file);
  try {
    fs.chmodSync(file,0o600);
    requireGoldMemoryPrivateKey(file,'gold_modules_database_permissions');
    db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=2500;');
    db.exec('CREATE TABLE IF NOT EXISTS module_flags (singleton INTEGER PRIMARY KEY CHECK(singleton=1), memory_enabled INTEGER NOT NULL DEFAULT 0 CHECK(memory_enabled IN (0,1)),codex_enabled INTEGER NOT NULL DEFAULT 0 CHECK(codex_enabled IN (0,1)),revision INTEGER NOT NULL DEFAULT 0);'
      +'CREATE TABLE IF NOT EXISTS owner_notes(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN (\'note\',\'decision\',\'checkpoint\')),body TEXT NOT NULL,source TEXT NOT NULL,created_ms INTEGER NOT NULL);'
      +'CREATE TABLE IF NOT EXISTS observer_tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN (\'todo\',\'working\',\'done\',\'waiting\')),created_ms INTEGER NOT NULL,changed_ms INTEGER NOT NULL);'
      +'INSERT OR IGNORE INTO module_flags(singleton) VALUES(1);');
  }catch(e){db.close();throw e;}
  return db;
}
export function createGoldWallModules({file,fetchImpl,plusImpl,scopeIdentity=null}){
  if(!path.isAbsolute(file))throw fault('gold_modules_storage_path_required');
  let database=null;
  let codexRequestInFlight=false;
  const codex=createGoldCodexConnection({storageFile:file+'.codex.enc',fetchImpl});
  const plus=plusImpl||createGoldCodexPlus({home:path.join(path.dirname(file),'codex-home')});
  const checkpointKeyFile=file+'.checkpoint-key';
  const scopeKeyFile=file+'.device-ed25519-key';
  const scopeEncryptKeyFile=file+'.device-x25519-key';
  function scopedIdentity(){
    const identity=typeof scopeIdentity==='function'?scopeIdentity():scopeIdentity;
    if(!identity||typeof identity.accountId!=='string'||!identity.accountId.trim()
      ||typeof identity.deviceId!=='string'||!identity.deviceId.trim())
      throw fault('gold_scope_trusted_identity_required',403);
    return {accountId:identity.accountId,deviceId:identity.deviceId};
  }
  function open(create=false){
    if(database)return database;
    if(!create&&!fs.existsSync(file))return null;
    database=openPrivate(file);return database;
  }
  function flags(){
    const db=open();
    if(!db)return {longMemory:false,codexBridge:false,revision:0};
    const r=db.prepare('SELECT memory_enabled,codex_enabled,revision FROM module_flags WHERE singleton=1').get();
    return {longMemory:r?.memory_enabled===1,codexBridge:r?.codex_enabled===1,revision:Number(r?.revision)||0};
  }
  function enabled(feature){
    if(!flags()[feature])throw fault('gold_module_disabled',409);
    return open();
  }
  return {
    flags,
    configure(input={}){
      if(typeof input.longMemory!=='boolean'||typeof input.codexBridge!=='boolean'
        ||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)
        throw fault('gold_modules_configuration_invalid');
      if(!fs.existsSync(file)&&!input.longMemory&&!input.codexBridge&&input.expectedRevision===0)
        return flags(); // OFF/OFF creates no database.
      const db=open(true);
      const result=db.prepare('UPDATE module_flags SET memory_enabled=?,codex_enabled=?,revision=revision+1 WHERE singleton=1 AND revision=?')
        .run(Number(input.longMemory),Number(input.codexBridge),input.expectedRevision);
      if(result.changes!==1)throw fault('gold_modules_revision_conflict',409);
      return flags();
    },
    saveCheckpoint(input={}){return saveGoldCheckpoint(enabled('longMemory'),checkpointKeyFile,input);},
    readCheckpoint(id){return readGoldCheckpoint(enabled('longMemory'),checkpointKeyFile,id);},
    listCheckpoints(input={}){return listGoldCheckpoints(enabled('longMemory'),checkpointKeyFile,input);},
    handoff(input={}){return goldHandoff(enabled('longMemory'),checkpointKeyFile,input);},
    // G1: explicit, trusted local account/device binding; no unscoped automatic writes.
    createMemoryScope(input={}){const x=scopedIdentity();const db=enabled('longMemory');
      const preference=goldDeviceSelection(db,x);
      return createGoldScope(db,scopeKeyFile,{...input,accountId:x.accountId,homeDeviceId:x.deviceId,
        syncPolicy:preference.enabled?'selected_devices':'local_only'});},
    listMemoryScopes(){const x=scopedIdentity();return listGoldScopes(enabled('longMemory'),{accountId:x.accountId});},
    changeScopeCapture(input={}){const x=scopedIdentity();return changeGoldScopeCapture(enabled('longMemory'),{...input,accountId:x.accountId});},
    changeScopeSyncPolicy(input={}){const x=scopedIdentity();return changeGoldScopeSyncPolicy(enabled('longMemory'),{...input,accountId:x.accountId,deviceId:x.deviceId});},
    syncIdentity(){const x=scopedIdentity();enabled('longMemory');return goldSyncIdentity(scopeKeyFile,scopeEncryptKeyFile,x);},
    deviceSyncSelection(){const x=scopedIdentity();return goldDeviceSelection(enabled('longMemory'),x);},
    queueReplicaEvidence(input={}){const x=scopedIdentity();return queueGoldReplicaEvidence(enabled('longMemory'),
      scopeKeyFile,scopeEncryptKeyFile,{...input,...x});},
    pendingReplicaEvidence(input={}){const x=scopedIdentity(),db=enabled('longMemory');
      if(input.mode==='manual'){
        if(!Number.isSafeInteger(input.manualRequestSeq)||input.manualRequestSeq<1||input.manualRequestSeq%2===0)return [];
        const maxRowid=manualEvidenceCap(db,{...x,requestSeq:input.manualRequestSeq});
        const frames=pendingGoldReplicaEvidence(db,{...input,...x,maxRowid});
        return signManualEvidenceFrames(frames,scopeKeyFile,{...x,requestSeq:input.manualRequestSeq});
      }
      return pendingGoldReplicaEvidence(db,{...input,...x});
    },
    acceptReplicaEvidence(frame,{manualRequestSeq=0}={}){const x=scopedIdentity();
      return acceptGoldReplicaEvidence(enabled('longMemory'),
        scopeKeyFile,scopeEncryptKeyFile,{...x,frame,manualRequestSeq});},
    applyReplicaEvidenceAck(receipt){const x=scopedIdentity();return applyGoldReplicaEvidenceAck(enabled('longMemory'),
      {...x,receipt});},
    scopeSyncGate({scopeId,replicaDeviceId,mode,manualRequestSeq=0}={}){
      const x=scopedIdentity(),db=enabled('longMemory');
      const scope=db.prepare('SELECT scope_id FROM lm_scopes WHERE account_id=? AND home_device_id=? AND scope_id=? AND status=\'active\'')
        .get(x.accountId,x.deviceId,scopeId);
      if(!scope)return {allowed:false,reason:'not_scope_home'};
      if(mode==='auto')return {allowed:true,uptoRevision:null};
      if(mode==='follow_project'){
        const binding=db.prepare("SELECT 1 FROM lm_work_bindings WHERE account_id=? AND scope_id=? AND source_type IN ('workspace','repository','work_context') LIMIT 1")
          .get(x.accountId,scopeId);
        return {allowed:Boolean(binding),uptoRevision:null,reason:binding?null:'project_binding_required'};
      }
      if(mode!=='manual'||!Number.isSafeInteger(manualRequestSeq)||manualRequestSeq<1||manualRequestSeq%2===0)
        return {allowed:false,reason:'manual_sync_not_requested'};
      db.exec(`CREATE TABLE IF NOT EXISTS lm_sync_manual_limits(
        scope_id TEXT NOT NULL,device_id TEXT NOT NULL,request_seq INTEGER NOT NULL,
        upto_revision INTEGER NOT NULL,PRIMARY KEY(scope_id,device_id)
      )`);
      const saved=db.prepare('SELECT request_seq,upto_revision FROM lm_sync_manual_limits WHERE scope_id=? AND device_id=?')
        .get(scopeId,replicaDeviceId);
      if(saved&&saved.request_seq===manualRequestSeq)
        return {allowed:true,uptoRevision:saved.upto_revision};
      const head=db.prepare('SELECT revision FROM lm_heads WHERE scope_id=?').get(scopeId);
      db.prepare(`INSERT INTO lm_sync_manual_limits(scope_id,device_id,request_seq,upto_revision)
        VALUES(?,?,?,?) ON CONFLICT(scope_id,device_id) DO UPDATE
        SET request_seq=excluded.request_seq,upto_revision=excluded.upto_revision`)
        .run(scopeId,replicaDeviceId,manualRequestSeq,head?.revision||0);
      return {allowed:true,uptoRevision:head?.revision||0};
    },
    deviceSyncOverview(){
      const x=scopedIdentity(),db=enabled('longMemory');
      const selection=goldDeviceSelection(db,x);
      const scopes=listGoldScopes(db,{accountId:x.accountId})
        .filter(s=>s.homeDeviceId===x.deviceId);
      const devices={};
      for(const peerId of selection.selectedDeviceIds){
        let synced=0;
        for(const scope of scopes){
          const status=goldSyncStatus(db,{accountId:x.accountId,
            deviceId:x.deviceId,scopeId:scope.scopeId});
          const peer=status.peers.find(p=>p.deviceId===peerId&&p.role==='replica'&&!p.revokedAt);
          if(peer&&Number.isInteger(peer.ackRevision)&&peer.ackRevision>=scope.revision)synced++;
        }
        devices[peerId]=!selection.enabled?'off':
          !scopes.length?'no_scopes':synced===scopes.length?'synced':'pending';
      }
      return {selection,homeScopeCount:scopes.length,devices};
    },
    setDeviceSyncSelection(input={}){const x=scopedIdentity();return goldSetDeviceSelection(enabled('longMemory'),{...input,...x});},
    grantSyncReplica(input={}){const x=scopedIdentity();return goldGrantReplica(enabled('longMemory'),scopeKeyFile,scopeEncryptKeyFile,{...input,accountId:x.accountId,deviceId:x.deviceId});},
    acceptSyncInvite(input={}){const x=scopedIdentity();return goldAcceptReplicaInvite(enabled('longMemory'),scopeKeyFile,scopeEncryptKeyFile,{...input,accountId:x.accountId,deviceId:x.deviceId});},
    nextSyncFrame(input={}){const x=scopedIdentity();return goldNextSyncFrame(enabled('longMemory'),scopeKeyFile,scopeEncryptKeyFile,{...input,accountId:x.accountId,deviceId:x.deviceId});},
    applySyncFrame(input={}){const x=scopedIdentity();return goldApplySyncFrame(enabled('longMemory'),scopeKeyFile,scopeEncryptKeyFile,{...input,accountId:x.accountId,deviceId:x.deviceId});},
    applySyncAck(input={}){const x=scopedIdentity();return goldApplySyncAck(enabled('longMemory'),{...input,accountId:x.accountId,deviceId:x.deviceId});},
    revokeSyncReplica(input={}){const x=scopedIdentity();return goldRevokeReplica(enabled('longMemory'),{...input,accountId:x.accountId,deviceId:x.deviceId});},
    syncStatus(input={}){const x=scopedIdentity();return goldSyncStatus(enabled('longMemory'),{...input,accountId:x.accountId,deviceId:x.deviceId});},
    peerRequest(input={}){const x=scopedIdentity();return receiveGoldPeerRequest(enabled('longMemory'),
      scopeKeyFile,scopeEncryptKeyFile,{accountId:x.accountId,deviceId:x.deviceId,request:input});},
    async pollPeer(input={}){const x=scopedIdentity();return pollGoldPeer(enabled('longMemory'),
      scopeKeyFile,scopeEncryptKeyFile,{...input,accountId:x.accountId,deviceId:x.deviceId});},
    validatePeerUrl(url){return allowGoldPeerHomeUrl(url);},
    configurePeerRoute(input={}){const x=scopedIdentity();return configureGoldPeerRoute(enabled('longMemory'),
      {...input,accountId:x.accountId,deviceId:x.deviceId});},
    peerRoutes(){const x=scopedIdentity();return listGoldPeerRoutes(enabled('longMemory'),{accountId:x.accountId});},
    async pollPeerRoutes(){const x=scopedIdentity();return runGoldPeerRoutes(enabled('longMemory'),
      scopeKeyFile,scopeEncryptKeyFile,{accountId:x.accountId,deviceId:x.deviceId});},
    bindMemoryScope(input={}){const x=scopedIdentity();return bindGoldScope(enabled('longMemory'),{...input,accountId:x.accountId});},
    resolveMemoryScope(input={}){const x=scopedIdentity();return resolveGoldScope(enabled('longMemory'),{...input,accountId:x.accountId});},
    appendScopedCheckpoint(input={}){const x=scopedIdentity();return appendGoldScopedCheckpoint(enabled('longMemory'),scopeKeyFile,{...input,accountId:x.accountId,deviceId:x.deviceId});},
    readScopedCheckpoint(input={}){const x=scopedIdentity();return readGoldScopedCheckpoint(enabled('longMemory'),{...input,accountId:x.accountId});},
    scopedHandoff(input={}){const x=scopedIdentity();return goldScopedHandoff(enabled('longMemory'),{...input,accountId:x.accountId});},
    scopedExport(input={}){const x=scopedIdentity();return goldScopedExport(enabled('longMemory'),{...input,accountId:x.accountId});},
    legacyUnassignedCount(){scopedIdentity();return goldLegacyUnassignedCount(enabled('longMemory'));},
    ingestAutoEvent(input={}){const x=scopedIdentity();return ingestGoldAutoEvent(enabled('longMemory'),{...input,accountId:x.accountId,deviceId:x.deviceId});},
    ingestFsEffect(input={}){const x=scopedIdentity();return ingestGoldAutoFsEffect(enabled('longMemory'),{...input,accountId:x.accountId,deviceId:x.deviceId});},
    resolveAutoWorkspace(input={}){const x=scopedIdentity();return resolveGoldAutoWorkspace(enabled('longMemory'),{...input,accountId:x.accountId,deviceId:x.deviceId,allowReplica:false});},
    resolveReplicaWorkspace(input={}){const x=scopedIdentity();return resolveGoldAutoWorkspace(enabled('longMemory'),{...input,accountId:x.accountId,deviceId:x.deviceId,allowReplica:true});},
    flushAuto(input={}){const x=scopedIdentity();return flushGoldAuto(enabled('longMemory'),scopeKeyFile,{...input,accountId:x.accountId,deviceId:x.deviceId});},
    autoPending(){const x=scopedIdentity();return goldAutoPending(enabled('longMemory'),{accountId:x.accountId});},
    observerReceipts(){return listGoldObserverReceipts(enabled('codexBridge'));},
    confirmObserverTask(input={}){
      const db=enabled('codexBridge');
      const result=confirmGoldObserverTask(db,input); // owner-approved CAS is the authority
      if(flags().longMemory){
        try{
          const x=scopedIdentity();
          ingestGoldAutoEvent(db,{accountId:x.accountId,deviceId:x.deviceId,
            sourceType:'task',sourceId:result.taskId,workContextId:'task:'+result.taskId,
            eventType:'task_state_changed',
            eventRef:'task:owner-approve:'+result.receiptId+':'+result.taskId});
        }catch(e){if(e.message!=='gold_scope_trusted_identity_required')
          console.error(JSON.stringify({event:'gold_auto_owner_transition_failed',code:String(e.message).slice(0,90)}));}
      }
      return result;
    },
    saveNote(input={}){
      const db=enabled('longMemory');
      if(!['note','decision','checkpoint'].includes(input.kind??'note'))throw fault('gold_memory_kind_invalid');
      const kind=input.kind??'note',body=strictText(input.body,12000,'gold_memory_body_invalid'),
        source=strictText(input.source,512,'gold_memory_source_required');
      const id=crypto.randomUUID(),createdAt=Date.now();
      db.prepare('INSERT INTO owner_notes(id,kind,body,source,created_ms) VALUES(?,?,?,?,?)').run(id,kind,body,source,createdAt);
      return {id,kind,source,createdAt};
    },
    notes({query='',limit=20}={}){
      const db=enabled('longMemory');
      if(typeof query!=='string'||query.length>160)throw fault('gold_memory_query_invalid');
      const n=Math.min(Math.max(Number(limit)||20,1),50);
      if(query.trim()){
        const q='%'+query.trim().replace(/[\\%_]/g,'\\$&')+'%';
        return db.prepare("SELECT id,kind,body,source,created_ms AS createdAt FROM owner_notes WHERE body LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\' ORDER BY created_ms DESC,id DESC LIMIT ?").all(q,q,n);
      }
      return db.prepare('SELECT id,kind,body,source,created_ms AS createdAt FROM owner_notes ORDER BY created_ms DESC,id DESC LIMIT ?').all(n);
    },
    addTask(input={}){
      const db=enabled('codexBridge');
      const title=strictText(input.title,240,'gold_observer_task_invalid');
      const id=crypto.randomUUID(),now=Date.now();
      if(input.scopeId){
        if(!flags().longMemory)throw fault('gold_module_disabled',409);
        const identity=scopedIdentity();
        db.exec('BEGIN IMMEDIATE');
        try{
          db.prepare('INSERT INTO observer_tasks(id,title,state,created_ms,changed_ms) VALUES(?,?,?,?,?)').run(id,title,'todo',now,now);
          bindGoldScope(db,{accountId:identity.accountId,scopeId:input.scopeId,sourceType:'task',
            sourceId:id,proofType:'owner_explicit'});
          db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        const event=ingestGoldAutoEvent(db,{accountId:identity.accountId,deviceId:identity.deviceId,
          sourceType:'task',sourceId:id,workContextId:'task:'+id,
          eventType:'task_created',eventRef:'task:create:'+id});
        return {id,title,state:'todo',scopeId:input.scopeId,autoEventQueued:event.accepted};
      }
      db.prepare('INSERT INTO observer_tasks(id,title,state,created_ms,changed_ms) VALUES(?,?,?,?,?)').run(id,title,'todo',now,now);
      return {id,title,state:'todo'};
    },
    updateTask(input={}){
      const db=enabled('codexBridge');
      const id=strictText(input.id,64,'gold_observer_task_id_invalid');
      if(!['todo','working','done','waiting'].includes(input.state))throw fault('gold_observer_state_invalid');
      const prior=db.prepare('SELECT state FROM observer_tasks WHERE id=?').get(id);
      if(!prior)throw fault('gold_observer_task_not_found',404);
      if(prior.state===input.state)return {id,state:input.state,unchanged:true};
      const changedAt=Date.now();
      const changed=db.prepare('UPDATE observer_tasks SET state=?,changed_ms=? WHERE id=? AND state=?')
        .run(input.state,changedAt,id,prior.state);
      if(changed.changes!==1)throw fault('gold_observer_task_changed',409);
      let autoEventQueued=false;
      if(flags().longMemory){
        try{
          const identity=scopedIdentity();
          autoEventQueued=ingestGoldAutoEvent(db,{accountId:identity.accountId,deviceId:identity.deviceId,
            sourceType:'task',sourceId:id,workContextId:'task:'+id,
            eventType:'task_state_changed',eventRef:'task:change:'+id+':'+changedAt+':'+crypto.randomUUID()}).accepted;
        }catch(e){if(e.message!=='gold_scope_trusted_identity_required')
          console.error(JSON.stringify({event:'gold_auto_task_capture_failed',code:String(e.message).slice(0,90)}));}
      }
      return {id,state:input.state,autoEventQueued};
    },
    async codexPlusStatus(){enabled('codexBridge');return plus.account();},
    async codexPlusLogin(){enabled('codexBridge');return plus.beginLogin();},
    async codexPlusCancel(){enabled('codexBridge');return plus.cancelLogin();},
    async codexPlusLogout(){enabled('codexBridge');return plus.logout();},
    async codexPlusObserve(){
      const db=enabled('codexBridge');
      if(codexRequestInFlight)throw fault('codex_run_already_in_progress',409);
      codexRequestInFlight=true;
      try{
        const rows=db.prepare('SELECT id,title,state,changed_ms AS changedAt FROM observer_tasks ORDER BY changed_ms DESC LIMIT 20').all();
        const result=await plus.runReadOnly({tasks:rows});
        if(result.completed&&typeof result.summary==='string'&&result.summary.trim()){
          const receipt=saveGoldObserverReceipt(db,{summary:result.summary,status:'completed',tasks:rows});
          return {...result,receipt,taskStateChanged:false,ownerConfirmationRequired:true};
        }
        return {...result,taskStateChanged:false,ownerConfirmationRequired:true};
      }finally{codexRequestInFlight=false;}
    },
    codexConfig(){enabled('codexBridge');return codex.config();},
    saveCodexKey(input){enabled('codexBridge');return codex.save(input);},
    clearCodexKey(){enabled('codexBridge');return codex.clear();},
    async verifyCodexKey(){enabled('codexBridge');return codex.verify();},
    async runCodexObserver(){
      const db=enabled('codexBridge');
      if(codexRequestInFlight)throw fault('codex_run_already_in_progress',409);
      codexRequestInFlight=true;
      try {
        const tasks=db.prepare('SELECT title,state FROM observer_tasks ORDER BY changed_ms DESC LIMIT 20').all();
        return await codex.run({tasks});
      } finally {codexRequestInFlight=false;}
    },
    observer(){
      const db=enabled('codexBridge');
      const tasks=db.prepare('SELECT id,title,state,created_ms AS createdAt,changed_ms AS changedAt FROM observer_tasks ORDER BY created_ms,id LIMIT 100').all();
      const states=tasks.map(t=>t.state);
      const recommendation=states.includes('waiting')?'WAIT_OWNER'
        :states.length>0&&states.every(s=>s==='done')?'DONE'
        :states.some(s=>s==='working'||s==='todo')?'CONTINUE':'WAIT_OWNER';
      return {tasks,recommendation,engine:'local-controller',codexRuntime:'not_connected',webTurnContinuation:'unsupported'};
    },
    close(){plus.stop();if(database){database.close();database=null;}}
  };
}
